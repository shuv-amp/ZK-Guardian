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

// Extend Express Request
declare namespace Express {
    export interface Request {
        smartContext?: {
            patient?: string;
            practitioner?: string;
            scope?: string;
            sub?: string;
        };
        zkAudit?: {
            proofHash: string;
            txHash: string;
            accessEventHash: string;
        };
    }
}
