pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/**
 * AccessIsAllowed Circuit
 * 
 * Verifies that a healthcare access request matches a valid patient consent policy
 * without exposing underlying PII or specific resource data.
 * 
 * Core Logic:
 * 1. Validates the access event binding (Patient + Resource + Time).
 * 2. Checks if the requested resource type fits within allowed categories.
 * 3. Enforces the consent validity time window.
 * 4. Verifies the integrity of the consent policy commitment.
 */
template AccessIsAllowed(maxCategories) {
    // --- Private Inputs ---
    signal input patientId[4];              // 256-bit patient ID (4x64 chunks)
    signal input clinicianId[4];            // 256-bit clinician ID
    signal input consentPolicyHash;         // Hash of the FHIR Consent resource
    signal input requestedResourceId[4];    // Resource being accessed
    signal input allowedResourceCategories[maxCategories]; // Whitelisted category hashes
    signal input validFromTimestamp;        // Start time (Unix)
    signal input validToTimestamp;          // End time (Unix)
    
    // --- Public Inputs ---
    signal input proofOfPolicyMatch;        // Commitment to the active policy
    signal input currentTimestamp;          // Current block timestamp
    signal input accessEventHash;           // Unique audit log binding
    
    signal output isValid;

    // 1. Verify Access Event Binding
    // Prevents replay attacks by binding the proof to this specific access attempt.
    component accessHasher = Poseidon(9);
    for (var i = 0; i < 4; i++) {
        accessHasher.inputs[i] <== patientId[i];
        accessHasher.inputs[i + 4] <== requestedResourceId[i];
    }
    accessHasher.inputs[8] <== currentTimestamp;
    accessEventHash === accessHasher.out;
    
    // 2. Resource Category Match
    // Hash the requested resource and check against the allowlist.
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
    
    // 3. Temporal Validity
    // Ensure access is within the consent window [validFrom, validTo].
    component afterStart = GreaterEqThan(64);
    afterStart.in[0] <== currentTimestamp;
    afterStart.in[1] <== validFromTimestamp;
    
    component beforeEnd = LessEqThan(64);
    beforeEnd.in[0] <== currentTimestamp;
    beforeEnd.in[1] <== validToTimestamp;
    
    signal timeValid <== afterStart.out * beforeEnd.out;
    
    // 4. Policy Commitment Verification
    // Proves that the consent hash actually corresponds to the agreed-upon policy.
    component policyHasher = Poseidon(5);
    policyHasher.inputs[0] <== consentPolicyHash;
    policyHasher.inputs[1] <== clinicianId[0];
    policyHasher.inputs[2] <== clinicianId[1];
    policyHasher.inputs[3] <== validFromTimestamp;
    policyHasher.inputs[4] <== validToTimestamp;
    
    proofOfPolicyMatch === policyHasher.out;
    
    // Final check
    isValid <== categoryValid * timeValid;
    isValid === 1;
}

// Instantiate with support for 8 resource categories (standard FHIR granularity)
component main {public [proofOfPolicyMatch, currentTimestamp, accessEventHash]} = AccessIsAllowed(8);

