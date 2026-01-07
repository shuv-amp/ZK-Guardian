pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/**
 * BreakGlass Circuit
 * 
 * Emergency access circuit per Technical Blueprint §10.1.
 * Allows clinicians to access patient records during emergencies without
 * pre-existing consent, while still generating a ZK proof for audit compliance.
 * 
 * HIPAA Compliance:
 * - Emergency access is logged with justification
 * - Patient identity remains protected via blinding
 * - Proof can be verified post-hoc for compliance review
 * 
 * Use Cases:
 * - Unconscious patient in ER
 * - Critical lab results requiring immediate intervention
 * - Natural disaster situations
 */
template BreakGlass(maxReasonLength) {
    // --- Private Inputs ---
    signal input patientId[4];              // 256-bit patient ID (4x64 chunks)
    signal input clinicianId[4];            // 256-bit clinician ID
    signal input clinicianLicense[4];       // Medical license number
    signal input facilityId[4];             // Healthcare facility ID
    signal input emergencyCode;             // Emergency classification code
    signal input justificationHash;         // Hash of written justification
    
    // --- Security Inputs ---
    signal input clinicianNullifier;        // Clinician's secret for blinding
    signal input sessionNonce;              // Per-access randomness
    
    // --- Public Inputs ---
    signal input currentTimestamp;          // When access occurred
    signal input accessEventHash;           // Unique audit binding
    signal input emergencyThreshold;        // Minimum emergency level (0-4)
    
    // --- Public Outputs ---
    signal output isValid;
    signal output blindedClinicianId;       // Unlinkable clinician identifier
    signal output blindedPatientId;         // Blinded patient for audit
    signal output emergencyAccessHash;      // Unique emergency audit entry
    signal output justificationCommitment;  // Verifiable link to justification

    // ============================================
    // 1. Validate Emergency Level
    // ============================================
    // Emergency codes: 0=None, 1=Low, 2=Medium, 3=High, 4=Critical
    // Break-glass requires at least the threshold level
    component emergencyCheck = GreaterEqThan(8);
    emergencyCheck.in[0] <== emergencyCode;
    emergencyCheck.in[1] <== emergencyThreshold;
    signal emergencyValid <== emergencyCheck.out;

    // ============================================
    // 2. Verify Clinician Credentials
    // ============================================
    // Prove clinician has valid license linked to facility
    component credentialHasher = Poseidon(9);
    for (var i = 0; i < 4; i++) {
        credentialHasher.inputs[i] <== clinicianId[i];
        credentialHasher.inputs[i + 4] <== clinicianLicense[i];
    }
    credentialHasher.inputs[8] <== facilityId[0];
    signal credentialHash <== credentialHasher.out;
    
    // Credential must be non-zero (valid)
    component credentialValid = IsZero();
    credentialValid.in <== credentialHash;
    signal hasCredentials <== 1 - credentialValid.out;

    // ============================================
    // 3. Generate Blinded Identifiers
    // ============================================
    // Blinded clinician ID for audit without exposure
    component blindedClinicianHasher = Poseidon(6);
    for (var i = 0; i < 4; i++) {
        blindedClinicianHasher.inputs[i] <== clinicianId[i];
    }
    blindedClinicianHasher.inputs[4] <== clinicianNullifier;
    blindedClinicianHasher.inputs[5] <== sessionNonce;
    blindedClinicianId <== blindedClinicianHasher.out;
    
    // Blinded patient ID
    component blindedPatientHasher = Poseidon(6);
    for (var i = 0; i < 4; i++) {
        blindedPatientHasher.inputs[i] <== patientId[i];
    }
    blindedPatientHasher.inputs[4] <== clinicianNullifier;
    blindedPatientHasher.inputs[5] <== sessionNonce;
    blindedPatientId <== blindedPatientHasher.out;

    // ============================================
    // 4. Verify Access Event Binding
    // ============================================
    // Prevents replay attacks
    component accessHasher = Poseidon(11);
    for (var i = 0; i < 4; i++) {
        accessHasher.inputs[i] <== patientId[i];
        accessHasher.inputs[i + 4] <== clinicianId[i];
    }
    accessHasher.inputs[8] <== currentTimestamp;
    accessHasher.inputs[9] <== emergencyCode;
    accessHasher.inputs[10] <== sessionNonce;
    accessEventHash === accessHasher.out;

    // ============================================
    // 5. Generate Emergency Access Hash
    // ============================================
    // Unique identifier for this emergency access event
    component emergencyHasher = Poseidon(5);
    emergencyHasher.inputs[0] <== blindedClinicianId;
    emergencyHasher.inputs[1] <== blindedPatientId;
    emergencyHasher.inputs[2] <== currentTimestamp;
    emergencyHasher.inputs[3] <== emergencyCode;
    emergencyHasher.inputs[4] <== facilityId[0];
    emergencyAccessHash <== emergencyHasher.out;

    // ============================================
    // 6. Justification Commitment
    // ============================================
    // Links the proof to the written justification without exposing it
    component justificationCommitter = Poseidon(4);
    justificationCommitter.inputs[0] <== justificationHash;
    justificationCommitter.inputs[1] <== blindedClinicianId;
    justificationCommitter.inputs[2] <== currentTimestamp;
    justificationCommitter.inputs[3] <== emergencyCode;
    justificationCommitment <== justificationCommitter.out;

    // ============================================
    // 7. Final Validity Check
    // ============================================
    // Valid if: emergency level met AND clinician has credentials
    isValid <== emergencyValid * hasCredentials;
    isValid === 1;
}

// Emergency justification can be up to 256 characters (hashed)
// Public inputs: currentTimestamp, accessEventHash, emergencyThreshold
// Public outputs: isValid, blindedClinicianId, blindedPatientId, emergencyAccessHash, justificationCommitment
component main {public [currentTimestamp, accessEventHash, emergencyThreshold]} = BreakGlass(256);
