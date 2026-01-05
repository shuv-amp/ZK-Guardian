import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const NULLIFIER_KEY = 'zk_guardian_patient_nullifier';

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

                // Generate 32 bytes (256 bits) of random data
                const randomBytes = await Crypto.getRandomBytesAsync(32);

                // Convert to hex string
                nullifierHex = Array.from(randomBytes)
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');

                await SecureStore.setItemAsync(NULLIFIER_KEY, nullifierHex);
            }

            // Return as BigInt for ZK inputs
            return BigInt('0x' + nullifierHex);
        } catch (error) {
            console.error('[NullifierManager] Failed to access secure store:', error);
            throw new Error('SECURE_STORAGE_FAILURE');
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
     * DEBUG ONLY: Clears the nullifier.
     * WARNING: This effectively deletes the patient's identity linkage.
     */
    static async debugClear() {
        if (__DEV__) {
            await SecureStore.deleteItemAsync(NULLIFIER_KEY);
        }
    }
}
