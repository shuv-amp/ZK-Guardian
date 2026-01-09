pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";

/**
 * MerkleProof Verifier
 * 
 * Verifies that a leaf is part of a Merkle tree with a given root.
 * Uses Poseidon hash for efficiency in ZK circuits.
 * 
 * @param levels Number of levels in the tree (log2 of max leaves)
 */
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels]; // 0 = left, 1 = right
    signal input root;
    
    signal output valid;

    // Compute the Merkle root from leaf to root
    signal hashes[levels + 1];
    hashes[0] <== leaf;
    
    component hashers[levels];
    component muxLeft[levels];
    component muxRight[levels];
    
    for (var i = 0; i < levels; i++) {
        // Ensure pathIndices is binary
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        
        // Use Mux1 to select between current hash and sibling
        // If pathIndices[i] == 0: left = hashes[i], right = pathElements[i]
        // If pathIndices[i] == 1: left = pathElements[i], right = hashes[i]
        
        muxLeft[i] = MultiMux1(2);
        muxLeft[i].c[0][0] <== hashes[i];      // When s=0, select hashes[i] for left
        muxLeft[i].c[0][1] <== pathElements[i]; // When s=1, select pathElements[i] for left
        muxLeft[i].c[1][0] <== pathElements[i]; // When s=0, select pathElements[i] for right
        muxLeft[i].c[1][1] <== hashes[i];       // When s=1, select hashes[i] for right
        muxLeft[i].s <== pathIndices[i];
        
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxLeft[i].out[0]; // left
        hashers[i].inputs[1] <== muxLeft[i].out[1]; // right
        
        hashes[i + 1] <== hashers[i].out;
    }
    
    // Check if computed root matches expected root
    component isEqual = IsEqual();
    isEqual.in[0] <== hashes[levels];
    isEqual.in[1] <== root;
    valid <== isEqual.out;
}
