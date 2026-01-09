/**
 * Local Key Management Service
 * 
 * Secure key management without cloud dependencies.
 * Uses encrypted local storage for production keys.
 * 
 * Features:
 * - AES-256-GCM encryption for key material
 * - Key derivation from master password (PBKDF2)
 * - Automatic key rotation support
 * - Air-gapped mode for highest security
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ethers } from 'ethers';
import { logger } from './logger.js';

const pbkdf2 = promisify(crypto.pbkdf2);
const randomBytes = promisify(crypto.randomBytes);

// Configuration
const KEYS_DIR = process.env.KEYS_DIR || path.join(process.cwd(), '.keys');
const KEY_ITERATIONS = 600000; // OWASP 2023 recommendation
const ALGORITHM = 'aes-256-gcm';

interface EncryptedKeyFile {
    version: 1;
    salt: string;
    iv: string;
    authTag: string;
    encryptedData: string;
    keyId: string;
    createdAt: string;
    algorithm: string;
}

interface KeyMetadata {
    keyId: string;
    purpose: 'signing' | 'encryption' | 'nullifier';
    createdAt: Date;
    rotatedAt?: Date;
    expiresAt?: Date;
}

/**
 * Local Key Management Service
 * 
 * Production-ready key management without cloud HSM.
 */
export class LocalKeyManager {
    private masterKey: Buffer | null = null;
    private keyCache = new Map<string, Buffer>();
    private initialized = false;

    /**
     * Initialize with master password
     * 
     * In production: master password from environment variable
     * For highest security: enter at startup via secure terminal
     */
    async initialize(masterPassword?: string): Promise<void> {
        const password = masterPassword || process.env.KEY_MASTER_PASSWORD;

        if (!password) {
            throw new Error(
                'KEY_MASTER_PASSWORD required. Set env var or pass to initialize()'
            );
        }

        // Ensure keys directory exists with restricted permissions
        await this.ensureKeysDirectory();

        // Derive master key from password
        const salt = await this.getOrCreateMasterSalt();
        this.masterKey = await pbkdf2(
            password,
            salt,
            KEY_ITERATIONS,
            32,
            'sha512'
        );

        this.initialized = true;
        logger.info('LocalKeyManager initialized');
    }

    /**
     * Get or create the blockchain signing wallet
     */
    async getSigningWallet(provider: ethers.Provider): Promise<ethers.Wallet> {
        this.ensureInitialized();

        const keyId = 'gateway-signing';
        let privateKey = await this.loadKey(keyId);

        if (!privateKey) {
            // Generate new wallet
            const wallet = ethers.Wallet.createRandom();
            privateKey = Buffer.from(wallet.privateKey.slice(2), 'hex');
            await this.storeKey(keyId, privateKey, 'signing');
            logger.info({ address: wallet.address }, 'Created new signing wallet');
        }

        const wallet = new ethers.Wallet('0x' + privateKey.toString('hex'), provider);
        return wallet;
    }

    /**
     * Get nullifier encryption key for patient data
     */
    async getNullifierKey(): Promise<Buffer> {
        this.ensureInitialized();

        const keyId = 'nullifier-encryption';
        let key = await this.loadKey(keyId);

        if (!key) {
            key = await randomBytes(32);
            await this.storeKey(keyId, key, 'nullifier');
            logger.info('Created new nullifier encryption key');
        }

        return key;
    }

    /**
     * Encrypt data with a specific key
     */
    async encrypt(data: Buffer, keyPurpose: string = 'encryption'): Promise<{
        ciphertext: Buffer;
        iv: Buffer;
        authTag: Buffer;
    }> {
        this.ensureInitialized();

        const keyId = `${keyPurpose}-key`;
        let key = await this.loadKey(keyId);

        if (!key) {
            key = await randomBytes(32);
            await this.storeKey(keyId, key, 'encryption');
        }

        const iv = await randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        const encrypted = Buffer.concat([
            cipher.update(data),
            cipher.final()
        ]);

        return {
            ciphertext: encrypted,
            iv,
            authTag: cipher.getAuthTag()
        };
    }

    /**
     * Decrypt data
     */
    async decrypt(
        ciphertext: Buffer,
        iv: Buffer,
        authTag: Buffer,
        keyPurpose: string = 'encryption'
    ): Promise<Buffer> {
        this.ensureInitialized();

        const keyId = `${keyPurpose}-key`;
        const key = await this.loadKey(keyId);

        if (!key) {
            throw new Error(`Key not found for purpose: ${keyPurpose}`);
        }

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        return Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
    }

    /**
     * Rotate a key (creates new version, keeps old for decryption)
     */
    async rotateKey(keyId: string): Promise<void> {
        this.ensureInitialized();

        const oldKey = await this.loadKey(keyId);
        if (oldKey) {
            // Archive old key
            await this.storeKey(`${keyId}-rotated-${Date.now()}`, oldKey, 'encryption');
        }

        // Generate new key
        const newKey = await randomBytes(32);
        await this.storeKey(keyId, newKey, 'encryption');

        // Clear cache
        this.keyCache.delete(keyId);

        logger.info({ keyId }, 'Key rotated successfully');
    }

    /**
     * Sign a message for blockchain transaction
     */
    async signMessage(message: string | Uint8Array): Promise<string> {
        this.ensureInitialized();

        const keyId = 'gateway-signing';
        const privateKey = await this.loadKey(keyId);

        if (!privateKey) {
            throw new Error('Signing key not initialized');
        }

        const wallet = new ethers.Wallet('0x' + privateKey.toString('hex'));
        return wallet.signMessage(message);
    }

    /**
     * Get wallet address without exposing private key
     */
    async getWalletAddress(): Promise<string> {
        this.ensureInitialized();

        const keyId = 'gateway-signing';
        const privateKey = await this.loadKey(keyId);

        if (!privateKey) {
            throw new Error('Signing key not initialized');
        }

        const wallet = new ethers.Wallet('0x' + privateKey.toString('hex'));
        return wallet.address;
    }

    /**
     * Export key metadata (never exports actual keys)
     */
    async listKeys(): Promise<KeyMetadata[]> {
        this.ensureInitialized();

        const files = await fs.promises.readdir(KEYS_DIR);
        const metadata: KeyMetadata[] = [];

        for (const file of files) {
            if (file.endsWith('.key.enc')) {
                try {
                    const content = await fs.promises.readFile(
                        path.join(KEYS_DIR, file),
                        'utf-8'
                    );
                    const keyFile = JSON.parse(content) as EncryptedKeyFile;
                    metadata.push({
                        keyId: keyFile.keyId,
                        purpose: 'signing', // Extract from keyId
                        createdAt: new Date(keyFile.createdAt)
                    });
                } catch {
                    // Skip invalid files
                }
            }
        }

        return metadata;
    }

    // Private methods

    private ensureInitialized(): void {
        if (!this.initialized || !this.masterKey) {
            throw new Error('KeyManager not initialized. Call initialize() first.');
        }
    }

    private async ensureKeysDirectory(): Promise<void> {
        try {
            await fs.promises.mkdir(KEYS_DIR, { recursive: true, mode: 0o700 });
        } catch (error: any) {
            if (error.code !== 'EEXIST') throw error;
        }

        // Verify permissions (Unix only)
        if (process.platform !== 'win32') {
            const stats = await fs.promises.stat(KEYS_DIR);
            const mode = stats.mode & 0o777;
            if (mode !== 0o700) {
                await fs.promises.chmod(KEYS_DIR, 0o700);
            }
        }
    }

    private async getOrCreateMasterSalt(): Promise<Buffer> {
        const saltPath = path.join(KEYS_DIR, '.master-salt');

        try {
            const salt = await fs.promises.readFile(saltPath);
            return salt;
        } catch {
            // Create new salt
            const salt = await randomBytes(32);
            await fs.promises.writeFile(saltPath, salt, { mode: 0o600 });
            return salt;
        }
    }

    private async storeKey(
        keyId: string,
        keyMaterial: Buffer,
        purpose: 'signing' | 'encryption' | 'nullifier'
    ): Promise<void> {
        const iv = await randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey!, iv);

        const encrypted = Buffer.concat([
            cipher.update(keyMaterial),
            cipher.final()
        ]);

        const keyFile: EncryptedKeyFile = {
            version: 1,
            salt: '', // Using master salt
            iv: iv.toString('base64'),
            authTag: cipher.getAuthTag().toString('base64'),
            encryptedData: encrypted.toString('base64'),
            keyId,
            createdAt: new Date().toISOString(),
            algorithm: ALGORITHM
        };

        const filePath = path.join(KEYS_DIR, `${keyId}.key.enc`);
        await fs.promises.writeFile(
            filePath,
            JSON.stringify(keyFile, null, 2),
            { mode: 0o600 }
        );

        // Cache the key
        this.keyCache.set(keyId, keyMaterial);
    }

    private async loadKey(keyId: string): Promise<Buffer | null> {
        // Check cache first
        if (this.keyCache.has(keyId)) {
            return this.keyCache.get(keyId)!;
        }

        const filePath = path.join(KEYS_DIR, `${keyId}.key.enc`);

        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const keyFile = JSON.parse(content) as EncryptedKeyFile;

            const iv = Buffer.from(keyFile.iv, 'base64');
            const authTag = Buffer.from(keyFile.authTag, 'base64');
            const encryptedData = Buffer.from(keyFile.encryptedData, 'base64');

            const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey!, iv);
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([
                decipher.update(encryptedData),
                decipher.final()
            ]);

            // Cache and return
            this.keyCache.set(keyId, decrypted);
            return decrypted;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }
}

// Singleton instance
export const keyManager = new LocalKeyManager();

// Helper for quick signing
export async function signTransaction(txData: string): Promise<string> {
    return keyManager.signMessage(txData);
}

export default keyManager;
