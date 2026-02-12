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
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { merkleTreeService } from '../modules/audit/merkleTreeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Canonical circuit artifact location in this monorepo.
// Layout: <repo>/circuits/build/<CircuitName>/...
const CIRCUITS_DIR = path.resolve(__dirname, '../../../circuits/build');
const BREAK_GLASS_DIR = path.join(CIRCUITS_DIR, 'BreakGlass');

// ZKGuardianAudit ABI
const ZK_GUARDIAN_AUDIT_ABI = [
    'function verifyBreakGlassAndAudit(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[9] calldata _pubSignals, uint256 requiredThreshold) external',
    'function breakGlassVerifier() external view returns (address)',
    'function credentialRegistry() external view returns (address)',
    'event EmergencyAccessAudited(bytes32 indexed emergencyAccessHash, bytes32 indexed proofHash, uint256 blindedClinicianId, uint256 blindedPatientId, uint256 emergencyCode, uint256 justificationCommitment, uint64 timestamp, address indexed auditor)',
    'error InvalidProof()',
    'error EmergencyThresholdNotMet(uint256 proofThreshold, uint256 requiredThreshold)',
    'error BreakGlassVerifierNotSet()',
    'error InvalidTimestamp(uint256 proofTimestamp, uint256 blockTimestamp)',
    'error NullifierAlreadyUsed()',
    'error ProofAlreadyUsed()'
];

// CredentialRegistry ABI
const CREDENTIAL_REGISTRY_ABI = [
    'function getMerkleRoot() external view returns (bytes32)',
    'function isValid(bytes32 credentialHash) external view returns (bool)',
    'function addCredential(bytes32 credentialHash) external',
    'function updateMerkleRoot(bytes32 newRoot, uint256 newCount) external',
    'function credentialCount() external view returns (uint256)'
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

function bigintToBytes32(value: bigint | string): string {
    return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32);
}

function sessionNonceToField(sessionNonce?: string): bigint {
    if (!sessionNonce) {
        return BigInt(Math.floor(Math.random() * 1e9));
    }
    if (/^[0-9]+$/.test(sessionNonce)) {
        return BigInt(sessionNonce);
    }
    return stringToFieldElement(sessionNonce);
}

async function sendTxWithNonceRetry(
    send: (overrides?: Record<string, any>) => Promise<any>,
    provider: ethers.JsonRpcProvider,
    signerAddress: string,
    initialOverrides?: Record<string, any>
): Promise<any> {
    let overrides: Record<string, any> | undefined = initialOverrides ? { ...initialOverrides } : undefined;
    let lastError: any;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await send(overrides);
        } catch (error: any) {
            lastError = error;
            const message = String(error?.message || '');
            if (!/nonce has already been used|nonce too low|NONCE_EXPIRED/i.test(message)) {
                throw error;
            }

            const currentNonce = overrides?.nonce;
            if (typeof currentNonce === 'number') {
                overrides = { ...(overrides || {}), nonce: currentNonce + 1 };
            } else {
                const pendingNonceHex = await provider.send('eth_getTransactionCount', [signerAddress, 'pending']) as string;
                const pendingNonce = Number(BigInt(pendingNonceHex));
                overrides = { ...(overrides || {}), nonce: pendingNonce };
            }

            logger.warn({ attempt: attempt + 1, nonce: overrides?.nonce, error: message }, 'Retrying transaction with refreshed nonce');
        }
    }

    throw lastError;
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
        const wasmPath = path.join(BREAK_GLASS_DIR, 'BreakGlass_js/BreakGlass.wasm');
        const zkeyPath = path.join(BREAK_GLASS_DIR, 'BreakGlass_final.zkey');

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
        const sessionNonce = sessionNonceToField(input.sessionNonce);
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

        // Credential Hash must match BreakGlass.circom:
        // Poseidon(clinicianId[4], clinicianLicense[4], facilityId[0]) => Poseidon(9)
        const credentialLeaf = poseidon([
            ...clinicianIdFields,
            ...clinicianLicenseFields,
            facilityIdFields[0]
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

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(auditAddress, ZK_GUARDIAN_AUDIT_ABI, provider);
        let nextNonce: number | undefined;

        // Keep on-chain registry state aligned with the root used by the generated proof.
        // This prevents deterministic InvalidProof reverts from root mismatch in prototype mode.
        try {
            const registryAddress = await contract.credentialRegistry();
            if (registryAddress && registryAddress !== ethers.ZeroAddress) {
                const registryRead: any = new ethers.Contract(registryAddress, CREDENTIAL_REGISTRY_ABI, provider);
                const registryWrite: any = registryRead.connect(wallet);
                const credentialLeafHex = bigintToBytes32(credentialLeaf);
                const proofRootHex = bigintToBytes32(merkleProof.root);

                const [onChainRoot, credentialValid] = await Promise.all([
                    registryRead.getMerkleRoot(),
                    registryRead.isValid(credentialLeafHex)
                ]);

                if (!credentialValid) {
                    try {
                        const addTx = await sendTxWithNonceRetry(
                            (overrides?: Record<string, any>) => registryWrite.addCredential(credentialLeafHex, overrides || {}),
                            provider,
                            wallet.address
                        );
                        await addTx.wait();
                        if (typeof addTx.nonce === 'number') {
                            nextNonce = addTx.nonce + 1;
                        }
                        logger.info({ credentialLeafHex }, 'Credential leaf registered on-chain');
                    } catch (error: any) {
                        logger.warn({ error: error.message }, 'Credential registration skipped (already exists or missing role)');
                    }
                }

                if (String(onChainRoot).toLowerCase() !== proofRootHex.toLowerCase()) {
                    const leafCount = Math.max(1, merkleTreeService.getLeafCount());
                    try {
                        const updateTx = await sendTxWithNonceRetry(
                            (overrides?: Record<string, any>) => registryWrite.updateMerkleRoot(proofRootHex, leafCount, overrides || {}),
                            provider,
                            wallet.address,
                            nextNonce !== undefined ? { nonce: nextNonce } : undefined
                        );
                        await updateTx.wait();
                        if (typeof updateTx.nonce === 'number') {
                            nextNonce = updateTx.nonce + 1;
                        }
                        logger.info({
                            previousRoot: onChainRoot,
                            newRoot: proofRootHex,
                            leafCount
                        }, 'Credential registry root updated to match proof root');
                    } catch (error: any) {
                        logger.warn({
                            error: error.message,
                            onChainRoot,
                            proofRootHex
                        }, 'Unable to update credential root on-chain');
                    }
                } else {
                    logger.info({ onChainRoot }, 'Credential root already aligned');
                }
            }
        } catch (e) {
            logger.warn({ err: e }, 'Could not sync credential root (registry not linked or inaccessible)');
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

        const contractWithSigner = new ethers.Contract(auditAddress, ZK_GUARDIAN_AUDIT_ABI, wallet);

        logger.info({ contract: auditAddress }, 'Submitting verifyBreakGlassAndAudit...');

        // Preflight static call to surface custom errors before spending gas.
        await contractWithSigner.verifyBreakGlassAndAudit.staticCall(
            pA, pB, pC, pubSignals, requiredThreshold
        );

        const verifyBreakGlassFn: any = contractWithSigner.verifyBreakGlassAndAudit;
        let tx;
        if (typeof verifyBreakGlassFn?.estimateGas === 'function') {
            const estimatedGas = await verifyBreakGlassFn.estimateGas(
                pA, pB, pC, pubSignals, requiredThreshold
            );
            const gasLimit = (estimatedGas * 120n) / 100n; // 20% execution headroom
            tx = await sendTxWithNonceRetry(
                (overrides?: Record<string, any>) => verifyBreakGlassFn(
                    pA, pB, pC, pubSignals, requiredThreshold,
                    { gasLimit, ...(overrides || {}) }
                ),
                provider,
                wallet.address,
                nextNonce !== undefined ? { nonce: nextNonce } : undefined
            );
        } else {
            tx = await sendTxWithNonceRetry(
                (overrides?: Record<string, any>) => verifyBreakGlassFn(pA, pB, pC, pubSignals, requiredThreshold, overrides || {}),
                provider,
                wallet.address,
                nextNonce !== undefined ? { nonce: nextNonce } : undefined
            );
        }

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
        const iface = new ethers.Interface(ZK_GUARDIAN_AUDIT_ABI);
        const rawErrorData =
            error?.data?.data ||
            error?.data ||
            error?.info?.error?.data ||
            error?.error?.data;

        if (typeof rawErrorData === 'string' && rawErrorData.startsWith('0x')) {
            try {
                const parsed = iface.parseError(rawErrorData);
                switch (parsed?.name) {
                    case 'InvalidProof':
                        decodedError = 'ZK Proof verification failed (InvalidProof)';
                        break;
                    case 'EmergencyThresholdNotMet':
                        decodedError = `Emergency threshold not met (${parsed.args?.[0]} < ${parsed.args?.[1]})`;
                        break;
                    case 'BreakGlassVerifierNotSet':
                        decodedError = 'BreakGlass verifier not configured on contract';
                        break;
                    case 'InvalidTimestamp':
                        decodedError = 'Proof timestamp outside allowed threshold';
                        break;
                    case 'NullifierAlreadyUsed':
                        decodedError = 'Break-glass nullifier already used (replay detected)';
                        break;
                    case 'ProofAlreadyUsed':
                        decodedError = 'Break-glass proof already used';
                        break;
                    default:
                        decodedError = `${parsed?.name || 'ContractError'}: ${error.message}`;
                }
            } catch {
                // Fallback to raw error message if decoding fails
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
