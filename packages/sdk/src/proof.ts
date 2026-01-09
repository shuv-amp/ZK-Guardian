/**
 * Proof Generator
 * 
 * Generates ZK proofs using snarkjs and the circuit artifacts.
 */

// @ts-ignore - snarkjs doesn't have types
import * as snarkjs from 'snarkjs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { formatProofForSolidity } from './utils';

export interface ProofInputs {
    patientId: string;
    clinicianId: string;
    resourceId?: string;
    resourceCategory?: string;
    consentHash?: string;
    validFrom?: number;
    validTo?: number;
    allowedCategories?: string[];
    timestamp: number;
    nullifier: bigint;
    sessionNonce: bigint;

    // Break-glass specific
    clinicianLicense?: string;
    facilityId?: string;
    emergencyCode?: number;
    justificationHash?: string;

    // V2 Merkle Proof Inputs
    credentialsMerkleRoot?: string;
    credentialPathElements?: string[];
    credentialPathIndices?: string[];
}

export interface ProofResult {
    proof: {
        pi_a: [string, string];
        pi_b: [[string, string], [string, string]];
        pi_c: [string, string];
    };
    publicSignals: string[];
    circuitType: string;
    generatedAt: number;

    // Formatted for Solidity
    solidityProof: {
        pA: [bigint, bigint];
        pB: [[bigint, bigint], [bigint, bigint]];
        pC: [bigint, bigint];
        pubSignals: bigint[];
    };
}

export interface ProofGeneratorOptions {
    timeout?: number;
    debug?: boolean;
}

export class ProofGenerator {
    private circuitsPath: string;
    private options: ProofGeneratorOptions;
    private loadedCircuits: Map<string, { wasm: Buffer; zkey: Buffer; vkey: any }> = new Map();

    constructor(circuitsPath: string, options: ProofGeneratorOptions = {}) {
        this.circuitsPath = circuitsPath;
        this.options = {
            timeout: 30000,
            debug: false,
            ...options
        };
    }

    /**
     * Load circuit artifacts
     */
    async loadCircuits(): Promise<void> {
        const circuits = ['AccessIsAllowed', 'AccessIsAllowedSecure', 'BreakGlass'];

        for (const circuit of circuits) {
            try {
                const wasmPath = join(this.circuitsPath, `${circuit}_js/${circuit}.wasm`);
                const zkeyPath = join(this.circuitsPath, `${circuit}_final.zkey`);
                const vkeyPath = join(this.circuitsPath, `${circuit}_verification_key.json`);

                const [wasm, zkey, vkeyRaw] = await Promise.all([
                    readFile(wasmPath),
                    readFile(zkeyPath),
                    readFile(vkeyPath, 'utf-8')
                ]);

                this.loadedCircuits.set(circuit, {
                    wasm,
                    zkey,
                    vkey: JSON.parse(vkeyRaw)
                });

                if (this.options.debug) {
                    console.log(`[ProofGenerator] Loaded circuit: ${circuit}`);
                }
            } catch (error) {
                if (this.options.debug) {
                    console.warn(`[ProofGenerator] Failed to load circuit ${circuit}:`, error);
                }
                // Not all circuits may be built yet, this is OK
            }
        }
    }

    /**
     * Generate a proof
     */
    async generate(circuitType: string, inputs: ProofInputs): Promise<ProofResult> {
        const circuit = this.loadedCircuits.get(circuitType);
        if (!circuit) {
            throw new Error(`Circuit not loaded: ${circuitType}`);
        }

        // Prepare circuit inputs based on type
        const circuitInputs = this.prepareInputs(circuitType, inputs);

        if (this.options.debug) {
            console.log(`[ProofGenerator] Generating ${circuitType} proof...`);
        }

        const startTime = Date.now();

        // Generate proof with timeout
        const proofPromise = snarkjs.groth16.fullProve(
            circuitInputs,
            circuit.wasm,
            circuit.zkey
        );

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Proof generation timeout')), this.options.timeout);
        });

        const { proof, publicSignals } = await Promise.race([proofPromise, timeoutPromise]);

        const duration = Date.now() - startTime;

        if (this.options.debug) {
            console.log(`[ProofGenerator] Proof generated in ${duration}ms`);
        }

        return {
            proof,
            publicSignals,
            circuitType,
            generatedAt: Date.now(),
            solidityProof: formatProofForSolidity(proof, publicSignals)
        };
    }

    /**
     * Verify a proof locally
     */
    async verify(proofResult: ProofResult): Promise<boolean> {
        const circuit = this.loadedCircuits.get(proofResult.circuitType);
        if (!circuit) {
            throw new Error(`Circuit not loaded: ${proofResult.circuitType}`);
        }

        return snarkjs.groth16.verify(
            circuit.vkey,
            proofResult.publicSignals,
            proofResult.proof
        );
    }

    /**
     * Prepare inputs for specific circuit type
     */
    private prepareInputs(circuitType: string, inputs: ProofInputs): Record<string, any> {
        const { splitId, poseidonHash } = require('./utils');

        switch (circuitType) {
            case 'AccessIsAllowed':
                return {
                    patientId: splitId(inputs.patientId),
                    clinicianId: splitId(inputs.clinicianId),
                    consentPolicyHash: BigInt(inputs.consentHash || '0'),
                    requestedResourceId: splitId(inputs.resourceId || ''),
                    allowedResourceCategories: this.padCategories(inputs.allowedCategories || [], 8),
                    validFromTimestamp: inputs.validFrom || 0,
                    validToTimestamp: inputs.validTo || 0,
                    proofOfPolicyMatch: BigInt(0), // Computed by circuit
                    currentTimestamp: inputs.timestamp,
                    accessEventHash: BigInt(0) // Computed by circuit
                };

            case 'AccessIsAllowedSecure':
                return {
                    patientId: splitId(inputs.patientId),
                    clinicianId: splitId(inputs.clinicianId),
                    consentPolicyHash: BigInt(inputs.consentHash || '0'),
                    requestedResourceId: splitId(inputs.resourceId || ''),
                    allowedResourceCategories: this.padCategories(inputs.allowedCategories || [], 8),
                    validFromTimestamp: inputs.validFrom || 0,
                    validToTimestamp: inputs.validTo || 0,
                    patientNullifier: inputs.nullifier,
                    sessionNonce: inputs.sessionNonce,
                    proofOfPolicyMatch: BigInt(0),
                    currentTimestamp: inputs.timestamp,
                    accessEventHash: BigInt(0)
                };

            case 'BreakGlass':
                return {
                    patientId: splitId(inputs.patientId),
                    clinicianId: splitId(inputs.clinicianId),
                    clinicianLicense: splitId(inputs.clinicianLicense || ''),
                    facilityId: splitId(inputs.facilityId || ''),
                    emergencyCode: inputs.emergencyCode || 0,
                    justificationHash: BigInt(inputs.justificationHash || '0'),
                    clinicianNullifier: inputs.nullifier,
                    sessionNonce: inputs.sessionNonce,
                    currentTimestamp: inputs.timestamp,
                    accessEventHash: BigInt(0),
                    emergencyThreshold: 1, // Minimum emergency level

                    // V2 Merkle Proof Inputs
                    credentialsMerkleRoot: BigInt(inputs.credentialsMerkleRoot || '0'),
                    credentialPathElements: (inputs.credentialPathElements || []).map(BigInt),
                    credentialPathIndices: (inputs.credentialPathIndices || []).map(Number) // Indices are 0/1
                };

            default:
                throw new Error(`Unknown circuit type: ${circuitType}`);
        }
    }

    /**
     * Pad category array to fixed length
     */
    private padCategories(categories: string[], length: number): bigint[] {
        const result: bigint[] = [];

        for (let i = 0; i < length; i++) {
            if (i < categories.length) {
                result.push(BigInt(categories[i]));
            } else {
                result.push(BigInt(0));
            }
        }

        return result;
    }
}
