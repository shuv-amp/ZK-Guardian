
import { buildPoseidon } from 'circomlibjs';
import { logger } from '../../lib/logger.js';
// We use a simple in-memory implementation for the demo.
// In production, this should be backed by Redis or a database.

export interface MerkleProof {
    root: bigint;
    siblings: bigint[];
    pathIndices: number[];
}

export class MerkleTreeService {
    private poseidon: any;
    private leaves: bigint[] = [];
    private levels: number;
    private zeroValue: bigint = 0n;
    private zeros: bigint[] = [];
    private initialized = false;

    // Map credentialHash (bigint) -> index
    private leafToIndex: Map<bigint, number> = new Map();

    constructor(levels: number = 16) {
        this.levels = levels;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            this.poseidon = await buildPoseidon();
            this.initZeros();
            this.initialized = true;
            logger.info('MerkleTreeService initialized with Poseidon hashing');
        } catch (error) {
            logger.error({ err: error }, 'Failed to initialize MerkleTreeService');
            throw error;
        }
    }

    private initZeros() {
        this.zeros = [this.zeroValue];
        for (let i = 1; i < this.levels; i++) {
            this.zeros[i] = this.hashLeftRight(this.zeros[i - 1], this.zeros[i - 1]);
        }
    }

    private hashLeftRight(left: bigint, right: bigint): bigint {
        return this.poseidon.F.toObject(this.poseidon([left, right]));
    }

    /**
     * Add a credential hash to the tree
     * @param credentialHash The Poseidon hash of the credential
     * @returns The new root
     */
    addCredential(credentialHash: bigint): bigint {
        if (!this.initialized) throw new Error('MerkleTreeService not initialized');

        const index = this.leaves.length;
        if (index >= Math.pow(2, this.levels)) {
            throw new Error('Merkle Tree is full');
        }

        this.leaves.push(credentialHash);
        this.leafToIndex.set(credentialHash, index);

        return this.getRoot();
    }

    /**
     * Get the current Merkle Root
     */
    getRoot(): bigint {
        if (!this.initialized) throw new Error('MerkleTreeService not initialized');
        if (this.leaves.length === 0) return this.zeros[this.levels - 1]; // Approximate for empty tree logic
        return this.computeRootFromLeaves(this.leaves);
    }

    private computeRootFromLeaves(leaves: bigint[]): bigint {
        // Recompute root (simple naive implementation for verification).
        // In production, this could be optimized by caching intermediate nodes.
        let layer = [...leaves];

        for (let level = 0; level < this.levels; level++) {
            const nextLevel: bigint[] = [];

            for (let i = 0; i < layer.length; i += 2) {
                const left = layer[i];
                const right = (i + 1 < layer.length) ? layer[i + 1] : this.zeros[level];
                nextLevel.push(this.hashLeftRight(left, right));
            }

            layer = nextLevel;

            // Keep folding all the way up to configured tree height.
            // This must match the circuit's fixed-depth Merkle path semantics.
            if (layer.length === 0) {
                layer = [this.zeros[level]];
            }
        }

        return layer[0] ?? this.zeros[this.levels - 1];
    }

    // Correct logic for root update
    // We'll update this properly in getProof

    /**
     * Generate Merkle Proof for a credential
     */
    generateProof(credentialHash: bigint): MerkleProof {
        if (!this.initialized) throw new Error('MerkleTreeService not initialized');

        const index = this.leafToIndex.get(credentialHash);
        if (index === undefined) throw new Error('Credential not found in tree');

        const siblings: bigint[] = [];
        const pathIndices: number[] = [];
        let currentIndex = index;

        // Reconstruct tree state on the fly (since we only store leaves)
        // Ideally we cache the tree structure.

        let currentLayer = [...this.leaves];

        for (let l = 0; l < this.levels; l++) {
            const isRight = currentIndex % 2 === 1;
            const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

            pathIndices.push(isRight ? 1 : 0);

            let siblingValue: bigint;
            if (siblingIndex < currentLayer.length) {
                siblingValue = currentLayer[siblingIndex];
            } else {
                siblingValue = this.zeros[l];
            }
            siblings.push(siblingValue);

            // Move to next layer
            const nextLayer: bigint[] = [];
            for (let i = 0; i < currentLayer.length; i += 2) {
                const left = currentLayer[i];
                const right = (i + 1 < currentLayer.length) ? currentLayer[i + 1] : this.zeros[l];
                nextLayer.push(this.hashLeftRight(left, right));
            }
            currentLayer = nextLayer;
            currentIndex = Math.floor(currentIndex / 2);
        }

        return {
            root: currentLayer[0], // The last item is the root
            siblings,
            pathIndices
        };
    }

    // For syncing from blockchain
    setLeaves(leaves: bigint[]) {
        this.leaves = leaves;
        this.leafToIndex.clear();
        leaves.forEach((leaf, idx) => this.leafToIndex.set(leaf, idx));
    }

    getLeafCount(): number {
        return this.leaves.length;
    }
}

export const merkleTreeService = new MerkleTreeService();
