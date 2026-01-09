/**
 * Key Rotation Service
 * 
 * Manages the lifecycle and rotation of sensitive cryptographic keys.
 * Specifically handles the complexity of blockchain wallet rotation.
 * 
 * Security Requirements (SECURITY_AUDIT_CHECKLIST.md PK4):
 * - PK4: Key rotation procedure documented and automated
 */

import { ethers } from 'ethers';
import { logger, auditLogger } from './logger.js';
import { secretsManager, SecretType } from '../config/secrets.js';
import { env } from '../config/env.js';

export interface RotationResult {
    success: boolean;
    newKeyId?: string; // Public identifier (address or key ID)
    nextAction?: string;
    error?: string;
}

export class KeyRotationService {

    /**
     * rotateGatewayKey
     * 
     * Performs a rotation of the Gateway's blockchain wallet.
     * 
     * Steps:
     * 1. Generate new random wallet
     * 2. (Optional) Transfer native assets (MATIC/POL) from old to new
     * 3. (Optional) Transfer application roles/permissions
     * 4. Update secrets manager
     * 5. Archive old key info securely
     * 
     * @param safeMode - If true, only generates key and proposes rotation (doesn't execute on-chain tx)
     */
    async rotateGatewayKey(safeMode: boolean = true): Promise<RotationResult> {
        const rotationId = `rot-${Date.now()}`;
        logger.info({ rotationId, safeMode }, 'Starting Gateway key rotation');

        try {
            // 1. Get current wallet
            const currentPrivateKey = await secretsManager.getSecret('GATEWAY_PRIVATE_KEY');
            if (!env.POLYGON_AMOY_RPC) throw new Error('RPC URL not configured');

            const provider = new ethers.JsonRpcProvider(env.POLYGON_AMOY_RPC);
            const currentWallet = new ethers.Wallet(currentPrivateKey, provider);

            // 2. Generate new wallet
            const newWallet = ethers.Wallet.createRandom().connect(provider);

            logger.info({
                rotationId,
                currentAddress: currentWallet.address,
                newAddress: newWallet.address
            }, 'Generated candidate wallet for rotation');

            if (safeMode) {
                // In safe mode, we just return the new details for admin manual processing
                // We do NOT update the running secret yet
                return {
                    success: true,
                    newKeyId: newWallet.address,
                    nextAction: `MANUAL_STEP: Transfer MATIC from ${currentWallet.address} to ${newWallet.address} and update GATEWAY_PRIVATE_KEY`
                };
            }

            // --- AUTO MODE (Dangerous - requires high trust) ---

            // 3. Check Balance
            const balance = await provider.getBalance(currentWallet.address);
            /* const gasPrice = (await provider.getFeeData()).gasPrice || ethers.parseUnits('30', 'gwei');
             const gasLimit = 21000n; // Standard transfer
             const cost = gasPrice * gasLimit; */

            // Logic to transfer funds would go here, but for safety in this version 
            // we will stop at generation and require manual fund transfer confirmation.
            // Automatically draining funds is risky if the new key isn't persisted 100% reliably.

            // 4. Update in-memory secret (Hot Swap)
            // This allows the gateway to immediately start signing with the new key
            // assuming it has been funded and authorized externally.
            await secretsManager.rotateSecret('GATEWAY_PRIVATE_KEY', newWallet.privateKey);

            auditLogger.warn({
                event: 'KEY_ROTATION',
                type: 'GATEWAY_PRIVATE_KEY',
                oldKeyId: currentWallet.address,
                newKeyId: newWallet.address,
                rotationId
            }, 'Gateway private key rotated in-memory');

            return {
                success: true,
                newKeyId: newWallet.address,
                nextAction: 'Ensure new wallet is funded and has correct on-chain roles. Update persistent secret store (Vault/Env).'
            };

        } catch (error: any) {
            logger.error({ rotationId, error: error.message }, 'Key rotation failed');
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * rotateJWTSecret
     * 
     * Rotates limits-service or other internal JWT secrets.
     */
    async rotateJWTSecret(): Promise<RotationResult> {
        try {
            // Generate cryptographically strong random secret
            const { randomBytes } = await import('crypto');
            const newSecret = randomBytes(64).toString('hex');

            await secretsManager.rotateSecret('JWT_SECRET', newSecret);

            auditLogger.warn({
                event: 'KEY_ROTATION',
                type: 'JWT_SECRET'
            }, 'JWT secret rotated in-memory');

            return {
                success: true,
                nextAction: 'Update persistent secret store. Old tokens will identify as invalid.'
            };
        } catch (error: any) {
            logger.error({ error: error.message }, 'JWT rotation failed');
            return { success: false, error: error.message };
        }
    }
}

export const keyRotationService = new KeyRotationService();
