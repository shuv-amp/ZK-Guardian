
import * as snarkjs from "snarkjs";
import axios from "axios";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
    hashFhirConsent,
    prepareCircuitInputs,
    stringToFieldElement,
    initPoseidon,
    CircuitInputs
} from "../../utils/fhirToPoseidon.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";
import { checkConsentNotRevoked } from "../../lib/revocationChecker.js";
import { batchQueueGauge, proofGenerationHistogram } from "../../metrics/prometheus.js";
import { prisma } from "../../db/client.js";

// In production, these should be environment variables or copied to build dir
// For monorepo dev, we point to the siblings
const CIRCUITS_BUILD_DIR = env.CIRCUIT_ARTIFACTS_DIR
    ? path.resolve(env.CIRCUIT_ARTIFACTS_DIR)
    : path.resolve(__dirname, "../../../circuits/build");
const SECURE_CIRCUIT_DIR = path.join(CIRCUITS_BUILD_DIR, "AccessIsAllowedSecure");
const CIRCUIT_WASM = path.join(SECURE_CIRCUIT_DIR, "AccessIsAllowedSecure_js/AccessIsAllowedSecure.wasm");
const CIRCUIT_ZKEY = path.join(SECURE_CIRCUIT_DIR, "AccessIsAllowedSecure_final.zkey");
const VERIFICATION_KEY = path.join(SECURE_CIRCUIT_DIR, "AccessIsAllowedSecure_verification_key.json");
const CHECKSUMS_FILE = path.resolve(CIRCUITS_BUILD_DIR, "../../checksums.sha256");

const HAPI_FHIR_URL = env.HAPI_FHIR_URL || "http://localhost:8080/fhir";

// 30s timeout to prevent hanging request
const PROOF_TIMEOUT_MS = 30000;

// Need at least 512MB free to run proof generation safely
const MIN_FREE_MEMORY_MB = 512;

export interface AccessRequest {
    patientId: string;
    clinicianId: string;
    resourceId: string;
    resourceType: string;
    patientNullifier: string;
    sessionNonce: string;
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
    private lastIntegrity: { valid: boolean; checksums: { wasm: string; zkey: string; vkey: string }; errors: string[] } | null = null;
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

    private normalizePractitionerId(value: string): string {
        return String(value || '')
            .replace(/^Practitioner\//i, '')
            .trim()
            .toLowerCase();
    }

    private extractAuthorizedPractitionerIds(consent: any): Set<string> {
        const practitionerIds = new Set<string>();
        const addCandidate = (candidate: unknown): void => {
            if (typeof candidate !== 'string') return;
            const normalized = this.normalizePractitionerId(candidate);
            if (normalized) practitionerIds.add(normalized);
        };

        const performers = Array.isArray(consent?.performer) ? consent.performer : [];
        for (const performer of performers) {
            addCandidate(performer?.reference);
            addCandidate(performer?.display);
            if (performer?.actor) {
                addCandidate(performer.actor.reference);
                addCandidate(performer.actor.display);
            }
        }

        const actors = Array.isArray(consent?.provision?.actor) ? consent.provision.actor : [];
        for (const actor of actors) {
            addCandidate(actor?.reference?.reference);
            addCandidate(actor?.reference?.display);
        }

        return practitionerIds;
    }

    private consentRecencyScore(consent: any): number {
        const candidates = [
            consent?.meta?.lastUpdated,
            consent?.dateTime,
            consent?.provision?.period?.start
        ];

        for (const candidate of candidates) {
            if (typeof candidate !== 'string') continue;
            const parsed = Date.parse(candidate);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }

        return 0;
    }

    async initialize() {
        if (this.initialized) return;
        try {
            await initPoseidon();
            logger.info('[ZKProofService] Initialized Poseidon');
        } catch (e) {
            logger.warn('Failed to initialize Poseidon - continuing (might be valid for dev mock)');
        }
        this.initialized = true;
    }

    /**
     * core logic: fetch consent -> gen proof -> format for chain
     */
    async generateAccessProof(request: AccessRequest): Promise<ProofResult> {
        if (!this.initialized) await this.initialize();

        const {
            patientId,
            clinicianId,
            resourceId,
            resourceType,
            patientNullifier,
            sessionNonce
        } = request;

        // 1. Fetch Consent from FHIR (Works for both Prod and Dev via synthetic fallback)
        const consent = await this.fetchActiveConsent(patientId);
        if (!consent) {
            throw new Error("NO_ACTIVE_CONSENT");
        }

        // Defensively enforce active status in case upstream filtering is lax.
        if (String(consent.status || '').toLowerCase() !== 'active') {
            logger.warn({
                patientId,
                clinicianId,
                consentId: consent.id,
                consentStatus: consent.status
            }, 'Consent is not active; denying access');
            throw new Error("CONSENT_REVOKED");
        }

        logger.debug({
            patientId,
            clinicianId,
            consentId: consent.id,
            consentStatus: consent.status,
            consentUpdatedAt: consent?.meta?.lastUpdated,
            consentPerformer: consent?.performer?.[0]?.display || consent?.performer?.[0]?.reference || null
        }, 'Selected consent for access proof');

        // 1.1 Scope Check (Critical: Must happen before Dev Bypass)
        // Check if the consent actually covers the requested resource
        const allowedScopes = (consent.provision?.class || [])
            .map((entry: any) => String(entry?.code || '').trim())
            .filter(Boolean);

        const normalizedResourceType = resourceType.toLowerCase();
        const isAllowed = allowedScopes.some((scope: string) => {
            if (scope === '*') return true;
            const normalizedScope = scope.toLowerCase();
            if (normalizedScope === normalizedResourceType) return true;
            const uriTail = normalizedScope.split('/').pop();
            return uriTail === normalizedResourceType;
        });

        if (!isAllowed) {
            logger.warn({ patientId, resourceType, allowedScopes }, 'Consent exists but does not cover this resource');
            // In dev mode, we still want to throw to test negative cases
            throw new Error("CONSENT_SCOPE_MISMATCH");
        }

        // Enforce that clinician access only succeeds when consent explicitly allows
        // that practitioner. If the consent does not encode practitioner constraints,
        // we preserve backward-compatible behavior and treat it as non-restrictive.
        const authorizedPractitioners = this.extractAuthorizedPractitionerIds(consent);
        if (authorizedPractitioners.size > 0) {
            const requestedPractitioner = this.normalizePractitionerId(clinicianId);
            const matchesPractitioner = authorizedPractitioners.has(requestedPractitioner);
            if (!matchesPractitioner) {
                logger.warn({
                    patientId,
                    clinicianId,
                    authorizedPractitioners: Array.from(authorizedPractitioners)
                }, 'Consent exists but clinician is not authorized by consent actor/performer');
                throw new Error("CONSENT_PRACTITIONER_MISMATCH");
            }
        }

        // DEV MODE BYPASS - Mock Proof ONLY if explicitly allowed
        // Uses ALLOW_DEV_BYPASS so that development defaults to real proofs
        // unless tests or local demos deliberately opt out.
        if (env.ALLOW_DEV_BYPASS) {
            logger.warn('Mocking ZK Proof generation (ALLOW_DEV_BYPASS=true) - Consent Validated');
            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 500));
            const mockTimestamp = Math.floor(Date.now() / 1000).toString();
            return {
                proof: {
                    a: ["0x1", "0x2"],
                    b: [["0x1", "0x2"], ["0x3", "0x4"]],
                    c: ["0x5", "0x6"]
                },
                publicSignals: [
                    "1", // isValid
                    "0x2", // blindedPatientId
                    "0x3", // blindedAccessHash
                    "0x4", // nullifierHash
                    "0x5", // proofOfPolicyMatch
                    mockTimestamp, // currentTimestamp
                    "0x1234567890abcdef" // accessEventHash (mocked)
                ],
                proofHash: "0xMOCK_PROOF_" + crypto.randomBytes(32).toString('hex'),
                timestamp: Number(mockTimestamp)
            };
        }

        // on-chain revocation check
        const consentHash = await hashFhirConsent(consent);
        logger.debug({
            patientId,
            clinicianId,
            consentId: consent.id,
            consentHash: consentHash.slice(0, 18) + '...'
        }, 'Checking consent revocation state');
        await checkConsentNotRevoked(consentHash);

        // 2. Prepare Inputs
        const currentTimestamp = Math.floor(Date.now() / 1000);

        const inputs = await prepareCircuitInputs({
            consent,
            patientId,
            clinicianId,
            resourceId,
            resourceType, // CRITICAL: Pass resourceType for circuit category matching
            timestamp: currentTimestamp,
            patientNullifier,
            sessionNonce
        });

        logger.info({
            patientId,
            clinicianId,
            resourceType,
            queueSize: this.queue.length
        }, `Queuing ZK proof for ${resourceType} access`);

        // generate with timeout and queue limits
        const { proof, publicSignals } = await this.enqueueProofGeneration(() =>
            this.generateProofWithTimeout(
                inputs,
                CIRCUIT_WASM,
                CIRCUIT_ZKEY
            )
        );

        // 4. Format for Solidity
        const calldata = await this.snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
        const [a, b, c, input] = JSON.parse(`[${calldata}]`);

        return {
            proof: { a, b, c },
            publicSignals: input,
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
            // limit queue size
            if (this.queue.length >= this.MAX_QUEUE_SIZE) {
                logger.warn("ZK Proof queue full, rejecting request");
                return reject(new Error("PROOF_QUEUE_FULL"));
            }

            this.queue.push({ task, resolve, reject });
            batchQueueGauge.set(this.queue.length);
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

        // ZK5: Check memory availability before starting heavy computation
        try {
            this.checkMemoryAvailability();
        } catch (error: any) {
            logger.error({ error: error.message }, "Insufficient memory for proof generation");
            this.activeCount--;
            // Reject this item and process next
            item.reject(error);
            setImmediate(() => this.processQueue());
            return;
        }

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
     * In development mode, returns synthetic consent when FHIR unavailable to enable testing
     */
    private async fetchActiveConsent(patientId: string) {
        try {
            let localConsents: Array<{
                fhirConsentId: string;
                status: string;
                validFrom: Date;
                validUntil: Date;
                revokedAt: Date | null;
            }> = [];
            try {
                localConsents = await prisma.consentCache.findMany({
                    where: { patientId },
                    select: {
                        fhirConsentId: true,
                        status: true,
                        validFrom: true,
                        validUntil: true,
                        revokedAt: true
                    }
                });
            } catch (prismaError: any) {
                logger.debug({ patientId, error: prismaError?.message }, 'Consent cache lookup failed; proceeding without local reconciliation');
            }
            const localConsentState = new Map<string, string>();
            for (const consent of localConsents) {
                localConsentState.set(consent.fhirConsentId, consent.status);
            }
            const hasLocalConsentHistory = localConsents.length > 0;

            // Assuming HAPI FHIR is running and accessible
            const response = await axios.get(`${HAPI_FHIR_URL}/Consent`, {
                params: {
                    patient: `Patient/${patientId}`,
                    status: "active",
                    _sort: "-_lastUpdated",
                    _count: 200
                },
                headers: { Accept: "application/fhir+json" },
                timeout: 10000
            });

            const bundle = response.data;
            if (!bundle.entry || bundle.entry.length === 0) {
                // If we already know this patient has consent history locally, do not
                // auto-create synthetic consent. This preserves revoke semantics.
                if (hasLocalConsentHistory) {
                    logger.info({ patientId }, "No active consent in FHIR; local consent history exists, denying access");
                    return null;
                }

                // fake consent for devs if configured
                if (env.ENABLE_SYNTHETIC_CONSENT) {
                    logger.warn({ patientId }, 'using synthetic consent (dev flag on)');
                    return this.createSyntheticConsent(patientId);
                }
                return null;
            }

            const activeConsents = bundle.entry
                .map((entry: any) => entry?.resource)
                .filter((resource: any) => {
                    if (!resource) return false;
                    if (String(resource.status || '').toLowerCase() !== 'active') return false;
                    // Local cache is the authoritative state for revoke operations in
                    // this prototype because public FHIR may reject status patches.
                    const localStatus = localConsentState.get(String(resource.id || ''));
                    if (localStatus && localStatus !== 'active') {
                        return false;
                    }
                    return true;
                });

            if (activeConsents.length === 0) {
                if (hasLocalConsentHistory) {
                    logger.info({ patientId }, "No locally-active consent after reconciliation; denying access");
                    return null;
                }
                if (env.ENABLE_SYNTHETIC_CONSENT) {
                    logger.warn({ patientId }, 'using synthetic consent (dev flag on)');
                    return this.createSyntheticConsent(patientId);
                }
                return null;
            }

            activeConsents.sort((a: any, b: any) =>
                this.consentRecencyScore(b) - this.consentRecencyScore(a)
            );

            return activeConsents[0];
        } catch (error: any) {
            // In development, return synthetic consent to enable testing without FHIR
            if (env.ENABLE_SYNTHETIC_CONSENT) {
                logger.warn({ patientId, error: error.message }, 'FHIR unavailable, using synthetic consent (ENABLE_SYNTHETIC_CONSENT=true)');
                return this.createSyntheticConsent(patientId);
            }
            logger.warn({ error: error.message }, `Failed to fetch consent for ${patientId}`);
            throw new Error("FHIR_FETCH_FAILED");
        }
    }

    /**
     * Creates a synthetic FHIR Consent resource for development/testing
     * This allows the ZK proof flow to be tested without a running FHIR server
     */
    private createSyntheticConsent(patientId: string) {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

        return {
            resourceType: "Consent",
            id: `synthetic-${patientId}-${Date.now()}`,
            status: "active",
            scope: {
                coding: [{
                    system: "http://terminology.hl7.org/CodeSystem/consentscope",
                    code: "patient-privacy"
                }]
            },
            category: [{
                coding: [{
                    system: "http://loinc.org",
                    code: "59284-0"
                }]
            }],
            patient: { reference: `Patient/${patientId}` },
            dateTime: now.toISOString(),
            provision: {
                type: "permit",
                period: {
                    start: now.toISOString(),
                    end: oneHourLater.toISOString()
                },
                // Allow all clinical resource types for development testing
                class: [
                    { code: "Observation" },
                    { code: "Condition" },
                    { code: "MedicationRequest" },
                    { code: "DiagnosticReport" },
                    { code: "Procedure" }
                ]
            }
        };
    }



    /**
     * wraps proofer with a hard timeout
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
                    // inputs: redacted for security
                }, "ZK proof generation timed out");
                throw new Error("PROOF_TIMEOUT: Proof generation exceeded 30 second limit");
            }
            throw error;
        }
    }

    /**
     * Check if there is enough free memory to safely run a proof.
     * Prevents OOM crashes under high load (ZK5).
     * In development mode, only warn but allow proof generation to proceed.
     */
    private checkMemoryAvailability() {
        const freeMemoryMB = os.freemem() / 1024 / 1024;
        const totalMemoryMB = os.totalmem() / 1024 / 1024;

        // In development, use a much lower threshold (64MB) to allow testing
        const requiredMB = env.NODE_ENV === 'production' ? MIN_FREE_MEMORY_MB : 64;

        // Log memory stats occasionally or on low memory
        if (freeMemoryMB < requiredMB * 2) {
            logger.warn({ freeMemoryMB, totalMemoryMB, required: requiredMB }, "Low memory detected");
        }

        if (freeMemoryMB < requiredMB) {
            if (env.NODE_ENV === 'production') {
                throw new Error(`Insufficient free memory: ${Math.round(freeMemoryMB)}MB available, ${MIN_FREE_MEMORY_MB}MB required`);
            } else {
                // In development, warn but proceed (may be slow or fail)
                logger.warn({ freeMemoryMB, required: requiredMB }, 'Low memory in dev mode - proceeding anyway');
            }
        }
    }

    /**
     * checks if circuit files are healthy
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

        const checksumEntries = this.loadChecksumEntries();
        if (env.NODE_ENV === 'production' && checksumEntries.length === 0) {
            errors.push(`Circuit checksums are required in production: ${CHECKSUMS_FILE}`);
        }

        // Compare against known-good checksums from environment or the canonical checksum manifest.
        const expectedWasmHash = process.env.CIRCUIT_WASM_SHA256 || this.findChecksum(checksumEntries, CIRCUIT_WASM);
        const expectedZkeyHash = process.env.CIRCUIT_ZKEY_SHA256 || this.findChecksum(checksumEntries, CIRCUIT_ZKEY);
        const expectedVkeyHash = process.env.CIRCUIT_VKEY_SHA256 || this.findChecksum(checksumEntries, VERIFICATION_KEY);

        if (env.NODE_ENV === 'production') {
            if (!expectedWasmHash) {
                errors.push('Missing expected checksum for circuit WASM');
            }
            if (!expectedZkeyHash) {
                errors.push('Missing expected checksum for circuit ZKEY');
            }
            if (!expectedVkeyHash) {
                errors.push('Missing expected checksum for verification key');
            }
        }

        if (expectedWasmHash && checksums.wasm !== expectedWasmHash) {
            errors.push(`WASM checksum mismatch: expected ${expectedWasmHash}, got ${checksums.wasm}`);
        }
        if (expectedZkeyHash && checksums.zkey !== expectedZkeyHash) {
            errors.push(`ZKEY checksum mismatch: expected ${expectedZkeyHash}, got ${checksums.zkey}`);
        }
        if (expectedVkeyHash && checksums.vkey !== expectedVkeyHash) {
            errors.push(`Verification key checksum mismatch: expected ${expectedVkeyHash}, got ${checksums.vkey}`);
        }

        const result = {
            valid: errors.length === 0,
            checksums,
            errors
        };

        this.lastIntegrity = result;

        return result;
    }

    getCachedIntegrity(): { valid: boolean; checksums: { wasm: string; zkey: string; vkey: string }; errors: string[] } | null {
        return this.lastIntegrity;
    }

    private loadChecksumEntries(): Array<{ hash: string; file: string }> {
        if (!fs.existsSync(CHECKSUMS_FILE)) {
            return [];
        }

        const content = fs.readFileSync(CHECKSUMS_FILE, "utf-8");
        const entries: Array<{ hash: string; file: string }> = [];

        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;

            const parts = trimmed.split(/\s+/);
            if (parts.length < 2) continue;

            const hash = parts[0];
            const file = parts.slice(1).join(" ");
            entries.push({ hash, file: file.replace(/\\/g, "/") });
        }

        return entries;
    }

    private findChecksum(entries: Array<{ hash: string; file: string }>, targetPath: string): string | undefined {
        const normalizedTarget = targetPath.replace(/\\/g, "/");
        const targetName = path.posix.basename(normalizedTarget);

        for (const entry of entries) {
            const entryPath = entry.file;
            const entryName = path.posix.basename(entryPath);

            if (normalizedTarget.endsWith(entryPath) || entryPath.endsWith(normalizedTarget)) {
                return entry.hash;
            }

            if (entryName === targetName) {
                return entry.hash;
            }
        }

        return undefined;
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
