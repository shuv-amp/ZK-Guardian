pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/**
 * AccessIsAllowedSecure Circuit
 * 
 * Enhanced version of AccessIsAllowed with nullifier protection to prevent
 * brute-force de-anonymization attacks on on-chain audit data.
 * 
 * Security Enhancements (per Technical Blueprint §6.1):
 * 1. patientNullifier - Patient's secret key for blinding on-chain hashes
 * 2. sessionNonce - Per-session randomness to prevent correlation
 * 3. blindedPatientId - Public output that hides true patient identity
 * 
 * Core Logic:
 * 1. Validates the access event binding (Patient + Resource + Time)
 * 2. Checks if the requested resource type fits within allowed categories
 * 3. Enforces the consent validity time window
 * 4. Verifies the integrity of the consent policy commitment
 * 5. Generates blinded identifiers for on-chain storage
 */
template AccessIsAllowedSecure(maxCategories) {
    // --- Private Inputs ---
    signal input patientId[4];              // 256-bit patient ID (4x64 chunks)
    signal input clinicianId[4];            // 256-bit clinician ID
    signal input consentPolicyHash;         // Hash of the FHIR Consent resource
    signal input requestedResourceId[4];    // Resource being accessed
    signal input allowedResourceCategories[maxCategories]; // Whitelisted category hashes
    signal input validFromTimestamp;        // Start time (Unix)
    signal input validToTimestamp;          // End time (Unix)
    
    // --- Nullifier Inputs (NEW for security) ---
    signal input patientNullifier;          // Patient's secret nullifier key
    signal input sessionNonce;              // Random nonce per session
    
    // --- Public Inputs ---
    signal input proofOfPolicyMatch;        // Commitment to the active policy
    signal input currentTimestamp;          // Current block timestamp
    signal input accessEventHash;           // Unique audit log binding
    
    // --- Public Outputs (NEW for nullifier protection) ---
    signal output isValid;
    signal output blindedPatientId;         // Unlinkable patient identifier
    signal output blindedAccessHash;        // Blinded audit trail entry
    signal output nullifierHash;            // Prevents double-spending of consent

    // ============================================
    // 1. Generate Nullifier Hash (prevents replay across sessions)
    // ============================================
    // nullifierHash = Poseidon(patientNullifier, consentPolicyHash)
    // This value is stored on-chain to prevent reusing the same consent
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== patientNullifier;
    nullifierHasher.inputs[1] <== consentPolicyHash;
    nullifierHash <== nullifierHasher.out;

    // ============================================
    // 2. Generate Blinded Patient ID (unlinkable across accesses)
    // ============================================
    // blindedPatientId = Poseidon(patientId, patientNullifier, sessionNonce)
    // Different for each session, preventing correlation analysis
    component blindedIdHasher = Poseidon(6);
    for (var i = 0; i < 4; i++) {
        blindedIdHasher.inputs[i] <== patientId[i];
    }
    blindedIdHasher.inputs[4] <== patientNullifier;
    blindedIdHasher.inputs[5] <== sessionNonce;
    blindedPatientId <== blindedIdHasher.out;

    // ============================================
    // 3. Verify Access Event Binding (with blinding)
    // ============================================
    // Prevents replay attacks by binding the proof to this specific access attempt + nonce
    component accessHasher = Poseidon(10);
    for (var i = 0; i < 4; i++) {
        accessHasher.inputs[i] <== patientId[i];
        accessHasher.inputs[i + 4] <== requestedResourceId[i];
    }
    accessHasher.inputs[8] <== currentTimestamp;
    accessHasher.inputs[9] <== sessionNonce;
    accessEventHash === accessHasher.out;
    
    // Generate blinded access hash for on-chain storage
    component blindedAccessHasher = Poseidon(3);
    blindedAccessHasher.inputs[0] <== accessHasher.out;
    blindedAccessHasher.inputs[1] <== patientNullifier;
    blindedAccessHasher.inputs[2] <== sessionNonce;
    blindedAccessHash <== blindedAccessHasher.out;
    
    // ============================================
    // 4. Resource Category Match
    // ============================================
    // Hash the requested resource and check against the allowlist
    component resourceHasher = Poseidon(4);
    for (var i = 0; i < 4; i++) {
        resourceHasher.inputs[i] <== requestedResourceId[i];
    }
    signal resourceHash <== resourceHasher.out;
    
    component categoryChecks[maxCategories];
    signal categoryMatch[maxCategories];
    signal runningSum[maxCategories + 1];
    runningSum[0] <== 0;
    
    for (var i = 0; i < maxCategories; i++) {
        categoryChecks[i] = IsEqual();
        categoryChecks[i].in[0] <== resourceHash;
        categoryChecks[i].in[1] <== allowedResourceCategories[i];
        categoryMatch[i] <== categoryChecks[i].out;
        runningSum[i + 1] <== runningSum[i] + categoryMatch[i];
    }
    
    // Ensure at least one category matched
    component hasMatch = GreaterThan(8);
    hasMatch.in[0] <== runningSum[maxCategories];
    hasMatch.in[1] <== 0;
    signal categoryValid <== hasMatch.out;
    
    // ============================================
    // 5. Temporal Validity
    // ============================================
    // Ensure access is within the consent window [validFrom, validTo]
    component afterStart = GreaterEqThan(64);
    afterStart.in[0] <== currentTimestamp;
    afterStart.in[1] <== validFromTimestamp;
    
    component beforeEnd = LessEqThan(64);
    beforeEnd.in[0] <== currentTimestamp;
    beforeEnd.in[1] <== validToTimestamp;
    
    signal timeValid <== afterStart.out * beforeEnd.out;
    
    // ============================================
    // 6. Policy Commitment Verification
    // ============================================
    // Proves that the consent hash actually corresponds to the agreed-upon policy
    component policyHasher = Poseidon(5);
    policyHasher.inputs[0] <== consentPolicyHash;
    policyHasher.inputs[1] <== clinicianId[0];
    policyHasher.inputs[2] <== clinicianId[1];
    policyHasher.inputs[3] <== validFromTimestamp;
    policyHasher.inputs[4] <== validToTimestamp;
    
    proofOfPolicyMatch === policyHasher.out;
    
    // ============================================
    // 7. Final Validity Check
    // ============================================
    isValid <== categoryValid * timeValid;
    isValid === 1;
}

// Instantiate with support for 8 resource categories (standard FHIR granularity)
// Public inputs: proofOfPolicyMatch, currentTimestamp, accessEventHash
// Public outputs: isValid, blindedPatientId, blindedAccessHash, nullifierHash
component main {public [proofOfPolicyMatch, currentTimestamp, accessEventHash]} = AccessIsAllowedSecure(8);
