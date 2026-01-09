/**
 * Consent Revocation Checker
 * 
 * Verifies consent has not been revoked on-chain before accepting ZK proofs.
 * Per SECURITY_AUDIT_CHECKLIST.md H5 and Technical Blueprint Section 11.
 * 
 * CRITICAL: This check MUST be performed before accepting any ZK proof
 * to ensure real-time consent revocation takes effect.
 */

import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// ConsentRevocationRegistry ABI (minimal interface)
const REVOCATION_REGISTRY_ABI = [
    'function isRevoked(bytes32 consentHash) external view returns (bool)',
    'function revokedConsents(bytes32 consentHash) external view returns (uint64)',
    'function batchCheckRevoked(bytes32[] calldata hashes) external view returns (bool[] memory)'
];

let provider: ethers.JsonRpcProvider | null = null;
let revocationContract: ethers.Contract | null = null;

/**
 * Initialize the revocation checker
 */
function getContract(): ethers.Contract | null {
    if (!env.CONSENT_REVOCATION_REGISTRY_ADDRESS) {
        logger.warn('CONSENT_REVOCATION_REGISTRY_ADDRESS not configured - revocation checks disabled');
        return null;
    }

    if (!revocationContract) {
        const rpcUrl = env.POLYGON_AMOY_RPC || 'https://rpc-amoy.polygon.technology';
        provider = new ethers.JsonRpcProvider(rpcUrl);
        revocationContract = new ethers.Contract(
            env.CONSENT_REVOCATION_REGISTRY_ADDRESS,
            REVOCATION_REGISTRY_ABI,
            provider
        );
    }

    return revocationContract;
}

/**
 * Check if a consent has been revoked on-chain
 * 
 * @param consentHash - The Poseidon hash of the consent resource
 * @returns true if consent is NOT revoked (valid), false if revoked
 * @throws Error if revoked or check fails
 */
export async function checkConsentNotRevoked(consentHash: string): Promise<boolean> {
    const contract = getContract();

    if (!contract) {
        // In development without revocation contract, skip check with warning
        if (env.NODE_ENV !== 'production') {
            logger.warn({ consentHash }, 'Revocation check skipped - contract not configured');
            return true;
        }
        throw new Error('REVOCATION_CHECK_UNAVAILABLE');
    }

    try {
        // Convert to bytes32 format
        const consentHashBytes = ethers.zeroPadValue(
            ethers.toBeHex(BigInt(consentHash)),
            32
        );

        const isRevoked = await contract.isRevoked(consentHashBytes);

        if (isRevoked) {
            logger.warn({ consentHash }, 'Consent has been revoked on-chain');
            throw new Error('CONSENT_REVOKED');
        }

        logger.debug({ consentHash: consentHash.slice(0, 16) + '...' }, 'Consent revocation check passed');
        return true;

    } catch (error: any) {
        if (error.message === 'CONSENT_REVOKED') {
            throw error;
        }

        // In development, provide clearer error messages
        if (env.NODE_ENV !== 'production') {
            // Contract call failed - likely wrong contract or missing function
            const isContractMismatch = error.message?.includes('require(false)') ||
                error.message?.includes('execution reverted');

            if (isContractMismatch) {
                logger.debug({
                    consentHash: consentHash.slice(0, 16) + '...',
                    hint: 'Revocation registry may not be deployed or configured separately from audit contract'
                }, 'Revocation check skipped (contract mismatch in dev mode)');
            } else {
                logger.warn({ error: error.message }, 'Revocation check failed (dev mode) - proceeding');
            }
            return true; // Allow in dev mode
        }

        logger.error({ error: error.message, consentHash }, 'Failed to check consent revocation');
        throw new Error('REVOCATION_CHECK_FAILED');
    }
}

/**
 * Batch check multiple consents for revocation
 * Returns map of consentHash -> isRevoked
 */
export async function batchCheckRevocations(
    consentHashes: string[]
): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const contract = getContract();

    if (!contract || consentHashes.length === 0) {
        return results;
    }

    try {
        const hashBytes = consentHashes.map(hash =>
            ethers.zeroPadValue(ethers.toBeHex(BigInt(hash)), 32)
        );

        const revocationStatuses = await contract.batchCheckRevoked(hashBytes);

        for (let i = 0; i < consentHashes.length; i++) {
            results.set(consentHashes[i], revocationStatuses[i]);
        }

        return results;

    } catch (error: any) {
        logger.error({ error: error.message }, 'Batch revocation check failed');
        return results;
    }
}

/**
 * Get revocation timestamp for a consent (0 if not revoked)
 */
export async function getRevocationTimestamp(consentHash: string): Promise<number> {
    const contract = getContract();

    if (!contract) {
        return 0;
    }

    try {
        const consentHashBytes = ethers.zeroPadValue(
            ethers.toBeHex(BigInt(consentHash)),
            32
        );

        const timestamp = await contract.revokedConsents(consentHashBytes);
        return Number(timestamp);

    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get revocation timestamp');
        return 0;
    }
}
