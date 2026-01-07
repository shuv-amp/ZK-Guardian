/**
 * ZK Guardian Client
 * 
 * Main client for interacting with the ZK Guardian system.
 */

import { ProofGenerator, ProofInputs, ProofResult } from './proof';
import { ConsentHasher, FHIRConsent } from './consent';
import { NullifierManager } from './nullifier';
import { AuditContract, RevocationContract } from './contracts';
import { ethers } from 'ethers';

export interface ZKGuardianConfig {
    // Required
    circuitsPath: string;

    // Blockchain (optional for offline proof generation)
    provider?: ethers.Provider;
    signer?: ethers.Signer;
    auditContractAddress?: string;
    revocationContractAddress?: string;

    // Options
    proofTimeout?: number; // ms, default 30000
    debug?: boolean;
}

export class ZKGuardianClient {
    private config: ZKGuardianConfig;
    private proofGenerator: ProofGenerator;
    private consentHasher: ConsentHasher;
    private nullifierManager: NullifierManager;
    private auditContract?: AuditContract;
    private revocationContract?: RevocationContract;

    constructor(config: ZKGuardianConfig) {
        this.config = {
            proofTimeout: 30000,
            debug: false,
            ...config
        };

        this.proofGenerator = new ProofGenerator(config.circuitsPath, {
            timeout: this.config.proofTimeout,
            debug: this.config.debug
        });

        this.consentHasher = new ConsentHasher();
        this.nullifierManager = new NullifierManager();

        // Initialize contracts if blockchain config provided
        if (config.provider && config.auditContractAddress) {
            this.auditContract = new AuditContract(
                config.auditContractAddress,
                config.provider,
                config.signer
            );
        }

        if (config.provider && config.revocationContractAddress) {
            this.revocationContract = new RevocationContract(
                config.revocationContractAddress,
                config.provider,
                config.signer
            );
        }
    }

    /**
     * Initialize the client (load circuits, etc.)
     */
    async initialize(): Promise<void> {
        await this.proofGenerator.loadCircuits();

        if (this.config.debug) {
            console.log('[ZKGuardian] Client initialized');
        }
    }

    /**
     * Generate a consent verification proof
     */
    async generateConsentProof(params: {
        consent: FHIRConsent;
        patientId: string;
        clinicianId: string;
        resourceId: string;
        resourceCategory: string;
        timestamp?: number;
    }): Promise<ProofResult> {
        const timestamp = params.timestamp || Math.floor(Date.now() / 1000);

        // Hash the consent
        const consentHash = await this.consentHasher.hash(params.consent);

        // Get or create nullifier
        const nullifier = await this.nullifierManager.getOrCreate(params.patientId);

        // Prepare inputs
        const inputs: ProofInputs = {
            patientId: params.patientId,
            clinicianId: params.clinicianId,
            resourceId: params.resourceId,
            resourceCategory: params.resourceCategory,
            consentHash: consentHash.hash,
            validFrom: consentHash.validFrom,
            validTo: consentHash.validTo,
            allowedCategories: consentHash.categories,
            timestamp,
            nullifier: nullifier.value,
            sessionNonce: this.generateNonce()
        };

        // Generate proof
        return this.proofGenerator.generate('AccessIsAllowedSecure', inputs);
    }

    /**
     * Generate an emergency break-glass proof
     */
    async generateBreakGlassProof(params: {
        patientId: string;
        clinicianId: string;
        clinicianLicense: string;
        facilityId: string;
        emergencyCode: number;
        justification: string;
        timestamp?: number;
    }): Promise<ProofResult> {
        const timestamp = params.timestamp || Math.floor(Date.now() / 1000);

        // Get nullifier for blinding
        const nullifier = await this.nullifierManager.getOrCreate(`clinician:${params.clinicianId}`);

        // Hash justification
        const justificationHash = await this.consentHasher.hashString(params.justification);

        const inputs: ProofInputs = {
            patientId: params.patientId,
            clinicianId: params.clinicianId,
            clinicianLicense: params.clinicianLicense,
            facilityId: params.facilityId,
            emergencyCode: params.emergencyCode,
            justificationHash,
            timestamp,
            nullifier: nullifier.value,
            sessionNonce: this.generateNonce()
        };

        return this.proofGenerator.generate('BreakGlass', inputs);
    }

    /**
     * Verify and submit a proof to the blockchain
     */
    async submitProof(proof: ProofResult): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }> {
        if (!this.auditContract) {
            return { success: false, error: 'Audit contract not configured' };
        }

        return this.auditContract.verifyAndAudit(proof);
    }

    /**
     * Revoke a consent on-chain
     */
    async revokeConsent(consentHash: string, reason: string): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }> {
        if (!this.revocationContract) {
            return { success: false, error: 'Revocation contract not configured' };
        }

        return this.revocationContract.revoke(consentHash, reason);
    }

    /**
     * Check if a consent is revoked
     */
    async isConsentRevoked(consentHash: string): Promise<boolean> {
        if (!this.revocationContract) {
            throw new Error('Revocation contract not configured');
        }

        return this.revocationContract.isRevoked(consentHash);
    }

    /**
     * Hash a FHIR Consent resource
     */
    async hashConsent(consent: FHIRConsent) {
        return this.consentHasher.hash(consent);
    }

    /**
     * Get access history for a patient (from on-chain events)
     */
    async getAccessHistory(patientBlindedId: string, options?: {
        startBlock?: number;
        endBlock?: number;
    }) {
        if (!this.auditContract) {
            throw new Error('Audit contract not configured');
        }

        return this.auditContract.getAccessEvents(patientBlindedId, options);
    }

    /**
     * Verify a proof locally (without submitting)
     */
    async verifyProofLocally(proof: ProofResult): Promise<boolean> {
        return this.proofGenerator.verify(proof);
    }

    /**
     * Export nullifier for backup
     */
    async exportNullifier(patientId: string, encryptionKey: string): Promise<string> {
        return this.nullifierManager.export(patientId, encryptionKey);
    }

    /**
     * Import nullifier from backup
     */
    async importNullifier(encryptedData: string, encryptionKey: string): Promise<boolean> {
        return this.nullifierManager.import(encryptedData, encryptionKey);
    }

    /**
     * Generate a random nonce for session binding
     */
    private generateNonce(): bigint {
        const bytes = new Uint8Array(31); // Fit in field element
        crypto.getRandomValues(bytes);
        return BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    }
}
