/**
 * ZK Proof Worker - Parallel Proof Generation
 * 
 * Uses Worker Threads for CPU-intensive proof generation.
 * Prevents main thread blocking and improves throughput.
 */

import { parentPort, workerData } from 'worker_threads';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';

// Worker receives:
// { type: 'GENERATE', inputs: CircuitInputs, wasmPath: string, zkeyPath: string }

interface ProofRequest {
    type: 'GENERATE';
    id: string;
    inputs: Record<string, string | string[]>;
    wasmPath: string;
    zkeyPath: string;
}

interface ProofResponse {
    type: 'PROOF_RESULT';
    id: string;
    success: boolean;
    proof?: {
        a: string[];
        b: string[][];
        c: string[];
    };
    publicSignals?: string[];
    error?: string;
    durationMs: number;
}

// Initialize worker
console.log('[ProofWorker] Starting worker thread');

if (!parentPort) {
    throw new Error('This module must be run as a Worker Thread');
}

// Handle messages from main thread
parentPort.on('message', async (request: ProofRequest) => {
    if (request.type !== 'GENERATE') {
        parentPort!.postMessage({
            type: 'PROOF_RESULT',
            id: request.id,
            success: false,
            error: `Unknown request type: ${request.type}`
        });
        return;
    }

    const startTime = Date.now();

    try {
        // Verify files exist
        if (!fs.existsSync(request.wasmPath)) {
            throw new Error(`WASM file not found: ${request.wasmPath}`);
        }
        if (!fs.existsSync(request.zkeyPath)) {
            throw new Error(`ZKEY file not found: ${request.zkeyPath}`);
        }

        // Generate proof
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            request.inputs,
            request.wasmPath,
            request.zkeyPath
        );

        // Format proof for Solidity
        const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
        const [a, b, c, input] = JSON.parse(`[${calldata}]`);

        const response: ProofResponse = {
            type: 'PROOF_RESULT',
            id: request.id,
            success: true,
            proof: { a, b, c },
            publicSignals: input,
            durationMs: Date.now() - startTime
        };

        parentPort!.postMessage(response);

    } catch (error: any) {
        const response: ProofResponse = {
            type: 'PROOF_RESULT',
            id: request.id,
            success: false,
            error: error.message,
            durationMs: Date.now() - startTime
        };

        parentPort!.postMessage(response);
    }
});

// Handle errors
parentPort.on('error', (error) => {
    console.error('[ProofWorker] Error:', error);
});

// Notify ready
parentPort.postMessage({ type: 'READY' });
