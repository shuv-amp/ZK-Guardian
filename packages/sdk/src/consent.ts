/**
 * Consent Hasher
 * 
 * Generates Poseidon hashes from FHIR Consent resources.
 */

import { buildPoseidon } from 'circomlibjs';
import { stringToFieldElements, splitId } from './utils';

// Helper type for the Poseidon hasher
type Poseidon = any;

export interface FHIRConsent {
    resourceType: 'Consent';
    id?: string;
    status: 'draft' | 'proposed' | 'active' | 'rejected' | 'inactive' | 'entered-in-error';
    scope: {
        coding: Array<{
            system: string;
            code: string;
        }>;
    };
    patient: {
        reference: string;
    };
    dateTime?: string;
    provision?: {
        type?: 'deny' | 'permit';
        period?: {
            start?: string;
            end?: string;
        };
        actor?: Array<{
            role: {
                coding: Array<{
                    system: string;
                    code: string;
                }>;
            };
            reference: {
                reference: string;
            };
        }>;
        class?: Array<{
            system: string;
            code: string;
        }>;
    };
}

export interface ConsentHash {
    hash: string;
    patientId: string;
    validFrom: number;
    validTo: number;
    categories: string[];
    raw: {
        id: string;
        status: string;
        scope: string;
    };
}

let poseidon: Poseidon | null = null;

async function getPoseidon(): Promise<Poseidon> {
    if (!poseidon) {
        poseidon = await buildPoseidon();
    }
    return poseidon;
}

export class ConsentHasher {
    /**
     * Hash a FHIR Consent resource
     */
    async hash(consent: FHIRConsent): Promise<ConsentHash> {
        const poseidon = await getPoseidon();
        const F = poseidon.F;

        // Extract key fields
        const consentId = consent.id || '';
        const status = consent.status;
        const scope = consent.scope?.coding?.[0]?.code || '';
        const patientRef = consent.patient?.reference || '';
        const patientId = patientRef.replace('Patient/', '');

        // Extract validity period
        const provision = consent.provision;
        const validFrom = provision?.period?.start
            ? Math.floor(new Date(provision.period.start).getTime() / 1000)
            : 0;
        const validTo = provision?.period?.end
            ? Math.floor(new Date(provision.period.end).getTime() / 1000)
            : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // Default 1 year

        // Extract categories
        const categories = await this.extractCategories(consent);

        // Hash all fields
        const idElements = splitId(consentId);
        const statusHash = stringToFieldElements(status, 1)[0];
        const scopeHash = stringToFieldElements(scope, 1)[0];

        // Create main consent hash
        const fieldElements = [
            ...idElements,
            statusHash,
            scopeHash,
            BigInt(validFrom),
            BigInt(validTo)
        ];

        const hash = poseidon(fieldElements.slice(0, 7));

        return {
            hash: F.toString(hash),
            patientId,
            validFrom,
            validTo,
            categories,
            raw: {
                id: consentId,
                status,
                scope
            }
        };
    }

    /**
     * Extract and hash resource categories from consent
     */
    private async extractCategories(consent: FHIRConsent): Promise<string[]> {
        const poseidon = await getPoseidon();
        const F = poseidon.F;

        const categories: string[] = [];
        const provision = consent.provision;

        if (!provision) {
            return categories;
        }

        // Extract from class
        if (provision.class) {
            for (const c of provision.class) {
                const elements = stringToFieldElements(`${c.system}|${c.code}`, 4);
                const hash = poseidon(elements);
                categories.push(F.toString(hash));
            }
        }

        return categories;
    }

    /**
     * Hash a simple string (for justification, etc.)
     */
    async hashString(value: string): Promise<string> {
        const poseidon = await getPoseidon();
        const F = poseidon.F;

        const elements = stringToFieldElements(value, 4);
        const hash = poseidon(elements);

        return F.toString(hash);
    }

    /**
     * Verify that a consent matches a given hash
     */
    async verify(consent: FHIRConsent, expectedHash: string): Promise<boolean> {
        const result = await this.hash(consent);
        return result.hash === expectedHash;
    }
}
