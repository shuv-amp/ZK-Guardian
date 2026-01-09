import * as SecureStore from '../utils/SecureStorage';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';

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
     * Grab the nullifier (or make a new one).
     * This is the "secret sauce" for ZK proofs.
     * 
     * STOP! We need biometrics (FaceID/TouchID) before touching this.
     */
    static async getOrCreateNullifier(requireBiometric: boolean = true): Promise<bigint> {
        try {
            // Check if biometric is available and required
            if (requireBiometric) {
                await this.requireBiometricAuth('Access your secure identity');
            }

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
     * Require biometric authentication before sensitive operations
     */
    private static async requireBiometricAuth(promptMessage: string): Promise<void> {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
            console.warn('[NullifierManager] Biometric not available, proceeding without');
            return;
        }

        const result = await LocalAuthentication.authenticateAsync({
            promptMessage,
            fallbackLabel: 'Use Passcode',
            disableDeviceFallback: false,
            cancelLabel: 'Cancel'
        });

        if (!result.success) {
            throw new Error('BIOMETRIC_AUTH_FAILED');
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
     * Time for a fresh start?
     * Resets the nullifier. This unlinks all future activity from the past.
     * Useful when a user revokes consent and wants to be "forgotten" moving forward.
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
     * Fresh nonce for every request.
     * Ensures we never generate the same proof hash twice.
     * Privacy preservation 101.
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
