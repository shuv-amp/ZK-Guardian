/**
 * Constants
 */

export const CIRCUIT_NAMES = {
    ACCESS_IS_ALLOWED: 'AccessIsAllowed',
    ACCESS_IS_ALLOWED_SECURE: 'AccessIsAllowedSecure',
    BREAK_GLASS: 'BreakGlass'
} as const;

export const CHAIN_IDS = {
    POLYGON_MAINNET: 137,
    POLYGON_AMOY: 80002,
    ETHEREUM_MAINNET: 1,
    ETHEREUM_SEPOLIA: 11155111
} as const;

export const CONTRACT_ADDRESSES = {
    // Polygon Amoy Testnet (to be updated after deployment)
    [CHAIN_IDS.POLYGON_AMOY]: {
        verifier: '0x0000000000000000000000000000000000000000',
        audit: '0x0000000000000000000000000000000000000000',
        revocation: '0x0000000000000000000000000000000000000000'
    }
} as const;

// Field modulus for BN254 (used in ZK circuits)
export const FIELD_MODULUS = BigInt(
    '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// Maximum categories in consent (circuit parameter)
export const MAX_CONSENT_CATEGORIES = 8;

// Emergency codes for break-glass
export const EMERGENCY_CODES = {
    NONE: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4
} as const;

// FHIR resource categories
export const FHIR_CATEGORIES = {
    LABORATORY: 'laboratory',
    CLINICAL: 'clinical-note',
    IMAGING: 'imaging',
    PHARMACY: 'pharmacy',
    IMMUNIZATION: 'immunization',
    VITAL_SIGNS: 'vital-signs',
    SOCIAL_HISTORY: 'social-history',
    ALLERGIES: 'allergies'
} as const;
