import * as SecureStore from 'expo-secure-store';
import { ethers, Contract } from 'ethers';
import { config } from '../config/env';
import { NullifierManager } from './NullifierManager';

/**
 * ConsentRevocationService
 * 
 * Handles on-chain consent revocation from the mobile app.
 * Per Technical Blueprint §11.2.
 * 
 * Features:
 * - Revoke individual consents
 * - Batch revocation
 * - Query revocation status
 * - Emergency revoke-all
 */

const WALLET_KEY = 'zk_guardian_patient_wallet';
const REVOCATION_REGISTRY_ABI = [
    'function revokeConsent(bytes32 consentHash, string calldata reason) external',
    'function restoreConsent(bytes32 consentHash) external',
    'function isRevoked(bytes32 consentHash) external view returns (bool)',
    'function checkConsents(bytes32[] calldata consentHashes) external view returns (bool[] memory)',
    'function getRevokerRole() external pure returns (bytes32)',
    'event ConsentRevoked(bytes32 indexed consentHash, address indexed revoker, string reason, uint256 timestamp)',
    'event ConsentRestored(bytes32 indexed consentHash, address indexed restorer, uint256 timestamp)'
];

export interface ConsentRevocationResult {
    success: boolean;
    txHash?: string;
    error?: string;
}

export interface ConsentStatus {
    consentHash: string;
    isRevoked: boolean;
    revokedAt?: Date;
    reason?: string;
}

export class ConsentRevocationService {
    private wallet: ethers.Wallet | ethers.HDNodeWallet | null = null;
    private provider: ethers.JsonRpcProvider | null = null;
    private contract: Contract | null = null;

    /**
     * Initialize the service with blockchain connection
     */
    async initialize(): Promise<boolean> {
        try {
            // Setup provider
            if (!config.polygonRpcUrl) {
                console.warn('[ConsentRevocation] Polygon RPC not configured');
                return false;
            }

            this.provider = new ethers.JsonRpcProvider(config.polygonRpcUrl);

            // Load or create wallet
            await this.loadOrCreateWallet();

            // Setup contract
            if (!config.revocationRegistryAddress) {
                console.warn('[ConsentRevocation] Revocation registry address not configured');
                return false;
            }

            this.contract = new Contract(
                config.revocationRegistryAddress,
                REVOCATION_REGISTRY_ABI,
                this.wallet
            );

            console.log('[ConsentRevocation] Service initialized');
            return true;
        } catch (error) {
            console.error('[ConsentRevocation] Initialization failed:', error);
            return false;
        }
    }

    /**
     * Load existing wallet or create a new one
     */
    private async loadOrCreateWallet(): Promise<void> {
        try {
            const storedKey = await SecureStore.getItemAsync(WALLET_KEY);

            if (storedKey) {
                this.wallet = new ethers.Wallet(storedKey, this.provider!);
                console.log('[ConsentRevocation] Loaded existing wallet');
            } else {
                // Create new wallet
                const newWallet = ethers.Wallet.createRandom();
                await SecureStore.setItemAsync(WALLET_KEY, newWallet.privateKey);
                this.wallet = newWallet.connect(this.provider!);
                console.log('[ConsentRevocation] Created new wallet');
            }

            console.log('[ConsentRevocation] Wallet address:', this.wallet.address);
        } catch (error) {
            console.error('[ConsentRevocation] Wallet setup failed:', error);
            throw error;
        }
    }

    /**
     * Get the patient's wallet address
     */
    getWalletAddress(): string | null {
        return this.wallet?.address || null;
    }

    /**
     * Get wallet balance
     */
    async getBalance(): Promise<string> {
        if (!this.wallet || !this.provider) {
            return '0';
        }
        const balance = await this.provider.getBalance(this.wallet.address);
        return ethers.formatEther(balance);
    }

    /**
     * Revoke a single consent
     */
    async revokeConsent(
        consentHash: string,
        reason: string
    ): Promise<ConsentRevocationResult> {
        if (!this.contract || !this.wallet) {
            return { success: false, error: 'Service not initialized' };
        }

        try {
            console.log('[ConsentRevocation] Revoking consent:', consentHash);

            // Validate consent hash format
            if (!consentHash.startsWith('0x') || consentHash.length !== 66) {
                return { success: false, error: 'Invalid consent hash format' };
            }

            // Check if already revoked
            const isAlreadyRevoked = await this.contract.isRevoked(consentHash);
            if (isAlreadyRevoked) {
                return { success: false, error: 'Consent already revoked' };
            }

            // Estimate gas
            const gasEstimate = await this.contract.revokeConsent.estimateGas(
                consentHash,
                reason
            );

            // Send transaction
            const tx = await this.contract.revokeConsent(consentHash, reason, {
                gasLimit: BigInt(Math.ceil(Number(gasEstimate) * 1.2))
            });

            console.log('[ConsentRevocation] Transaction sent:', tx.hash);

            // Wait for confirmation
            const receipt = await tx.wait(1);

            console.log('[ConsentRevocation] Transaction confirmed:', receipt.hash);

            // Update nullifier to invalidate old proofs
            await NullifierManager.resetNullifier('consent_revoke');

            return {
                success: true,
                txHash: receipt.hash
            };
        } catch (error: any) {
            console.error('[ConsentRevocation] Revocation failed:', error);
            return {
                success: false,
                error: this.parseError(error)
            };
        }
    }

    /**
     * Batch revoke multiple consents
     */
    async batchRevokeConsents(
        consentHashes: string[],
        reason: string
    ): Promise<ConsentRevocationResult[]> {
        const results: ConsentRevocationResult[] = [];

        for (const hash of consentHashes) {
            const result = await this.revokeConsent(hash, reason);
            results.push(result);

            // Small delay between transactions to avoid nonce issues
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        return results;
    }

    /**
     * Emergency revoke all consents for this patient
     */
    async revokeAllConsents(
        consentHashes: string[],
        emergencyReason: string = 'Emergency revocation by patient'
    ): Promise<{
        successful: string[];
        failed: Array<{ hash: string; error: string }>;
    }> {
        console.log('[ConsentRevocation] Emergency revoke-all initiated');

        const successful: string[] = [];
        const failed: Array<{ hash: string; error: string }> = [];

        for (const hash of consentHashes) {
            const result = await this.revokeConsent(hash, emergencyReason);

            if (result.success) {
                successful.push(hash);
            } else {
                failed.push({ hash, error: result.error || 'Unknown error' });
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`[ConsentRevocation] Revoke-all complete: ${successful.length} succeeded, ${failed.length} failed`);

        return { successful, failed };
    }

    /**
     * Check if a consent is revoked
     */
    async isConsentRevoked(consentHash: string): Promise<boolean> {
        if (!this.contract) {
            throw new Error('Service not initialized');
        }

        return this.contract.isRevoked(consentHash);
    }

    /**
     * Check multiple consents at once
     */
    async checkConsentsStatus(consentHashes: string[]): Promise<ConsentStatus[]> {
        if (!this.contract) {
            throw new Error('Service not initialized');
        }

        const statuses = await this.contract.checkConsents(consentHashes);

        return consentHashes.map((hash, index) => ({
            consentHash: hash,
            isRevoked: statuses[index]
        }));
    }

    /**
     * Restore a previously revoked consent (if authorized)
     */
    async restoreConsent(consentHash: string): Promise<ConsentRevocationResult> {
        if (!this.contract || !this.wallet) {
            return { success: false, error: 'Service not initialized' };
        }

        try {
            // Check if actually revoked
            const isRevoked = await this.contract.isRevoked(consentHash);
            if (!isRevoked) {
                return { success: false, error: 'Consent is not revoked' };
            }

            const tx = await this.contract.restoreConsent(consentHash);
            const receipt = await tx.wait(1);

            return {
                success: true,
                txHash: receipt.hash
            };
        } catch (error: any) {
            return {
                success: false,
                error: this.parseError(error)
            };
        }
    }

    /**
     * Listen for revocation events affecting this patient
     */
    onConsentRevoked(
        patientConsentHashes: string[],
        callback: (event: { consentHash: string; reason: string; timestamp: Date }) => void
    ): () => void {
        if (!this.contract) {
            console.warn('[ConsentRevocation] Cannot subscribe - service not initialized');
            return () => { };
        }

        const hashSet = new Set(patientConsentHashes);

        const listener = (
            consentHash: string,
            _revoker: string,
            reason: string,
            timestamp: bigint
        ) => {
            if (hashSet.has(consentHash)) {
                callback({
                    consentHash,
                    reason,
                    timestamp: new Date(Number(timestamp) * 1000)
                });
            }
        };

        this.contract.on('ConsentRevoked', listener);

        return () => {
            this.contract?.off('ConsentRevoked', listener);
        };
    }

    /**
     * Export wallet for backup (encrypted)
     */
    async exportWallet(password: string): Promise<string> {
        if (!this.wallet) {
            throw new Error('No wallet to export');
        }

        return this.wallet.encrypt(password);
    }

    /**
     * Import wallet from backup
     */
    async importWallet(encryptedJson: string, password: string): Promise<boolean> {
        try {
            const wallet = await ethers.Wallet.fromEncryptedJson(encryptedJson, password);
            await SecureStore.setItemAsync(WALLET_KEY, wallet.privateKey);
            this.wallet = wallet.connect(this.provider!);
            return true;
        } catch (error) {
            console.error('[ConsentRevocation] Wallet import failed:', error);
            return false;
        }
    }

    /**
     * Parse ethers.js errors into user-friendly messages
     */
    private parseError(error: any): string {
        const message = error?.message || error?.toString() || 'Unknown error';

        if (message.includes('insufficient funds')) {
            return 'Insufficient funds for transaction. Please add POL/MATIC to your wallet.';
        }
        if (message.includes('user rejected')) {
            return 'Transaction was rejected.';
        }
        if (message.includes('ConsentAlreadyRevoked')) {
            return 'This consent has already been revoked.';
        }
        if (message.includes('NotAuthorized')) {
            return 'You are not authorized to revoke this consent.';
        }
        if (message.includes('nonce too low')) {
            return 'Transaction conflict. Please try again.';
        }

        return message;
    }

    /**
     * Cleanup resources
     */
    async disconnect(): Promise<void> {
        if (this.contract) {
            this.contract.removeAllListeners();
        }
        this.provider = null;
        this.wallet = null;
        this.contract = null;
    }
}

// Singleton instance
export const consentRevocationService = new ConsentRevocationService();
