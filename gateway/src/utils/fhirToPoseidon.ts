import { buildPoseidon } from "circomlibjs";
import { parseFieldElementInput } from "../lib/fieldEncoding.js";
import crypto from "crypto";

// --- Types ---

// Partial FHIR R4 Consent definition focusing on relevant fields
export interface FhirConsent {
    resourceType: "Consent";
    id: string;
    status: "draft" | "proposed" | "active" | "rejected" | "inactive" | "entered-in-error";
    scope?: {
        coding?: Array<{
            system?: string;
            code?: string;
            display?: string;
        }>;
    };
    category?: Array<{
        coding?: Array<{
            system?: string;
            code?: string;
            display?: string;
        }>;
    }>;
    patient?: { reference: string };
    subject?: { reference: string }; // 'subject' is standard in R4, usually same as patient
    dateTime?: string;
    provision?: FhirProvision;
}

export interface FhirProvision {
    type?: "deny" | "permit";
    period?: {
        start?: string;
        end?: string;
    };
    actor?: Array<{
        role: {
            coding: Array<{ system?: string; code?: string; display?: string }>;
        };
        reference: { reference: string };
    }>;
    action?: Array<{ coding?: Array<{ code?: string }> }>;
    class?: Array<{ code?: string; display?: string }>;
    code?: Array<{ coding?: Array<{ code?: string }> }>;
    provision?: FhirProvision[];
}

export interface CircuitInputs {
    // Private Inputs
    patientId: string[];
    clinicianId: string[];
    consentPolicyHash: string;
    requestedResourceId: string[];
    allowedResourceCategories: string[];
    validFromTimestamp: string;
    validToTimestamp: string;
    patientNullifier: string;
    sessionNonce: string;

    // Public Inputs
    proofOfPolicyMatch: string;
    currentTimestamp: string;
    accessEventHash: string;
}

// --- Singleton Poseidon Instance ---

let poseidonInstance: any = null;
let F: any = null;

export async function initPoseidon() {
    if (!poseidonInstance) {
        poseidonInstance = await buildPoseidon();
        F = poseidonInstance.F;
    }
    return { poseidon: poseidonInstance, F };
}

// --- Utils ---

/**
 * Converts a string to a field element (BigInt string) compatible with BN254.
 * Uses SHA-256 and truncates to 31 bytes to fit in the field.
 */
export function stringToFieldElement(str: string): string {
    const hash = crypto.createHash("sha256").update(str).digest();
    // Take first 31 bytes (248 bits) to fit in BN254 field (~254 bits)
    return BigInt("0x" + hash.slice(0, 31).toString("hex")).toString();
}

/**
 * Splits a large identifier string into 4 x 64-bit field elements.
 * Returns array of 4 BigInt strings.
 */
export function splitIdToFields(id: string): string[] {
    const hashBigInt = BigInt(stringToFieldElement(id));

    return [
        ((hashBigInt >> 192n) & 0xFFFFFFFFFFFFFFFFn).toString(),
        ((hashBigInt >> 128n) & 0xFFFFFFFFFFFFFFFFn).toString(),
        ((hashBigInt >> 64n) & 0xFFFFFFFFFFFFFFFFn).toString(),
        (hashBigInt & 0xFFFFFFFFFFFFFFFFn).toString()
    ];
}

/**
 * Recursively extracts provision details for hashing.
 */
function extractProvisions(provision?: FhirProvision): any[] {
    if (!provision) return [];

    const provisions: any[] = [];

    const processProvision = (p: FhirProvision) => {
        if (p.type) {
            provisions.push({ type: p.type });
        }
        if (p.action) {
            provisions.push(...p.action.map(a => ({
                action: a.coding?.[0]?.code
            })));
        }
        if (p.class) {
            provisions.push(...p.class.map(c => ({
                class: c.code || c.display
            })));
        }
        // Recurse
        if (p.provision && Array.isArray(p.provision)) {
            p.provision.forEach(processProvision);
        }
    };

    processProvision(provision);
    return provisions;
}

/**
 * Hashes provisions structure using Poseidon.
 * Pads to minimum 2 elements if empty.
 */
async function hashProvisions(provisions: any[], maxProvisions = 8): Promise<string> {
    const { poseidon, F } = await initPoseidon();

    if (provisions.length === 0) {
        return "0";
    }

    // JSON stringify each provision object and hash it
    const elements = provisions.slice(0, maxProvisions).map(p =>
        BigInt(stringToFieldElement(JSON.stringify(p)))
    );

    // Pad
    while (elements.length < 2) {
        elements.push(0n);
    }

    const hash = poseidon(elements);
    return F.toString(hash);
}

// --- Main Functions ---

/**
 * Hashes a FHIR Consent resource into a single Poseidon hash.
 */
export async function hashFhirConsent(consentResource: FhirConsent): Promise<string> {
    const { poseidon, F } = await initPoseidon();

    if (!consentResource.id) {
        throw new Error("Invalid FHIR Consent: missing id");
    }

    const consentData = {
        id: consentResource.id,
        status: consentResource.status || "active",
        scope: consentResource.scope?.coding?.[0]?.code || "patient-privacy",
        patientRef: consentResource.subject?.reference ||
            consentResource.patient?.reference || "",
        provisions: extractProvisions(consentResource.provision),
        validFrom: new Date(
            consentResource.provision?.period?.start ||
            consentResource.dateTime ||
            0
        ).getTime() / 1000,
        validTo: new Date(
            consentResource.provision?.period?.end ||
            "2099-12-31T23:59:59Z"
        ).getTime() / 1000
    };

    const fieldElements = [
        BigInt(stringToFieldElement(consentData.id)),
        BigInt(stringToFieldElement(consentData.status)),
        BigInt(stringToFieldElement(consentData.scope)),
        BigInt(stringToFieldElement(consentData.patientRef)),
        BigInt(Math.floor(consentData.validFrom)),
        BigInt(Math.floor(consentData.validTo))
    ];

    const provisionsHash = await hashProvisions(consentData.provisions);
    fieldElements.push(BigInt(provisionsHash));

    // Pad if necessary for Poseidon (min 1 input, handled by array)
    const hash = poseidon(fieldElements.slice(0, 7));
    return F.toString(hash);
}

/**
 * Extracts allowed resource categories from the consent provision.
 * Returns the Poseidon hash of the categories to match circuit expectations.
 */
export async function extractAllowedCategories(provision?: FhirProvision, maxCategories = 8): Promise<string[]> {
    const categories: string[] = [];
    const { poseidon, F } = await initPoseidon();

    // Helper to process code and add its Poseidon(Split(Hash)) to categories
    const addCategory = (code: string) => {
        if (!code) return;
        if (categories.length >= maxCategories) return;

        // Hash the code string (SHA256 -> Field), split it, then Poseidon hash the chunks.
        // This mirrors exactly how the circuit processes the 'requestedResourceId' input.
        const chunks = splitIdToFields(code);
        const chunksBigInt = chunks.map(c => BigInt(c));
        const circuitHash = F.toString(poseidon(chunksBigInt));

        categories.push(circuitHash);
    };

    const processProvision = (p: FhirProvision) => {
        // Check p.class
        if (p?.class && Array.isArray(p.class)) {
            p.class.forEach(c => {
                addCategory(c.code || c.display || "");
            });
        }

        // Check p.code
        if (p?.code && Array.isArray(p.code)) {
            p.code.forEach(codeExpr => {
                codeExpr.coding?.forEach(c => {
                    addCategory(c.code || "");
                });
            });
        }

        if (p?.provision && Array.isArray(p.provision)) {
            p.provision.forEach(processProvision);
        }
    };

    if (provision) {
        processProvision(provision);
    }

    while (categories.length < maxCategories) {
        categories.push("0");
    }

    return categories;
}

/**
 * Main Entry Point: Prepares all inputs for the AccessIsAllowed circuit.
 */
export async function prepareCircuitInputs({
    consent,
    patientId,
    clinicianId,
    resourceId,
    resourceType,
    timestamp,
    patientNullifier,
    sessionNonce
}: {
    consent: FhirConsent;
    patientId: string;
    clinicianId: string;
    resourceId: string;
    resourceType: string;
    timestamp: number;
    patientNullifier: string;
    sessionNonce: string;
}): Promise<CircuitInputs> {
    const { poseidon, F } = await initPoseidon();

    // 1. Consent Hash
    const consentHash = await hashFhirConsent(consent);

    // 2. ID Fields
    const patientFields = splitIdToFields(patientId);
    const clinicianFields = splitIdToFields(clinicianId);

    // CRITICAL: Use resourceType for circuit matching, not resourceId
    // The circuit compares resourceHash against allowedResourceCategories
    // Both need to be Poseidon(split(hash(TYPE_NAME)))
    const resourceTypeFields = splitIdToFields(resourceType);

    // 3. Allowed Categories - these are Poseidon hashes of resource TYPE names
    const allowedCategories = await extractAllowedCategories(consent.provision);

    // 4. Validity Period
    const validFrom = Math.floor(new Date(
        consent.provision?.period?.start ||
        consent.dateTime ||
        0
    ).getTime() / 1000);

    const validTo = Math.floor(new Date(
        consent.provision?.period?.end ||
        "2099-12-31T23:59:59Z"
    ).getTime() / 1000);

    // 5. Public Commitments calculation (to match what Circuit computes)

    // proofOfPolicyMatch
    const policyMatchHash = F.toString(poseidon([
        BigInt(consentHash),
        BigInt(clinicianFields[0]),
        BigInt(clinicianFields[1]),
        BigInt(validFrom),
        BigInt(validTo)
    ]));

    // accessEventHash includes the actual resourceId for audit tracing
    // CRITICAL: Must use resourceTypeFields (same as requestedResourceId) for consistency with circuit
    // The circuit computes: Poseidon(patientId[4], requestedResourceId[4], timestamp, sessionNonce)
    // So we must use the same fields here
    const accessEventHash = F.toString(poseidon([
        BigInt(patientFields[0]), BigInt(patientFields[1]), BigInt(patientFields[2]), BigInt(patientFields[3]),
        BigInt(resourceTypeFields[0]), BigInt(resourceTypeFields[1]), BigInt(resourceTypeFields[2]), BigInt(resourceTypeFields[3]),
        BigInt(timestamp),
        parseFieldElementInput(sessionNonce)
    ]));

    return {
        // Private
        patientId: patientFields,
        clinicianId: clinicianFields,
        consentPolicyHash: consentHash,
        requestedResourceId: resourceTypeFields, // Use TYPE for category matching
        allowedResourceCategories: allowedCategories,
        validFromTimestamp: String(validFrom),
        validToTimestamp: String(validTo),
        patientNullifier,
        sessionNonce,

        // Public
        proofOfPolicyMatch: policyMatchHash,
        currentTimestamp: String(timestamp),
        accessEventHash: accessEventHash
    };
}
