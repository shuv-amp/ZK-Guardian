/**
 * Contract Interaction
 * 
 * Utilities for interacting with ZK Guardian smart contracts.
 */

import { ethers, Contract, Provider, Signer, ContractTransactionResponse } from 'ethers';
import { ProofResult } from './proof';

// ABI fragments for the contracts
const AUDIT_ABI = [
    'function verifyAndAudit(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[4] calldata _pubSignals) external',
    'function batchVerifyAndAudit(uint256[2][] calldata _pAs, uint256[2][2][] calldata _pBs, uint256[2][] calldata _pCs, uint256[4][] calldata _pubSignals) external',
    'function verifiedProofs(bytes32) external view returns (bool)',
    'function accessTimestamps(uint256) external view returns (uint256)',
    'event AccessAudited(bytes32 indexed proofHash, uint256 accessHash, uint256 policyMatch, uint256 timestamp)'
];

const REVOCATION_ABI = [
    'function revokeConsent(bytes32 consentHash, string calldata reason) external',
    'function restoreConsent(bytes32 consentHash) external',
    'function isRevoked(bytes32 consentHash) external view returns (bool)',
    'function checkConsents(bytes32[] calldata consentHashes) external view returns (bool[] memory)',
    'event ConsentRevoked(bytes32 indexed consentHash, address indexed revoker, string reason, uint256 timestamp)',
    'event ConsentRestored(bytes32 indexed consentHash, address indexed restorer, uint256 timestamp)'
];

export interface AuditEvent {
    proofHash: string;
    accessHash: string;
    policyMatch: string;
    timestamp: number;
    txHash: string;
    blockNumber: number;
}

export interface RevocationEvent {
    consentHash: string;
    revoker: string;
    reason: string;
    timestamp: number;
    txHash: string;
}

export class AuditContract {
    private contract: Contract;
    private signer?: Signer;

    constructor(address: string, provider: Provider, signer?: Signer) {
        this.contract = new Contract(address, AUDIT_ABI, signer || provider);
        this.signer = signer;
    }

    /**
     * Submit a proof for verification and audit
     */
    async verifyAndAudit(proof: ProofResult): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }> {
        if (!this.signer) {
            return { success: false, error: 'No signer provided' };
        }

        try {
            const { pA, pB, pC, pubSignals } = proof.solidityProof;

            const tx: ContractTransactionResponse = await this.contract.verifyAndAudit(
                pA,
                pB,
                pC,
                pubSignals
            );

            const receipt = await tx.wait();

            return {
                success: true,
                txHash: receipt?.hash
            };
        } catch (error: any) {
            return {
                success: false,
                error: this.parseError(error)
            };
        }
    }

    /**
     * Submit multiple proofs in a batch
     */
    async batchVerifyAndAudit(proofs: ProofResult[]): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }> {
        if (!this.signer) {
            return { success: false, error: 'No signer provided' };
        }

        try {
            const pAs = proofs.map(p => p.solidityProof.pA);
            const pBs = proofs.map(p => p.solidityProof.pB);
            const pCs = proofs.map(p => p.solidityProof.pC);
            const pubSignals = proofs.map(p => p.solidityProof.pubSignals);

            const tx: ContractTransactionResponse = await this.contract.batchVerifyAndAudit(
                pAs,
                pBs,
                pCs,
                pubSignals
            );

            const receipt = await tx.wait();

            return {
                success: true,
                txHash: receipt?.hash
            };
        } catch (error: any) {
            return {
                success: false,
                error: this.parseError(error)
            };
        }
    }

    /**
     * Check if a proof has been verified
     */
    async isProofVerified(proofHash: string): Promise<boolean> {
        return this.contract.verifiedProofs(proofHash);
    }

    /**
     * Get access events for a patient (by blinded ID)
     */
    async getAccessEvents(
        patientBlindedId: string,
        options?: { startBlock?: number; endBlock?: number }
    ): Promise<AuditEvent[]> {
        const filter = this.contract.filters.AccessAudited();

        const events = await this.contract.queryFilter(
            filter,
            options?.startBlock || 0,
            options?.endBlock || 'latest'
        );

        return events.map(event => {
            const parsed = this.contract.interface.parseLog({
                topics: event.topics as string[],
                data: event.data
            });

            return {
                proofHash: parsed?.args[0],
                accessHash: parsed?.args[1].toString(),
                policyMatch: parsed?.args[2].toString(),
                timestamp: Number(parsed?.args[3]),
                txHash: event.transactionHash,
                blockNumber: event.blockNumber
            };
        });
    }

    private parseError(error: any): string {
        const message = error?.message || '';

        if (message.includes('InvalidProof')) {
            return 'Invalid ZK proof';
        }
        if (message.includes('ProofAlreadyUsed')) {
            return 'Proof has already been submitted';
        }
        if (message.includes('TimestampTooOld')) {
            return 'Proof timestamp is too old';
        }
        if (message.includes('insufficient funds')) {
            return 'Insufficient funds for transaction';
        }

        return message;
    }
}

export class RevocationContract {
    private contract: Contract;
    private signer?: Signer;

    constructor(address: string, provider: Provider, signer?: Signer) {
        this.contract = new Contract(address, REVOCATION_ABI, signer || provider);
        this.signer = signer;
    }

    /**
     * Revoke a consent
     */
    async revoke(consentHash: string, reason: string): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }> {
        if (!this.signer) {
            return { success: false, error: 'No signer provided' };
        }

        try {
            const tx: ContractTransactionResponse = await this.contract.revokeConsent(
                consentHash,
                reason
            );

            const receipt = await tx.wait();

            return {
                success: true,
                txHash: receipt?.hash
            };
        } catch (error: any) {
            return {
                success: false,
                error: this.parseError(error)
            };
        }
    }

    /**
     * Restore a revoked consent
     */
    async restore(consentHash: string): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }> {
        if (!this.signer) {
            return { success: false, error: 'No signer provided' };
        }

        try {
            const tx: ContractTransactionResponse = await this.contract.restoreConsent(
                consentHash
            );

            const receipt = await tx.wait();

            return {
                success: true,
                txHash: receipt?.hash
            };
        } catch (error: any) {
            return {
                success: false,
                error: this.parseError(error)
            };
        }
    }

    /**
     * Check if a consent is revoked
     */
    async isRevoked(consentHash: string): Promise<boolean> {
        return this.contract.isRevoked(consentHash);
    }

    /**
     * Check multiple consents
     */
    async checkMultiple(consentHashes: string[]): Promise<boolean[]> {
        return this.contract.checkConsents(consentHashes);
    }

    /**
     * Get revocation events
     */
    async getRevocationEvents(options?: {
        startBlock?: number;
        endBlock?: number;
    }): Promise<RevocationEvent[]> {
        const filter = this.contract.filters.ConsentRevoked();

        const events = await this.contract.queryFilter(
            filter,
            options?.startBlock || 0,
            options?.endBlock || 'latest'
        );

        return events.map(event => {
            const parsed = this.contract.interface.parseLog({
                topics: event.topics as string[],
                data: event.data
            });

            return {
                consentHash: parsed?.args[0],
                revoker: parsed?.args[1],
                reason: parsed?.args[2],
                timestamp: Number(parsed?.args[3]),
                txHash: event.transactionHash
            };
        });
    }

    private parseError(error: any): string {
        const message = error?.message || '';

        if (message.includes('ConsentAlreadyRevoked')) {
            return 'Consent has already been revoked';
        }
        if (message.includes('ConsentNotRevoked')) {
            return 'Consent is not revoked';
        }
        if (message.includes('NotAuthorized')) {
            return 'Not authorized to perform this action';
        }
        if (message.includes('insufficient funds')) {
            return 'Insufficient funds for transaction';
        }

        return message;
    }
}
