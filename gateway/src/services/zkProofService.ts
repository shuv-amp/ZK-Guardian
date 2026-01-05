const snarkjs = require("snarkjs");
import axios from "axios";
import path from "path";
import {
    hashFhirConsent,
    prepareCircuitInputs,
    stringToFieldElement,
    initPoseidon,
    CircuitInputs
} from "../utils/fhirToPoseidon.js";

// In production, these should be environment variables or copied to build dir
// For monorepo dev, we point to the siblings
const CIRCUITS_BUILD_DIR = path.resolve(__dirname, "../../../circuits/build");
const CIRCUIT_WASM = path.join(CIRCUITS_BUILD_DIR, "AccessIsAllowed_js/AccessIsAllowed.wasm");
const CIRCUIT_ZKEY = path.join(CIRCUITS_BUILD_DIR, "AccessIsAllowed_final.zkey");

const HAPI_FHIR_URL = process.env.HAPI_FHIR_URL || "http://localhost:8080/fhir";

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
    private snarkjs: any = require("snarkjs");

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

        console.log(`[ZK] Generating proof for ${resourceType} access...`);

        // 3. Generate Proof
        const { proof, publicSignals } = await this.snarkjs.groth16.fullProve(inputs, CIRCUIT_WASM, CIRCUIT_ZKEY);
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
                headers: { Accept: "application/fhir+json" }
            });

            const bundle = response.data;
            if (!bundle.entry || bundle.entry.length === 0) {
                return null;
            }

            return bundle.entry[0].resource;
        } catch (error: any) {
            console.warn(`[ZK] Failed to fetch consent for ${patientId}: ${error.message}`);
            // For DEV mode only: return a mock consent if connection fails?
            // "Super reasoning": NO. High stake. If fetch fails, we fail.
            // Exception: If HAPI is not running yet during this *test* phase, maybe mock?
            // User did not ask to mock. Stick to real implementation.
            throw new Error("FHIR_FETCH_FAILED");
        }
    }

    private computeProofHash(proof: any): string {
        const data = JSON.stringify(proof);
        return stringToFieldElement(data); // Returns numeric string but that's fine for unique ID?
        // Actually blueprint used this.stringToFieldElement(data).toString(16)
        // Sol contract expects bytes32 proofHash = keccak256(...)
        // We can just send a string hash here for our own tracking logs.
    }
}

export const zkProofService = new ZKProofService();
