/**
 * Utility Functions
 * 
 * Common utilities for ZK proof generation and hashing.
 */

/**
 * Split a string ID into 4 field elements (for 256-bit representation)
 */
export function splitId(id: string): [bigint, bigint, bigint, bigint] {
    // Pad or truncate to 64 hex chars
    const hex = id.replace('0x', '').padEnd(64, '0').slice(0, 64);

    return [
        BigInt('0x' + hex.slice(0, 16)),
        BigInt('0x' + hex.slice(16, 32)),
        BigInt('0x' + hex.slice(32, 48)),
        BigInt('0x' + hex.slice(48, 64))
    ];
}

/**
 * Convert a string to field elements
 */
export function stringToFieldElements(str: string, count: number): bigint[] {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);

    // Pad to fit in `count` field elements (31 bytes each to fit in field)
    const bytesPerElement = 31;
    const totalBytes = count * bytesPerElement;
    const padded = new Uint8Array(totalBytes);
    padded.set(bytes.slice(0, totalBytes));

    const elements: bigint[] = [];
    for (let i = 0; i < count; i++) {
        const chunk = padded.slice(i * bytesPerElement, (i + 1) * bytesPerElement);
        elements.push(BigInt('0x' + Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join('')));
    }

    return elements;
}

/**
 * Compute Poseidon hash (async wrapper)
 */
export async function poseidonHash(inputs: bigint[]): Promise<string> {
    const { buildPoseidon } = await import('circomlibjs');
    const poseidon = await buildPoseidon();
    const hash = poseidon(inputs);
    return poseidon.F.toString(hash);
}

/**
 * Format a snarkjs proof for Solidity contract submission
 */
export function formatProofForSolidity(
    proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] },
    publicSignals: string[]
): {
    pA: [bigint, bigint];
    pB: [[bigint, bigint], [bigint, bigint]];
    pC: [bigint, bigint];
    pubSignals: bigint[];
} {
    return {
        pA: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
        pB: [
            [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])], // Note: swapped for Solidity
            [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])]
        ],
        pC: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
        pubSignals: publicSignals.map(s => BigInt(s))
    };
}

/**
 * Generate a random field element
 */
export function randomFieldElement(): bigint {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const bytes = new Uint8Array(31);
        crypto.getRandomValues(bytes);
        return BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    }

    // Fallback for Node.js
    const { randomBytes } = require('crypto');
    return BigInt('0x' + randomBytes(31).toString('hex'));
}

/**
 * Convert bytes32 to hex string
 */
export function bytes32ToHex(value: bigint): string {
    return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Convert hex string to bytes32
 */
export function hexToBytes32(hex: string): bigint {
    return BigInt(hex.startsWith('0x') ? hex : '0x' + hex);
}

/**
 * Compute keccak256 hash (for Ethereum compatibility)
 */
export function keccak256(data: string): string {
    const { ethers } = require('ethers');
    return ethers.keccak256(ethers.toUtf8Bytes(data));
}

/**
 * Validate a proof hash format
 */
export function isValidProofHash(hash: string): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(hash);
}

/**
 * Validate a consent hash format
 */
export function isValidConsentHash(hash: string): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(hash) || /^[0-9]+$/.test(hash);
}

/**
 * Get current Unix timestamp
 */
export function getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Check if a timestamp is within acceptable range
 */
export function isTimestampValid(
    timestamp: number,
    maxAgeSeconds: number = 300 // 5 minutes
): boolean {
    const now = getCurrentTimestamp();
    return timestamp >= (now - maxAgeSeconds) && timestamp <= (now + 60); // Allow 1 minute future drift
}
