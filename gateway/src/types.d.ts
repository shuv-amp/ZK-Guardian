declare module 'circomlibjs' {
    export function buildPoseidon(): Promise<{
        F: any;
        (inputs: any[]): any;
    }>;
}

declare module 'snarkjs' {
    export const groth16: {
        fullProve(input: any, wasmFile: string, zkeyFile: string): Promise<{ proof: any; publicSignals: any }>;
        verify(vKey: any, publicSignals: any, proof: any): Promise<boolean>;
        exportSolidityCallData(proof: any, publicSignals: any): Promise<string>;
    };
    export const zkey: {
        exportVerificationKey(zkeyName: string): Promise<any>;
    };
}

// SMART on FHIR Context (per SMART App Launch spec)
interface SMARTContext {
    /** Subject identifier (user ID) */
    sub: string;
    /** Patient ID from launch context */
    patient?: string;
    /** Practitioner ID if clinician */
    practitioner?: string;
    /** Granted scopes */
    scope: string;
    /** Issuer URL */
    iss: string;
    /** Token expiration timestamp */
    exp: number;
    /** User's display name */
    name?: string;
    /** User's department (if available in claims) */
    department?: string;
    /** FHIR User reference */
    fhirUser?: string;
}

// Extend Express Request
declare namespace Express {
    export interface Request {
        smartContext?: SMARTContext;
        zkAudit?: {
            proofHash: string;
            txHash: string;
            accessEventHash: string;
        };
        requestId?: string;
        logger?: import('pino').Logger;
    }
}
