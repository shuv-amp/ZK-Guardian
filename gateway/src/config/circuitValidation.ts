/**
 * Circuit Integrity Validation
 * 
 * Validates WASM and ZKEY files against known SHA256 hashes to detect tampering.
 * This is critical for security - modified circuits could produce valid-looking
 * but insecure proofs.
 * 
 * Usage: Call validateCircuitIntegrity() at gateway startup.
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACCESS_CIRCUIT_DIR = path.resolve(__dirname, '../../../circuits/build/AccessIsAllowedSecure');

interface CircuitValidationResult {
    valid: boolean;
    wasmValid: boolean;
    zkeyValid: boolean;
    errors: string[];
}

/**
 * Validate circuit file integrity against expected hashes
 */
export async function validateCircuitIntegrity(): Promise<CircuitValidationResult> {
    const result: CircuitValidationResult = {
        valid: true,
        wasmValid: true,
        zkeyValid: true,
        errors: []
    };

    // If no hashes configured, skip validation (development mode)
    if (!env.CIRCUIT_WASM_SHA256 && !env.CIRCUIT_ZKEY_SHA256) {
        logger.warn('Circuit integrity validation skipped - no hashes configured');
        return result;
    }

    const wasmPath = path.join(ACCESS_CIRCUIT_DIR, 'AccessIsAllowedSecure_js', 'AccessIsAllowedSecure.wasm');
    const zkeyPath = path.join(ACCESS_CIRCUIT_DIR, 'AccessIsAllowedSecure_final.zkey');

    // Validate WASM
    if (env.CIRCUIT_WASM_SHA256) {
        try {
            const wasmBuffer = await readFile(wasmPath);
            const wasmHash = createHash('sha256').update(wasmBuffer).digest('hex');

            if (wasmHash !== env.CIRCUIT_WASM_SHA256) {
                result.wasmValid = false;
                result.valid = false;
                result.errors.push(`WASM hash mismatch: expected ${env.CIRCUIT_WASM_SHA256}, got ${wasmHash}`);
                logger.error({ expected: env.CIRCUIT_WASM_SHA256, actual: wasmHash }, 'Circuit WASM integrity check FAILED');
            } else {
                logger.info({ hash: wasmHash }, 'Circuit WASM integrity verified');
            }
        } catch (error: any) {
            result.wasmValid = false;
            result.valid = false;
            result.errors.push(`Failed to read WASM file: ${error.message}`);
            logger.error({ error: error.message, path: wasmPath }, 'Failed to read circuit WASM');
        }
    }

    // Validate ZKEY
    if (env.CIRCUIT_ZKEY_SHA256) {
        try {
            const zkeyBuffer = await readFile(zkeyPath);
            const zkeyHash = createHash('sha256').update(zkeyBuffer).digest('hex');

            if (zkeyHash !== env.CIRCUIT_ZKEY_SHA256) {
                result.zkeyValid = false;
                result.valid = false;
                result.errors.push(`ZKEY hash mismatch: expected ${env.CIRCUIT_ZKEY_SHA256}, got ${zkeyHash}`);
                logger.error({ expected: env.CIRCUIT_ZKEY_SHA256, actual: zkeyHash }, 'Circuit ZKEY integrity check FAILED');
            } else {
                logger.info({ hash: zkeyHash }, 'Circuit ZKEY integrity verified');
            }
        } catch (error: any) {
            result.zkeyValid = false;
            result.valid = false;
            result.errors.push(`Failed to read ZKEY file: ${error.message}`);
            logger.error({ error: error.message, path: zkeyPath }, 'Failed to read circuit ZKEY');
        }
    }

    // In production, halt if integrity check fails
    if (!result.valid && env.NODE_ENV === 'production') {
        logger.fatal({ errors: result.errors }, 'Circuit integrity validation FAILED - refusing to start');
        throw new Error('CIRCUIT_INTEGRITY_FAILURE');
    }

    return result;
}

/**
 * Helper: Generate hashes for current circuit files
 * Run this to get the hashes to put in env variables
 */
export async function generateCircuitHashes(): Promise<{ wasm: string; zkey: string }> {
    const wasmPath = path.join(ACCESS_CIRCUIT_DIR, 'AccessIsAllowedSecure_js', 'AccessIsAllowedSecure.wasm');
    const zkeyPath = path.join(ACCESS_CIRCUIT_DIR, 'AccessIsAllowedSecure_final.zkey');

    const wasmBuffer = await readFile(wasmPath);
    const zkeyBuffer = await readFile(zkeyPath);

    return {
        wasm: createHash('sha256').update(wasmBuffer).digest('hex'),
        zkey: createHash('sha256').update(zkeyBuffer).digest('hex')
    };
}
