/**
 * Circuit Types
 * 
 * TypeScript types for circuit inputs and outputs.
 */

export type CircuitType = 'AccessIsAllowed' | 'AccessIsAllowedSecure' | 'BreakGlass';

/**
 * Inputs for AccessIsAllowed circuit
 */
export interface AccessIsAllowedInputs {
    // Private inputs
    patientId: [bigint, bigint, bigint, bigint];
    clinicianId: [bigint, bigint, bigint, bigint];
    consentPolicyHash: bigint;
    requestedResourceId: [bigint, bigint, bigint, bigint];
    allowedResourceCategories: bigint[];
    validFromTimestamp: bigint;
    validToTimestamp: bigint;

    // Public inputs
    proofOfPolicyMatch: bigint;
    currentTimestamp: bigint;
    accessEventHash: bigint;
}

/**
 * Outputs from AccessIsAllowed circuit
 */
export interface AccessIsAllowedOutputs {
    isValid: bigint;
}

/**
 * Inputs for AccessIsAllowedSecure circuit (with nullifier)
 */
export interface AccessIsAllowedSecureInputs extends AccessIsAllowedInputs {
    // Additional nullifier inputs
    patientNullifier: bigint;
    sessionNonce: bigint;
}

/**
 * Outputs from AccessIsAllowedSecure circuit
 */
export interface AccessIsAllowedSecureOutputs {
    isValid: bigint;
    blindedPatientId: bigint;
    blindedAccessHash: bigint;
    nullifierHash: bigint;
}

/**
 * Inputs for BreakGlass circuit
 */
export interface BreakGlassInputs {
    // Private inputs
    patientId: [bigint, bigint, bigint, bigint];
    clinicianId: [bigint, bigint, bigint, bigint];
    clinicianLicense: [bigint, bigint, bigint, bigint];
    facilityId: [bigint, bigint, bigint, bigint];
    emergencyCode: bigint;
    justificationHash: bigint;

    // Nullifier inputs
    clinicianNullifier: bigint;
    sessionNonce: bigint;

    // Public inputs
    currentTimestamp: bigint;
    accessEventHash: bigint;
    emergencyThreshold: bigint;
}

/**
 * Outputs from BreakGlass circuit
 */
export interface BreakGlassOutputs {
    isValid: bigint;
    blindedClinicianId: bigint;
    blindedPatientId: bigint;
    emergencyAccessHash: bigint;
    justificationCommitment: bigint;
}

/**
 * Public signals mapping for each circuit
 */
export const PUBLIC_SIGNALS = {
    AccessIsAllowed: ['proofOfPolicyMatch', 'currentTimestamp', 'accessEventHash'],
    AccessIsAllowedSecure: ['proofOfPolicyMatch', 'currentTimestamp', 'accessEventHash'],
    BreakGlass: ['currentTimestamp', 'accessEventHash', 'emergencyThreshold']
} as const;

/**
 * Output signals mapping for each circuit
 */
export const OUTPUT_SIGNALS = {
    AccessIsAllowed: ['isValid'],
    AccessIsAllowedSecure: ['isValid', 'blindedPatientId', 'blindedAccessHash', 'nullifierHash'],
    BreakGlass: ['isValid', 'blindedClinicianId', 'blindedPatientId', 'emergencyAccessHash', 'justificationCommitment']
} as const;
