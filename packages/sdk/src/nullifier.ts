/**
 * Nullifier Manager
 * 
 * Manages patient nullifiers for privacy-preserving proofs.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export interface NullifierState {
    value: bigint;
    createdAt: Date;
    lastUsed: Date;
    usageCount: number;
}

interface StoredNullifier {
    value: string;
    createdAt: string;
    lastUsed: string;
    usageCount: number;
}

export class NullifierManager {
    private nullifiers: Map<string, NullifierState> = new Map();

    /**
     * Get or create a nullifier for a user
     */
    async getOrCreate(userId: string): Promise<NullifierState> {
        let nullifier = this.nullifiers.get(userId);

        if (!nullifier) {
            // Generate new nullifier
            const bytes = randomBytes(31); // Fit in field element
            const value = BigInt('0x' + bytes.toString('hex'));

            nullifier = {
                value,
                createdAt: new Date(),
                lastUsed: new Date(),
                usageCount: 0
            };

            this.nullifiers.set(userId, nullifier);
        }

        // Update usage
        nullifier.lastUsed = new Date();
        nullifier.usageCount++;

        return nullifier;
    }

    /**
     * Get an existing nullifier (returns null if not found)
     */
    get(userId: string): NullifierState | null {
        return this.nullifiers.get(userId) || null;
    }

    /**
     * Regenerate nullifier (after consent revocation)
     */
    async regenerate(userId: string): Promise<NullifierState> {
        // Delete existing
        this.nullifiers.delete(userId);

        // Create new
        return this.getOrCreate(userId);
    }

    /**
     * Export nullifier for backup (encrypted)
     */
    async export(userId: string, password: string): Promise<string> {
        const nullifier = this.nullifiers.get(userId);
        if (!nullifier) {
            throw new Error('Nullifier not found');
        }

        const data: StoredNullifier = {
            value: nullifier.value.toString(),
            createdAt: nullifier.createdAt.toISOString(),
            lastUsed: nullifier.lastUsed.toISOString(),
            usageCount: nullifier.usageCount
        };

        const plaintext = JSON.stringify(data);

        // Encrypt with password
        const salt = randomBytes(16);
        const key = await scryptAsync(password, salt, 32) as Buffer;
        const iv = randomBytes(16);

        const cipher = createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();

        // Combine: salt + iv + authTag + encrypted
        return Buffer.concat([
            salt,
            iv,
            authTag,
            Buffer.from(encrypted, 'hex')
        ]).toString('base64');
    }

    /**
     * Import nullifier from backup
     */
    async import(encryptedData: string, password: string): Promise<boolean> {
        try {
            const combined = Buffer.from(encryptedData, 'base64');

            const salt = combined.subarray(0, 16);
            const iv = combined.subarray(16, 32);
            const authTag = combined.subarray(32, 48);
            const encrypted = combined.subarray(48);

            const key = await scryptAsync(password, salt, 32) as Buffer;

            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            const data: StoredNullifier = JSON.parse(decrypted.toString('utf8'));

            // Reconstruct nullifier state
            const nullifier: NullifierState = {
                value: BigInt(data.value),
                createdAt: new Date(data.createdAt),
                lastUsed: new Date(data.lastUsed),
                usageCount: data.usageCount
            };

            // We need the userId to store it - use a hash of the nullifier as key
            const userId = `imported_${data.value.slice(0, 16)}`;
            this.nullifiers.set(userId, nullifier);

            return true;
        } catch (error) {
            console.error('[NullifierManager] Import failed:', error);
            return false;
        }
    }

    /**
     * Clear all nullifiers (logout)
     */
    clear(): void {
        this.nullifiers.clear();
    }

    /**
     * Get stats
     */
    getStats(): {
        count: number;
        totalUsage: number;
    } {
        let totalUsage = 0;
        for (const n of this.nullifiers.values()) {
            totalUsage += n.usageCount;
        }

        return {
            count: this.nullifiers.size,
            totalUsage
        };
    }
}
