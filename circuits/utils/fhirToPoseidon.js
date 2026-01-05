const { buildPoseidon } = require("circomlibjs");
const crypto = require("crypto");

/**
 * FHIR Consent to Poseidon Hash Utility
 *
 * Handles the conversion of HL7 FHIR R4 Consent resources into ZK-friendly Poseidon hashes.
 * These operations run off-chain to prepare private inputs for the AccessIsAllowed circuit.
 */

// Cache Poseidon instance
let poseidonInstance = null;
let F = null;

/**
 * Initialize Poseidon hasher (call once at startup)
 */
async function initPoseidon() {
    if (!poseidonInstance) {
        poseidonInstance = await buildPoseidon();
        F = poseidonInstance.F;
    }
    return { poseidon: poseidonInstance, F };
}

/**
 * Converts a string to a field element that fits in BN254 curve
 * Uses SHA-256 then takes first 31 bytes (248 bits) to stay under field size
 * 
 * @param {string} str - Input string to hash
 * @returns {BigInt} - Field element compatible with Poseidon
 */
function stringToFieldElement(str) {
    const hash = crypto.createHash("sha256").update(str).digest();
    // Take first 31 bytes to fit in BN254 field (prime ~254 bits)
    return BigInt("0x" + hash.slice(0, 31).toString("hex"));
}

/**
 * Splits a large ID into 4 field elements (64-bit chunks)
 * This matches the circuit's patientId[4] and clinicianId[4] format
 * 
 * @param {string} id - Identifier to split
 * @returns {BigInt[]} - Array of 4 field elements
 */
function splitIdToFields(id) {
    const hash = stringToFieldElement(id);
    return [
        (hash >> 192n) & 0xFFFFFFFFFFFFFFFFn,
        (hash >> 128n) & 0xFFFFFFFFFFFFFFFFn,
        (hash >> 64n) & 0xFFFFFFFFFFFFFFFFn,
        hash & 0xFFFFFFFFFFFFFFFFn
    ];
}

/**
 * Extracts provision details from FHIR Consent resource
 * Handles nested provision structures per FHIR R4 spec
 * 
 * @param {Object} provision - FHIR Consent.provision
 * @returns {Object[]} - Flattened array of provision details
 */
function extractProvisions(provision) {
    if (!provision) return [];

    const provisions = [];

    const processProvision = (p) => {
        if (p.type) {
            provisions.push({ type: p.type });
        }

        if (p.action) {
            provisions.push(...p.action.map(a => ({
                action: a.coding?.[0]?.code || a.text
            })));
        }

        if (p.class) {
            provisions.push(...p.class.map(c => ({
                class: c.code || c.display
            })));
        }

        // FHIR allows nested provisions
        if (p.provision && Array.isArray(p.provision)) {
            p.provision.forEach(processProvision);
        }
    };

    processProvision(provision);
    return provisions;
}

/**
 * Hashes an array of provisions into a single field element
 * 
 * @param {Object[]} provisions - Array from extractProvisions()
 * @param {number} maxProvisions - Maximum provisions to hash (default 8)
 * @returns {string} - Poseidon hash as string
 */
async function hashProvisions(provisions, maxProvisions = 8) {
    const { poseidon, F } = await initPoseidon();

    if (provisions.length === 0) {
        return "0";
    }

    // Convert provisions to field elements
    const elements = provisions.slice(0, maxProvisions).map(p =>
        stringToFieldElement(JSON.stringify(p))
    );

    // Pad to minimum 2 elements for Poseidon
    while (elements.length < 2) {
        elements.push(BigInt(0));
    }

    const hash = poseidon(elements);
    return F.toString(hash);
}

/**
 * Main function: Converts FHIR Consent resource to Poseidon hash
 * 
 * @param {Object} consentResource - FHIR R4 Consent resource
 * @returns {Promise<string>} - Poseidon hash for circuit input
 * 
 * @example
 * const consent = await fetch('/fhir/Consent/123').then(r => r.json());
 * const hash = await hashFhirConsent(consent);
 */
async function hashFhirConsent(consentResource) {
    const { poseidon, F } = await initPoseidon();

    // Validate required fields
    if (!consentResource || !consentResource.id) {
        throw new Error("Invalid FHIR Consent: missing id");
    }

    // Extract consent-relevant fields per FHIR R4 spec
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

    // Convert to field elements
    const fieldElements = [
        stringToFieldElement(consentData.id),
        stringToFieldElement(consentData.status),
        stringToFieldElement(consentData.scope),
        stringToFieldElement(consentData.patientRef),
        BigInt(Math.floor(consentData.validFrom)),
        BigInt(Math.floor(consentData.validTo))
    ];

    // Hash provisions separately then include
    const provisionsHash = await hashProvisions(consentData.provisions);
    fieldElements.push(BigInt(provisionsHash));

    // Final Poseidon hash (7 inputs)
    const hash = poseidon(fieldElements.slice(0, 7));
    return F.toString(hash);
}

/**
 * Extracts allowed resource categories from consent provisions
 * Returns hashes padded to maxCategories length
 * 
 * @param {Object} provision - FHIR Consent.provision
 * @param {number} maxCategories - Target array length (default 8)
 * @returns {string[]} - Array of category hashes as strings
 */
function extractAllowedCategories(provision, maxCategories = 8) {
    const categories = [];

    const processProvision = (p) => {
        if (p?.class && Array.isArray(p.class)) {
            p.class.forEach(c => {
                if (categories.length < maxCategories) {
                    const categoryId = c.code || c.display || "";
                    categories.push(stringToFieldElement(categoryId).toString());
                }
            });
        }

        // Also check resource type restrictions
        if (p?.code && Array.isArray(p.code)) {
            p.code.forEach(code => {
                code.coding?.forEach(c => {
                    if (categories.length < maxCategories) {
                        categories.push(stringToFieldElement(c.code || "").toString());
                    }
                });
            });
        }

        // Recurse into nested provisions
        if (p?.provision && Array.isArray(p.provision)) {
            p.provision.forEach(processProvision);
        }
    };

    processProvision(provision);

    // Pad with zeros to reach maxCategories
    while (categories.length < maxCategories) {
        categories.push("0");
    }

    return categories;
}

/**
 * Prepares complete circuit inputs from FHIR data
 * This is the main entry point for proof generation
 * 
 * @param {Object} params
 * @param {Object} params.consent - FHIR Consent resource
 * @param {string} params.patientId - Patient identifier
 * @param {string} params.clinicianId - Clinician identifier  
 * @param {string} params.resourceId - Resource being accessed
 * @param {number} params.timestamp - Current Unix timestamp
 * @returns {Promise<Object>} - Complete circuit input object
 */
async function prepareCircuitInputs({
    consent,
    patientId,
    clinicianId,
    resourceId,
    timestamp
}) {
    const { poseidon, F } = await initPoseidon();

    // Hash the consent
    const consentHash = await hashFhirConsent(consent);

    // Split IDs into field elements
    const patientIdFields = splitIdToFields(patientId);
    const clinicianIdFields = splitIdToFields(clinicianId);
    const resourceIdFields = splitIdToFields(resourceId);

    // Extract categories
    const allowedCategories = extractAllowedCategories(consent.provision);

    // Extract validity period
    const validFrom = Math.floor(new Date(
        consent.provision?.period?.start ||
        consent.dateTime ||
        0
    ).getTime() / 1000);

    const validTo = Math.floor(new Date(
        consent.provision?.period?.end ||
        "2099-12-31T23:59:59Z"
    ).getTime() / 1000);

    // Compute public commitments
    const policyMatchHash = F.toString(poseidon([
        BigInt(consentHash),
        clinicianIdFields[0],
        clinicianIdFields[1],
        BigInt(validFrom),
        BigInt(validTo)
    ]));

    const accessEventHash = F.toString(poseidon([
        ...patientIdFields,
        ...resourceIdFields,
        BigInt(timestamp)
    ]));

    return {
        // Private inputs (never exposed)
        patientId: patientIdFields.map(String),
        clinicianId: clinicianIdFields.map(String),
        consentPolicyHash: consentHash,
        requestedResourceId: resourceIdFields.map(String),
        allowedResourceCategories: allowedCategories,
        validFromTimestamp: String(validFrom),
        validToTimestamp: String(validTo),

        // Public inputs (appear on-chain)
        proofOfPolicyMatch: policyMatchHash,
        currentTimestamp: String(timestamp),
        accessEventHash: accessEventHash
    };
}

module.exports = {
    initPoseidon,
    stringToFieldElement,
    splitIdToFields,
    hashFhirConsent,
    extractProvisions,
    extractAllowedCategories,
    prepareCircuitInputs
};
