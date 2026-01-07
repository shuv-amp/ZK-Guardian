/**
 * @zk-guardian/sdk
 * 
 * Zero-Knowledge Proof SDK for Healthcare Consent Verification
 * 
 * This SDK provides:
 * - ZK proof generation for consent verification
 * - Consent hash generation from FHIR resources
 * - Nullifier management for privacy
 * - Smart contract interaction utilities
 */

// Core exports
export { ZKGuardianClient, type ZKGuardianConfig } from './client';
export { ProofGenerator, type ProofResult, type ProofInputs } from './proof';
export { ConsentHasher, type FHIRConsent, type ConsentHash } from './consent';
export { NullifierManager, type NullifierState } from './nullifier';

// Circuit types
export {
    type AccessIsAllowedInputs,
    type AccessIsAllowedSecureInputs,
    type BreakGlassInputs,
    type CircuitType
} from './circuits/types';

// Contract interaction
export {
    AuditContract,
    RevocationContract,
    type AuditEvent,
    type RevocationEvent
} from './contracts';

// Utilities
export {
    poseidonHash,
    splitId,
    stringToFieldElements,
    formatProofForSolidity
} from './utils';

// Constants
export {
    CIRCUIT_NAMES,
    CHAIN_IDS,
    CONTRACT_ADDRESSES
} from './constants';
