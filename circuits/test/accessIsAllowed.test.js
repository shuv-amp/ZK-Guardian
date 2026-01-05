const chai = require("chai");
const { expect } = chai;
const path = require("path");
const { buildPoseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");

/**
 * ZK Guardian - Circuit Tests
 *
 * Verifies the `AccessIsAllowed` circuit against various consent scenarios:
 * - Valid access (correct time, category, policy)
 * - Invalid access (expired, wrong resource, policy mismatch)
 */

// Paths to compiled circuit artifacts
const WASM_PATH = path.join(__dirname, "../build/AccessIsAllowed_js/AccessIsAllowed.wasm");
const ZKEY_PATH = path.join(__dirname, "../build/AccessIsAllowed_final.zkey");
const VKEY_PATH = path.join(__dirname, "../build/verification_key.json");

// Import utilities
const {
    initPoseidon,
    splitIdToFields,
    stringToFieldElement
} = require("../utils/fhirToPoseidon");

describe("AccessIsAllowed Circuit", function () {
    // Increase timeout for proof generation (can take 2-5 seconds)
    this.timeout(120000);

    let poseidon;
    let F;

    before(async function () {
        // Initialize Poseidon hasher
        const result = await initPoseidon();
        poseidon = result.poseidon;
        F = result.F;
    });

    /**
     * Helper: Creates valid circuit inputs for testing
     */
    function createValidInputs(overrides = {}) {
        const patientId = splitIdToFields("patient-12345");
        const clinicianId = splitIdToFields("clinician-67890");
        const resourceId = splitIdToFields("observation-abc123");

        // Consent valid from 2024-01-01 to 2025-12-31
        const validFrom = Math.floor(new Date("2024-01-01").getTime() / 1000);
        const validTo = Math.floor(new Date("2025-12-31").getTime() / 1000);

        // Current time: 2024-06-15 (within validity window)
        const currentTimestamp = Math.floor(new Date("2024-06-15").getTime() / 1000);

        // Mock consent policy hash
        const consentPolicyHash = stringToFieldElement("consent-policy-xyz").toString();

        // Resource hash for category matching
        const resourceHash = F.toString(poseidon([
            ...resourceId
        ]));

        // Allowed categories (resource hash must match one of these)
        const allowedResourceCategories = [
            resourceHash,  // First category matches the resource
            "0", "0", "0", "0", "0", "0", "0"
        ];

        // Compute public commitments
        const proofOfPolicyMatch = F.toString(poseidon([
            BigInt(consentPolicyHash),
            clinicianId[0],
            clinicianId[1],
            BigInt(validFrom),
            BigInt(validTo)
        ]));

        const accessEventHash = F.toString(poseidon([
            ...patientId,
            ...resourceId,
            BigInt(currentTimestamp)
        ]));

        const inputs = {
            // Private inputs
            patientId: patientId.map(String),
            clinicianId: clinicianId.map(String),
            consentPolicyHash: consentPolicyHash,
            requestedResourceId: resourceId.map(String),
            allowedResourceCategories: allowedResourceCategories,
            validFromTimestamp: String(validFrom),
            validToTimestamp: String(validTo),

            // Public inputs
            proofOfPolicyMatch: proofOfPolicyMatch,
            currentTimestamp: String(currentTimestamp),
            accessEventHash: accessEventHash
        };

        // Apply any overrides
        return { ...inputs, ...overrides };
    }

    describe("Valid Consent Scenarios", function () {
        it("should generate valid proof for matching category and valid time", async function () {
            const inputs = createValidInputs();

            // Generate proof
            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                inputs,
                WASM_PATH,
                ZKEY_PATH
            );

            // Verify proof
            const vKey = require(VKEY_PATH);
            const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);

            expect(isValid).to.be.true;
            expect(publicSignals[0]).to.equal("1"); // isValid output
        });

        it("should work with consent valid for 1 year", async function () {
            const inputs = createValidInputs({
                validFromTimestamp: String(Math.floor(new Date("2024-01-01").getTime() / 1000)),
                validToTimestamp: String(Math.floor(new Date("2024-12-31").getTime() / 1000)),
                currentTimestamp: String(Math.floor(new Date("2024-07-15").getTime() / 1000))
            });

            // Recompute proofOfPolicyMatch with new timestamps
            const validFrom = Math.floor(new Date("2024-01-01").getTime() / 1000);
            const validTo = Math.floor(new Date("2024-12-31").getTime() / 1000);
            const clinicianId = inputs.clinicianId.map(BigInt);

            inputs.proofOfPolicyMatch = F.toString(poseidon([
                BigInt(inputs.consentPolicyHash),
                clinicianId[0],
                clinicianId[1],
                BigInt(validFrom),
                BigInt(validTo)
            ]));

            // Recompute accessEventHash with new timestamp
            const currentTimestamp = Math.floor(new Date("2024-07-15").getTime() / 1000);
            const patientId = inputs.patientId.map(BigInt);
            const resourceId = inputs.requestedResourceId.map(BigInt);

            inputs.accessEventHash = F.toString(poseidon([
                ...patientId,
                ...resourceId,
                BigInt(currentTimestamp)
            ]));

            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                inputs,
                WASM_PATH,
                ZKEY_PATH
            );

            const vKey = require(VKEY_PATH);
            const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);

            expect(isValid).to.be.true;
        });
    });

    describe("Invalid Consent Scenarios", function () {
        it("should fail for expired consent", async function () {
            // Set current time AFTER consent expiry
            const expiredInputs = createValidInputs();
            const expiredTimestamp = Math.floor(new Date("2026-01-01").getTime() / 1000);
            expiredInputs.currentTimestamp = String(expiredTimestamp);

            // Recompute accessEventHash
            const patientId = expiredInputs.patientId.map(BigInt);
            const resourceId = expiredInputs.requestedResourceId.map(BigInt);
            expiredInputs.accessEventHash = F.toString(poseidon([
                ...patientId,
                ...resourceId,
                BigInt(expiredTimestamp)
            ]));

            // This should throw because constraint `isValid === 1` fails
            try {
                await snarkjs.groth16.fullProve(
                    expiredInputs,
                    WASM_PATH,
                    ZKEY_PATH
                );
                expect.fail("Should have thrown for expired consent");
            } catch (error) {
                expect(error.message).to.match(/Assert/i);
            }
        });

        it("should fail for consent not yet active", async function () {
            // Set current time BEFORE consent starts
            const earlyInputs = createValidInputs();
            const earlyTimestamp = Math.floor(new Date("2023-01-01").getTime() / 1000);
            earlyInputs.currentTimestamp = String(earlyTimestamp);

            // Recompute accessEventHash
            const patientId = earlyInputs.patientId.map(BigInt);
            const resourceId = earlyInputs.requestedResourceId.map(BigInt);
            earlyInputs.accessEventHash = F.toString(poseidon([
                ...patientId,
                ...resourceId,
                BigInt(earlyTimestamp)
            ]));

            try {
                await snarkjs.groth16.fullProve(
                    earlyInputs,
                    WASM_PATH,
                    ZKEY_PATH
                );
                expect.fail("Should have thrown for consent not yet active");
            } catch (error) {
                expect(error.message).to.match(/Assert/i);
            }
        });

        it("should fail for resource not in allowed categories", async function () {
            const wrongCategoryInputs = createValidInputs();

            // Set all categories to non-matching values
            wrongCategoryInputs.allowedResourceCategories = [
                "123456", "234567", "345678", "456789",
                "567890", "678901", "789012", "890123"
            ];

            try {
                await snarkjs.groth16.fullProve(
                    wrongCategoryInputs,
                    WASM_PATH,
                    ZKEY_PATH
                );
                expect.fail("Should have thrown for wrong category");
            } catch (error) {
                expect(error.message).to.match(/Assert/i);
            }
        });

        it("should fail for wrong policy commitment", async function () {
            const wrongPolicyInputs = createValidInputs();
            wrongPolicyInputs.proofOfPolicyMatch = "99999999999999999";

            try {
                await snarkjs.groth16.fullProve(
                    wrongPolicyInputs,
                    WASM_PATH,
                    ZKEY_PATH
                );
                expect.fail("Should have thrown for wrong policy commitment");
            } catch (error) {
                expect(error.message).to.match(/Assert/i);
            }
        });

        it("should fail for wrong access event hash", async function () {
            const wrongAccessInputs = createValidInputs();
            wrongAccessInputs.accessEventHash = "88888888888888888";

            try {
                await snarkjs.groth16.fullProve(
                    wrongAccessInputs,
                    WASM_PATH,
                    ZKEY_PATH
                );
                expect.fail("Should have thrown for wrong access event hash");
            } catch (error) {
                expect(error.message).to.match(/Assert/i);
            }
        });
    });

    describe("Proof Verification", function () {
        it("should export Solidity calldata", async function () {
            const inputs = createValidInputs();

            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                inputs,
                WASM_PATH,
                ZKEY_PATH
            );

            const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);

            // Should be parseable JSON array
            const [a, b, c, input] = JSON.parse(`[${calldata}]`);

            expect(a).to.be.an("array").with.length(2);
            expect(b).to.be.an("array").with.length(2);
            expect(c).to.be.an("array").with.length(2);
            expect(input).to.be.an("array").with.length(4);
        });
    });
});
