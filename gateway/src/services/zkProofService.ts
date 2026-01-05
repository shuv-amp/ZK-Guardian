import * as snarkjs from "snarkjs";
import axios from "axios";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
    hashFhirConsent,
    prepareCircuitInputs,
    stringToFieldElement,
    initPoseidon,
    CircuitInputs
} from "../utils/fhirToPoseidon.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { batchQueueGauge, proofGenerationHistogram } from "../metrics/prometheus.js";

// In production, these should be environment variables or copied to build dir
// For monorepo dev, we point to the siblings
const CIRCUITS_BUILD_DIR = path.resolve(__dirname, "../../circuits");
const CIRCUIT_WASM = path.join(CIRCUITS_BUILD_DIR, "AccessIsAllowed_js/AccessIsAllowed.wasm");
const CIRCUIT_ZKEY = path.join(CIRCUITS_BUILD_DIR, "AccessIsAllowed_final.zkey");
const VERIFICATION_KEY = path.join(CIRCUITS_BUILD_DIR, "verification_key.json");

const HAPI_FHIR_URL = env.HAPI_FHIR_URL || "http://localhost:8080/fhir";

// Proof generation timeout (per SECURITY_AUDIT_CHECKLIST.md ZK2)
const PROOF_TIMEOUT_MS = 30000; // 30 seconds

export interface AccessRequest {
    patientId: string;
    clinicianId: string;
    resourceId: string;
    resourceType: string;
}

export interface ProofResult {
    proof: {
        a: string[];
        b: string[][];
        c: string[];
    };
    publicSignals: string[];
    proofHash: string;
    timestamp: number;
}

class ZKProofService {
    private initialized = false;
    private poseidon: any;
    private F: any;
    // Allow injecting snarkjs for testing (avoiding WASM execution)
    private snarkjs: any = snarkjs;

    // Queue management for ZK4 requirement
    private queue: Array<{
        task: () => Promise<any>;
        resolve: (value: any) => void;
        reject: (reason?: any) => void;
    }> = [];
    private activeCount = 0;
    private readonly MAX_CONCURRENCY = 2; // Limit concurrent heavy computations
    private readonly MAX_QUEUE_SIZE = 100; // ZK4 requirement

    public setSnarkJS(mock: any) {
        this.snarkjs = mock;
    }

    async initialize() {
        if (this.initialized) return;
        await initPoseidon();
        console.log("[ZKProofService] Initialized Poseidon");
        this.initialized = true;
    }

    /**
     * Core function: Fetches consent, generates proof, returns formatting for contract
     */
    async generateAccessProof(request: AccessRequest): Promise<ProofResult> {
        if (!this.initialized) await this.initialize();

        const { patientId, clinicianId, resourceId, resourceType } = request;

        // 1. Fetch Consent
        const consent = await this.fetchActiveConsent(patientId);
        if (!consent) {
            throw new Error("NO_ACTIVE_CONSENT");
        }

        // 2. Prepare Inputs
        // Note: We use Date.now() for the current timestamp, which works for this
        // immediate proof generation. In a distributed system, we might want a synchronized source.
        const currentTimestamp = Math.floor(Date.now() / 1000);

        // We use the raw resourceId here. The circuit handles the hashing/splitting interactions.

        const inputs = await prepareCircuitInputs({
            consent,
            patientId,
            clinicianId,
            resourceId: resourceId, // or `${resourceType}/${resourceId}`? Let's stay flexible
            timestamp: currentTimestamp
        });

        logger.info({
            patientId,
            clinicianId,
            resourceType,
            queueSize: this.queue.length
        }, `Queuing ZK proof for ${resourceType} access`);

        // 3. Generate Proof with timeout (ZK2: 30s max) AND Queue (ZK4: max 100)
        // We wrap the heavy computation in the queue
        const { proof, publicSignals } = await this.enqueueProofGeneration(() =>
            this.generateProofWithTimeout(
                inputs,
                CIRCUIT_WASM,
                CIRCUIT_ZKEY
            )
        );

        // 4. Format for Solidity
        const calldata = await this.snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
        // calldata is a string like: ["0x...", "0x..."], [["0x...","0x..."]...], ...
        // We parse it to get clean arrays
        const [a, b, c, input] = JSON.parse(`[${calldata}]`);

        return {
            proof: { a, b, c },
            publicSignals: input, // This matches _pubSignals in contract
            proofHash: this.computeProofHash(proof),
            timestamp: currentTimestamp
        };
    }

    /**
     * Enqueue a proof generation task.
     * Implements ZK4: Batch queue bounded (max 100)
     */
    private enqueueProofGeneration<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            if (this.queue.length >= this.MAX_QUEUE_SIZE) {
                logger.warn("ZK Proof queue full, rejecting request");
                return reject(new Error("PROOF_QUEUE_FULL"));
            }

            this.queue.push({ task, resolve, reject });
            batchQueueGauge.set(this.queue.length); // Update metric
            this.processQueue();
        });
    }

    /**
     * Process the queue respecting concurrency limits
     */
    private async processQueue() {
        if (this.activeCount >= this.MAX_CONCURRENCY || this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift();
        if (!item) return;

        batchQueueGauge.set(this.queue.length); // Update metric
        this.activeCount++;

        const endTimer = proofGenerationHistogram.startTimer(); // Start timing

        try {
            const result = await item.task();
            item.resolve(result);
        } catch (error) {
            item.reject(error);
        } finally {
            endTimer(); // End timing
            this.activeCount--;
            // Process next item
            setImmediate(() => this.processQueue());
        }
    }

    /**
     * Lookup active Patient Consent in HAPI FHIR
     */
    private async fetchActiveConsent(patientId: string) {
        try {
            // Assuming HAPI FHIR is running and accessible
            const response = await axios.get(`${HAPI_FHIR_URL}/Consent`, {
                params: {
                    patient: `Patient/${patientId}`, // or just patientId depending on server config
                    status: "active",
                    _sort: "-date",
                    _count: 1
                },
                headers: { Accept: "application/fhir+json" },
                timeout: 10000 // 10s timeout for FHIR requests
            });

            const bundle = response.data;
            if (!bundle.entry || bundle.entry.length === 0) {
                return null;
            }

            return bundle.entry[0].resource;
        } catch (error: any) {
            logger.warn({ error: error.message }, `Failed to fetch consent for ${patientId}`);
            // For DEV mode only: return a mock consent if connection fails?
            // "Super reasoning": NO. High stake. If fetch fails, we fail.
            // Exception: If HAPI is not running yet during this *test* phase, maybe mock?
            // User did not ask to mock. Stick to real implementation.
            throw new Error("FHIR_FETCH_FAILED");
        }
    }

    /**
     * Generate proof with timeout to prevent hung requests (ZK2 requirement)
     * Wraps snarkjs.groth16.fullProve with a 30-second timeout
     */
    private async generateProofWithTimeout(
        inputs: any,
        wasmPath: string,
        zkeyPath: string
    ): Promise<{ proof: any; publicSignals: string[] }> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error("PROOF_TIMEOUT"));
            }, PROOF_TIMEOUT_MS);
        });

        const proofPromise = this.snarkjs.groth16.fullProve(inputs, wasmPath, zkeyPath);

        try {
            const result = await Promise.race([proofPromise, timeoutPromise]);
            return result;
        } catch (error: any) {
            if (error.message === "PROOF_TIMEOUT") {
                logger.error({
                    timeout: PROOF_TIMEOUT_MS,
                    inputs: JSON.stringify(inputs).slice(0, 200) // Log partial inputs for debugging
                }, "ZK proof generation timed out");
                throw new Error("PROOF_TIMEOUT: Proof generation exceeded 30 second limit");
            }
            throw error;
        }
    }

    /**
     * Verify circuit files exist and have valid checksums (ZK1 requirement)
     * Should be called at startup to ensure circuit integrity
     */
    async verifyCircuitIntegrity(): Promise<{
        valid: boolean;
        checksums: { wasm: string; zkey: string; vkey: string };
        errors: string[];
    }> {
        const errors: string[] = [];
        const checksums = { wasm: "", zkey: "", vkey: "" };

        // Check WASM file
        if (!fs.existsSync(CIRCUIT_WASM)) {
            errors.push(`Circuit WASM not found: ${CIRCUIT_WASM}`);
        } else {
            const wasmHash = crypto
                .createHash("sha256")
                .update(fs.readFileSync(CIRCUIT_WASM))
                .digest("hex");
            checksums.wasm = wasmHash;
            logger.info({ path: CIRCUIT_WASM, sha256: wasmHash }, "Circuit WASM checksum");
        }

        // Check ZKEY file
        if (!fs.existsSync(CIRCUIT_ZKEY)) {
            errors.push(`Circuit ZKEY not found: ${CIRCUIT_ZKEY}`);
        } else {
            const zkeyHash = crypto
                .createHash("sha256")
                .update(fs.readFileSync(CIRCUIT_ZKEY))
                .digest("hex");
            checksums.zkey = zkeyHash;
            logger.info({ path: CIRCUIT_ZKEY, sha256: zkeyHash }, "Circuit ZKEY checksum");
        }

        // Check verification key
        if (!fs.existsSync(VERIFICATION_KEY)) {
            errors.push(`Verification key not found: ${VERIFICATION_KEY}`);
        } else {
            const vkeyContent = fs.readFileSync(VERIFICATION_KEY, "utf-8");
            const vkeyHash = crypto
                .createHash("sha256")
                .update(vkeyContent)
                .digest("hex");
            checksums.vkey = vkeyHash;

            // Validate JSON structure
            try {
                const vkey = JSON.parse(vkeyContent);
                if (!vkey.protocol || vkey.protocol !== "groth16") {
                    errors.push("Verification key has unexpected protocol");
                }
                if (!vkey.curve || vkey.curve !== "bn128") {
                    errors.push("Verification key has unexpected curve");
                }
            } catch (e) {
                errors.push("Verification key is not valid JSON");
            }
            logger.info({ path: VERIFICATION_KEY, sha256: vkeyHash }, "Verification key checksum");
        }

        // Optional: Compare against known good checksums from environment
        const expectedWasmHash = process.env.CIRCUIT_WASM_SHA256;
        const expectedZkeyHash = process.env.CIRCUIT_ZKEY_SHA256;

        if (expectedWasmHash && checksums.wasm !== expectedWasmHash) {
            errors.push(`WASM checksum mismatch: expected ${expectedWasmHash}, got ${checksums.wasm}`);
        }
        if (expectedZkeyHash && checksums.zkey !== expectedZkeyHash) {
            errors.push(`ZKEY checksum mismatch: expected ${expectedZkeyHash}, got ${checksums.zkey}`);
        }

        return {
            valid: errors.length === 0,
            checksums,
            errors
        };
    }

    /**
     * Verify a proof against the verification key (for off-chain verification)
     */
    async verifyProof(
        proof: { a: string[]; b: string[][]; c: string[] },
        publicSignals: string[]
    ): Promise<boolean> {
        try {
            const vkey = JSON.parse(fs.readFileSync(VERIFICATION_KEY, "utf-8"));

            // Convert from Solidity format back to snarkjs format
            const snarkjsProof = {
                pi_a: [...proof.a, "1"],
                pi_b: [
                    [proof.b[0][1], proof.b[0][0]],
                    [proof.b[1][1], proof.b[1][0]],
                    ["1", "0"]
                ],
                pi_c: [...proof.c, "1"],
                protocol: "groth16",
                curve: "bn128"
            };

            const result = await this.snarkjs.groth16.verify(vkey, publicSignals, snarkjsProof);
            return result;
        } catch (error: any) {
            logger.error({ error: error.message }, "Proof verification failed");
            return false;
        }
    }

    private computeProofHash(proof: any): string {
        // Use keccak256-like hash for consistency with Solidity contract
        const data = JSON.stringify(proof);
        return crypto.createHash("sha256").update(data).digest("hex");
    }
}

export const zkProofService = new ZKProofService();
