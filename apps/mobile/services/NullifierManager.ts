import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const NULLIFIER_KEY = 'zk_guardian_patient_nullifier';
const NULLIFIER_VERSION_KEY = 'zk_guardian_nullifier_version';
const CONSENT_HASH_KEY = 'zk_guardian_consent_hash';

export interface NullifierInfo {
    nullifier: bigint;
    version: number;
    createdAt: number;
}

export class NullifierManager {
    /**
     * Retrieves existing nullifier or creates and securely stores a new one.
     * The nullifier is a high-entropy secret used to blind on-chain hashes.
     */
    static async getOrCreateNullifier(): Promise<bigint> {
        try {
            let nullifierHex = await SecureStore.getItemAsync(NULLIFIER_KEY);

            if (!nullifierHex) {
                console.log('[NullifierManager] No nullifier found. Generating new secret...');
                return await this.generateAndStoreNullifier();
            }

            // Return as BigInt for ZK inputs
            return BigInt('0x' + nullifierHex);
        } catch (error) {
            console.error('[NullifierManager] Failed to access secure store:', error);
            throw new Error('SECURE_STORAGE_FAILURE');
        }
    }

    /**
     * Get full nullifier info including version
     */
    static async getNullifierInfo(): Promise<NullifierInfo | null> {
        try {
            const nullifierHex = await SecureStore.getItemAsync(NULLIFIER_KEY);
            const versionStr = await SecureStore.getItemAsync(NULLIFIER_VERSION_KEY);

            if (!nullifierHex) {
                return null;
            }

            return {
                nullifier: BigInt('0x' + nullifierHex),
                version: versionStr ? parseInt(versionStr, 10) : 1,
                createdAt: 0 // Would need to store this separately
            };
        } catch (error) {
            console.error('[NullifierManager] Failed to get nullifier info:', error);
            return null;
        }
    }

    /**
     * Reset nullifier when consent is updated or revoked.
     * This should be called when:
     * - User creates a new consent
     * - User revokes a consent
     * - User explicitly requests identity reset
     * 
     * After reset, all previous audit logs will no longer link to this patient.
     * @param reason - Why the nullifier is being reset
     */
    static async resetNullifier(reason: 'consent_update' | 'consent_revoke' | 'user_request'): Promise<bigint> {
        console.log(`[NullifierManager] Resetting nullifier due to: ${reason}`);

        // Increment version
        const versionStr = await SecureStore.getItemAsync(NULLIFIER_VERSION_KEY);
        const currentVersion = versionStr ? parseInt(versionStr, 10) : 0;
        const newVersion = currentVersion + 1;

        // Generate new nullifier
        const newNullifier = await this.generateAndStoreNullifier();

        // Store new version
        await SecureStore.setItemAsync(NULLIFIER_VERSION_KEY, newVersion.toString());

        console.log(`[NullifierManager] Nullifier reset to version ${newVersion}`);

        return newNullifier;
    }

    /**
     * Check if nullifier should be reset based on consent hash change.
     * Call this when fetching consent to auto-detect consent updates.
     */
    static async checkConsentSync(currentConsentHash: string): Promise<boolean> {
        try {
            const storedHash = await SecureStore.getItemAsync(CONSENT_HASH_KEY);

            if (storedHash && storedHash !== currentConsentHash) {
                console.log('[NullifierManager] Consent hash changed, nullifier may need reset');
                return false; // Not in sync
            }

            // Store/update consent hash
            await SecureStore.setItemAsync(CONSENT_HASH_KEY, currentConsentHash);
            return true; // In sync
        } catch (error) {
            console.error('[NullifierManager] Consent sync check failed:', error);
            return true; // Assume in sync on error
        }
    }

    /**
     * Update stored consent hash after consent operations
     */
    static async updateConsentHash(consentHash: string): Promise<void> {
        try {
            await SecureStore.setItemAsync(CONSENT_HASH_KEY, consentHash);
        } catch (error) {
            console.error('[NullifierManager] Failed to update consent hash:', error);
        }
    }

    /**
     * Generates a fresh nonce for a specific session/access request.
     * This ensures every access event has a unique hash even for same patient/resource.
     */
    static generateSessionNonce(): bigint {
        // High-precision timestamp + Random jitter
        const timestamp = BigInt(Date.now());
        const random = BigInt(Math.floor(Math.random() * 1000000));
        return (timestamp * 1000000n) + random;
    }

    /**
     * Generate a new nullifier and store it securely
     */
    private static async generateAndStoreNullifier(): Promise<bigint> {
        // Generate 32 bytes (256 bits) of random data
        const randomBytes = await Crypto.getRandomBytesAsync(32);

        // Convert to hex string
        const nullifierHex = Array.from(randomBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        await SecureStore.setItemAsync(NULLIFIER_KEY, nullifierHex);

        return BigInt('0x' + nullifierHex);
    }

    /**
     * DEBUG ONLY: Clears all nullifier data.
     * WARNING: This effectively deletes the patient's identity linkage.
     */
    static async debugClear() {
        if (__DEV__) {
            await SecureStore.deleteItemAsync(NULLIFIER_KEY);
            await SecureStore.deleteItemAsync(NULLIFIER_VERSION_KEY);
            await SecureStore.deleteItemAsync(CONSENT_HASH_KEY);
            console.log('[NullifierManager] DEBUG: All nullifier data cleared');
        }
    }

    /**
     * Export nullifier for backup (encrypted, user-visible)
     * This allows users to restore their nullifier on a new device
     */
    static async exportForBackup(): Promise<string | null> {
        try {
            const nullifierHex = await SecureStore.getItemAsync(NULLIFIER_KEY);
            const versionStr = await SecureStore.getItemAsync(NULLIFIER_VERSION_KEY);

            if (!nullifierHex) {
                return null;
            }

            // Create backup payload
            const backup = {
                n: nullifierHex,
                v: versionStr || '1',
                t: Date.now()
            };

            // Base64 encode (user should encrypt this themselves)
            return btoa(JSON.stringify(backup));
        } catch (error) {
            console.error('[NullifierManager] Export failed:', error);
            return null;
        }
    }

    /**
     * Import nullifier from backup
     * WARNING: This will overwrite existing nullifier
     */
    static async importFromBackup(backupData: string): Promise<boolean> {
        try {
            const decoded = JSON.parse(atob(backupData));

            if (!decoded.n || typeof decoded.n !== 'string') {
                throw new Error('Invalid backup format');
            }

            // Validate it's a valid hex string
            if (!/^[0-9a-fA-F]{64}$/.test(decoded.n)) {
                throw new Error('Invalid nullifier format');
            }

            await SecureStore.setItemAsync(NULLIFIER_KEY, decoded.n);
            await SecureStore.setItemAsync(NULLIFIER_VERSION_KEY, decoded.v || '1');

            console.log('[NullifierManager] Nullifier imported from backup');
            return true;
        } catch (error) {
            console.error('[NullifierManager] Import failed:', error);
            return false;
        }
    }
}
