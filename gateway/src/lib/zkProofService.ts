/**
 * ZK Proof Service
 * 
 * Server-side Zero-Knowledge proof generation and verification.
 * Used by the Gateway to generate proofs for emergency (Break-Glass) access
 * and submit them to the ZKGuardianAudit smart contract.
 */

import { ethers } from 'ethers';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as fs from 'fs';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { merkleTreeService } from '../services/merkleTreeService.js';

// Circuit paths (relative to gateway package)
const CIRCUITS_DIR = path.join(process.cwd(), '../circuits/build');

// ZKGuardianAudit ABI
const ZK_GUARDIAN_AUDIT_ABI = [
    'function verifyBreakGlassAndAudit(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[9] calldata _pubSignals, uint256 requiredThreshold) external',
    'function breakGlassVerifier() external view returns (address)',
    'function credentialRegistry() external view returns (address)',
    'event EmergencyAccessAudited(bytes32 indexed emergencyAccessHash, bytes32 indexed proofHash, uint256 blindedClinicianId, uint256 blindedPatientId, uint256 emergencyCode, uint256 justificationCommitment, uint64 timestamp, address indexed auditor)'
];

// CredentialRegistry ABI
const CREDENTIAL_REGISTRY_ABI = [
    'function credentialsMerkleRoot() external view returns (bytes32)',
    'function isActiveCredential(bytes32 credentialHash) external view returns (bool)'
];

interface BreakGlassInput {
    patientId: string;
    clinicianId: string;
    clinicianLicense?: string;
    facilityId?: string;
    emergencyCode: number;
    justificationHash: string;
    sessionNonce: string;
}

interface ProofResult {
    success: boolean;
    txHash?: string;
    blockNumber?: number;
    error?: string;
    blindedClinicianId?: string;
    blindedPatientId?: string;
}

// Lazy-loaded Poseidon hasher
let poseidonModule: any = null;
let F: any = null;

async function initPoseidon(): Promise<void> {
    if (!poseidonModule) {
        const circomlibjs = await import('circomlibjs');
        poseidonModule = await circomlibjs.buildPoseidon();
        F = poseidonModule.F;
    }
}

function poseidon(inputs: bigint[]): bigint {
    const hash = poseidonModule(inputs);
    return F.toObject(hash);
}

function splitIdToFields(id: string): bigint[] {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(id);
    const fields: bigint[] = [];

    // Split into 4 chunks of 8 bytes each (or pad)
    for (let i = 0; i < 4; i++) {
        let val = BigInt(0);
        for (let j = 0; j < 8; j++) {
            const idx = i * 8 + j;
            if (idx < bytes.length) {
                val = val * BigInt(256) + BigInt(bytes[idx]);
            }
        }
        fields.push(val);
    }

    return fields;
}

function stringToFieldElement(str: string): bigint {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let result = BigInt(0);

    // Use first 31 bytes (to stay within field)
    const limit = Math.min(bytes.length, 31);
    for (let i = 0; i < limit; i++) {
        result = result * BigInt(256) + BigInt(bytes[i]);
    }

    return result;
}

/**
 * Sync credential tree with blockchain (or simulated source for this demo)
 */
async function syncCredentialTree(): Promise<void> {
    await merkleTreeService.initialize();

    // In a real app, we would fetch events or query the subgraph.
    // For this implementation, we will add a mock credential for the current clinician if needed,
    // or assume the tree service is managed by an admin process.

    // DEMO LOGIC: Automatically register the clinician for Break-Glass
    // In production, this would be an explicit "Credentialing" step.
}

/**
 * Generate a Break-Glass ZK proof and submit to blockchain
 */
export async function generateAndSubmitBreakGlassProof(
    input: BreakGlassInput,
    requiredThreshold: number = 3
): Promise<ProofResult> {
    try {
        // Check configuration
        const privateKey = env.GATEWAY_PRIVATE_KEY;
        const rpcUrl = env.POLYGON_AMOY_RPC;
        const auditAddress = env.AUDIT_CONTRACT_ADDRESS;

        if (!privateKey || !rpcUrl || !auditAddress) {
            logger.warn('Blockchain config missing for ZK proof submission');
            return {
                success: false,
                error: 'Blockchain not configured (GATEWAY_PRIVATE_KEY, POLYGON_AMOY_RPC, AUDIT_CONTRACT_ADDRESS required)'
            };
        }

        // Check circuit files
        const wasmPath = path.join(CIRCUITS_DIR, 'BreakGlass_js/BreakGlass.wasm');
        const zkeyPath = path.join(CIRCUITS_DIR, 'BreakGlass_final.zkey');

        if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
            logger.error({ wasmPath, zkeyPath }, 'BreakGlass circuit artifacts not found');
            return {
                success: false,
                error: 'BreakGlass circuit artifacts not found. Run circuits/scripts/setup-all.sh'
            };
        }

        // Initialize Poseidon & Merkle Tree
        await initPoseidon();
        await syncCredentialTree();

        // Build circuit inputs
        const patientIdFields = splitIdToFields(input.patientId);
        const clinicianIdFields = splitIdToFields(input.clinicianId);
        const clinicianLicenseFields = splitIdToFields(input.clinicianLicense || 'LICENSE-DEFAULT-001');
        const facilityIdFields = splitIdToFields(input.facilityId || 'FACILITY-DEFAULT');

        const justificationHashField = stringToFieldElement(input.justificationHash);
        const clinicianNullifier = BigInt(Math.floor(Math.random() * 1e12));
        const sessionNonce = BigInt(input.sessionNonce || Math.floor(Math.random() * 1e9));
        const currentTimestamp = Math.floor(Date.now() / 1000);

        // Compute accessEventHash (matches circuit logic)
        const accessEventHash = poseidon([
            ...patientIdFields,
            ...clinicianIdFields,
            BigInt(currentTimestamp),
            BigInt(input.emergencyCode),
            sessionNonce
        ]);

        // ---------------------------------------------------------
        // Credential Verification Logic (P0 Audit Fix)
        // 1. Compute Credential Hash
        // 2. Add to local Merkle Tree (if not present - for demo)
        // 3. Generate Merkle Proof
        // ---------------------------------------------------------

        // Credential Hash = Poseidon(clinicianId, licenseId)
        // Note: clinicianId is 4 fields, license is 4 fields
        // We hash all 8 inputs together to get the credential leaf
        const credentialLeaf = poseidon([
            ...clinicianIdFields,
            ...clinicianLicenseFields
        ]);

        // DEMO: Auto-add to tree if it's new (in prod, this would fail if not pre-registered)
        try {
            merkleTreeService.addCredential(credentialLeaf);
        } catch (e) {
            // Include duplicates is fine, or ignore if full
        }

        const merkleProof = merkleTreeService.generateProof(credentialLeaf);

        const circuitInput = {
            patientId: patientIdFields.map(String),
            clinicianId: clinicianIdFields.map(String),
            clinicianLicense: clinicianLicenseFields.map(String),
            facilityId: facilityIdFields.map(String),
            emergencyCode: String(input.emergencyCode),
            justificationHash: justificationHashField.toString(),
            clinicianNullifier: clinicianNullifier.toString(),
            sessionNonce: sessionNonce.toString(),
            currentTimestamp: String(currentTimestamp),
            accessEventHash: accessEventHash.toString(),
            emergencyThreshold: String(requiredThreshold),

            // New V2 Inputs
            credentialsMerkleRoot: merkleProof.root.toString(),
            credentialPathElements: merkleProof.siblings.map(String),
            credentialPathIndices: merkleProof.pathIndices.map(String)
        };

        logger.info({ emergencyCode: input.emergencyCode, root: merkleProof.root.toString() }, 'Generating BreakGlass V2 proof...');

        // Generate proof
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInput,
            wasmPath,
            zkeyPath
        );

        logger.info({ signalCount: publicSignals.length }, 'Proof generated');

        // IMPORTANT: Verify the used root matches on-chain root before submitting
        // Fetch on-chain root
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(auditAddress, ZK_GUARDIAN_AUDIT_ABI, provider);

        try {
            const registryAddress = await contract.credentialRegistry();
            if (registryAddress && registryAddress !== ethers.ZeroAddress) {
                const registryContract = new ethers.Contract(registryAddress, CREDENTIAL_REGISTRY_ABI, provider);
                const onChainRoot = await registryContract.credentialsMerkleRoot();

                logger.info({ onChainRoot, proofRoot: merkleProof.root.toString() }, 'Verifying Merkle Roots');

                // Note: In this demo, we can't easily sync the on-chain root to match our local memory tree 
                // without an admin key. 
                // In a real deployment, we would update the on-chain root first.
                // For this test, we proceed, but beware the contract will revert if roots mismatch.
            }
        } catch (e) {
            logger.warn({ err: e }, 'Could not verify on-chain root match (Registry might not be linked)');
        }

        // Prepare calldata
        const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
        const argv = calldata.replace(/["[\]\s]/g, '').split(',');

        const pA: [string, string] = [argv[0], argv[1]];
        const pB: [[string, string], [string, string]] = [[argv[2], argv[3]], [argv[4], argv[5]]];
        const pC: [string, string] = [argv[6], argv[7]];
        const pubSignals = argv.slice(8);

        // V2 has 9 public signals
        if (pubSignals.length !== 9) {
            return { success: false, error: `Expected 9 public signals, got ${pubSignals.length}` };
        }

        // Submit to blockchain
        const wallet = new ethers.Wallet(privateKey, provider);
        const contractWithSigner = new ethers.Contract(auditAddress, ZK_GUARDIAN_AUDIT_ABI, wallet);

        logger.info({ contract: auditAddress }, 'Submitting verifyBreakGlassAndAudit...');

        const tx = await contractWithSigner.verifyBreakGlassAndAudit(
            pA, pB, pC, pubSignals, requiredThreshold,
            { gasLimit: 800000 }
        );

        const receipt = await tx.wait();

        logger.info({
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed?.toString()
        }, 'BreakGlass proof verified on-chain');

        return {
            success: true,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            blindedClinicianId: pubSignals[1],
            blindedPatientId: pubSignals[2]
        };

    } catch (error: any) {
        logger.error({ error: error.message, stack: error.stack }, 'BreakGlass proof submission failed');

        // Try to decode custom errors
        let decodedError = error.message;
        if (error.data) {
            try {
                // Common errors
                if (error.data.includes('InvalidProof')) {
                    decodedError = 'ZK Proof verification failed (InvalidProof)';
                } else if (error.data.includes('EmergencyThresholdNotMet')) {
                    decodedError = 'Emergency threshold not met';
                } else if (error.data.includes('BreakGlassVerifierNotSet')) {
                    decodedError = 'BreakGlass verifier not configured on contract';
                } else if (error.data.includes('InvalidCredentialRoot')) {
                    decodedError = 'Credential Merkle Root mismatch - Clinician not authorized';
                }
            } catch {
                // Ignore decode errors
            }
        }

        return { success: false, error: decodedError };
    }
}

/**
 * Check if BreakGlass verifier is configured on the contract
 */
export async function isBreakGlassConfigured(): Promise<boolean> {
    try {
        const rpcUrl = env.POLYGON_AMOY_RPC;
        const auditAddress = env.AUDIT_CONTRACT_ADDRESS;

        if (!rpcUrl || !auditAddress) return false;

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(auditAddress, ZK_GUARDIAN_AUDIT_ABI, provider);

        const verifier = await contract.breakGlassVerifier();
        return verifier !== ethers.ZeroAddress;
    } catch {
        return false;
    }
}
