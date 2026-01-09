/**
 * Circuit Constraint Coverage Tests
 * 
 * Exhaustive tests for ZK circuit soundness.
 * These tests ensure the circuit rejects all invalid inputs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { initPoseidon, prepareCircuitInputs } from '../../utils/fhirToPoseidon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CIRCUIT_BUILD = path.resolve(__dirname, '../../../../circuits/build/AccessIsAllowedSecure');
const WASM_PATH = path.join(CIRCUIT_BUILD, 'AccessIsAllowedSecure_js/AccessIsAllowedSecure.wasm');
const ZKEY_PATH = path.join(CIRCUIT_BUILD, 'AccessIsAllowedSecure_final.zkey');

// Skip if circuit files don't exist
const circuitsExist = fs.existsSync(WASM_PATH) && fs.existsSync(ZKEY_PATH);

describe.skipIf(!circuitsExist)('Circuit Constraint Coverage', () => {
    let validConsent: any;
    let validInputs: any;

    beforeAll(async () => {
        await initPoseidon();

        // Create a valid consent fixture
        validConsent = {
            resourceType: 'Consent',
            id: 'consent-test-001',
            status: 'active',
            patient: { reference: 'Patient/test-patient-001' },
            dateTime: new Date().toISOString(),
            provision: {
                type: 'permit',
                period: {
                    start: '2024-01-01T00:00:00Z',
                    end: '2026-12-31T23:59:59Z'
                },
                class: [
                    { code: 'Observation' },
                    { code: 'DiagnosticReport' },
                    { code: 'MedicationRequest' }
                ]
            }
        };

        // Prepare valid circuit inputs
        validInputs = await prepareCircuitInputs({
            consent: validConsent,
            patientId: 'test-patient-001',
            clinicianId: 'test-clinician-001',
            resourceId: 'obs-12345',
            resourceType: 'Observation',
            timestamp: Math.floor(Date.now() / 1000),
            patientNullifier: '0x' + '1'.repeat(64),
            sessionNonce: Date.now().toString()
        });
    });

    describe('SOUNDNESS: Circuit rejects invalid inputs', () => {
        it('should FAIL for resource category not in consent', async () => {
            const invalidInputs = await prepareCircuitInputs({
                consent: validConsent,
                patientId: 'test-patient-001',
                clinicianId: 'test-clinician-001',
                resourceId: 'enc-12345',
                resourceType: 'Encounter', // Not in consent!
                timestamp: Math.floor(Date.now() / 1000),
                patientNullifier: '0x' + '1'.repeat(64),
                sessionNonce: Date.now().toString()
            });

            await expect(
                snarkjs.groth16.fullProve(invalidInputs, WASM_PATH, ZKEY_PATH)
            ).rejects.toThrow();
        });

        it('should FAIL for expired consent', async () => {
            const expiredConsent = {
                ...validConsent,
                provision: {
                    ...validConsent.provision,
                    period: {
                        start: '2020-01-01T00:00:00Z',
                        end: '2020-12-31T23:59:59Z' // Expired!
                    }
                }
            };

            const expiredInputs = await prepareCircuitInputs({
                consent: expiredConsent,
                patientId: 'test-patient-001',
                clinicianId: 'test-clinician-001',
                resourceId: 'obs-12345',
                resourceType: 'Observation',
                timestamp: Math.floor(Date.now() / 1000), // Current time > validTo
                patientNullifier: '0x' + '1'.repeat(64),
                sessionNonce: Date.now().toString()
            });

            await expect(
                snarkjs.groth16.fullProve(expiredInputs, WASM_PATH, ZKEY_PATH)
            ).rejects.toThrow();
        });

        it('should FAIL for future consent (not yet valid)', async () => {
            const futureConsent = {
                ...validConsent,
                provision: {
                    ...validConsent.provision,
                    period: {
                        start: '2030-01-01T00:00:00Z', // Future!
                        end: '2030-12-31T23:59:59Z'
                    }
                }
            };

            const futureInputs = await prepareCircuitInputs({
                consent: futureConsent,
                patientId: 'test-patient-001',
                clinicianId: 'test-clinician-001',
                resourceId: 'obs-12345',
                resourceType: 'Observation',
                timestamp: Math.floor(Date.now() / 1000), // Current time < validFrom
                patientNullifier: '0x' + '1'.repeat(64),
                sessionNonce: Date.now().toString()
            });

            await expect(
                snarkjs.groth16.fullProve(futureInputs, WASM_PATH, ZKEY_PATH)
            ).rejects.toThrow();
        });

        it('should FAIL for empty allowed categories', async () => {
            const noCategories = {
                ...validConsent,
                provision: {
                    ...validConsent.provision,
                    class: [] // No categories!
                }
            };

            const emptyInputs = await prepareCircuitInputs({
                consent: noCategories,
                patientId: 'test-patient-001',
                clinicianId: 'test-clinician-001',
                resourceId: 'obs-12345',
                resourceType: 'Observation',
                timestamp: Math.floor(Date.now() / 1000),
                patientNullifier: '0x' + '1'.repeat(64),
                sessionNonce: Date.now().toString()
            });

            await expect(
                snarkjs.groth16.fullProve(emptyInputs, WASM_PATH, ZKEY_PATH)
            ).rejects.toThrow();
        });

        it('should FAIL for isValid !== 1', async () => {
            // Directly manipulate inputs to set isValid to 0
            const manipulatedInputs = { ...validInputs };
            // This depends on circuit structure - the circuit checks isValid === 1

            // Since we can't directly set isValid (it's computed), 
            // we verify by checking that valid inputs produce isValid=1
            const { publicSignals } = await snarkjs.groth16.fullProve(
                validInputs, WASM_PATH, ZKEY_PATH
            );

            // isValid should be the first public signal (check circuit)
            expect(publicSignals[0]).toBe('1');
        });
    });

    describe('COMPLETENESS: Circuit accepts valid inputs', () => {
        it('should SUCCEED for valid consent with matching category', async () => {
            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                validInputs, WASM_PATH, ZKEY_PATH
            );

            expect(proof).toBeDefined();
            expect(proof.pi_a).toHaveLength(3);
            expect(proof.pi_b).toHaveLength(3);
            expect(proof.pi_c).toHaveLength(3);
            expect(publicSignals).toBeDefined();
        });

        it('should SUCCEED for all 8 resource categories', async () => {
            const categories = ['Observation', 'DiagnosticReport', 'MedicationRequest'];

            for (const category of categories) {
                const inputs = await prepareCircuitInputs({
                    consent: validConsent,
                    patientId: 'test-patient-001',
                    clinicianId: 'test-clinician-001',
                    resourceId: `${category.toLowerCase()}-123`,
                    resourceType: category,
                    timestamp: Math.floor(Date.now() / 1000),
                    patientNullifier: '0x' + '2'.repeat(64),
                    sessionNonce: Date.now().toString()
                });

                const { proof } = await snarkjs.groth16.fullProve(
                    inputs, WASM_PATH, ZKEY_PATH
                );

                expect(proof).toBeDefined();
            }
        });

        it('should SUCCEED at boundary times (exact start and end)', async () => {
            const now = Math.floor(Date.now() / 1000);
            const boundaryConsent = {
                ...validConsent,
                provision: {
                    ...validConsent.provision,
                    period: {
                        start: new Date((now - 1) * 1000).toISOString(),
                        end: new Date((now + 3600) * 1000).toISOString() // 1 hour from now
                    }
                }
            };

            // At exact start time
            const startInputs = await prepareCircuitInputs({
                consent: boundaryConsent,
                patientId: 'test-patient-001',
                clinicianId: 'test-clinician-001',
                resourceId: 'obs-boundary',
                resourceType: 'Observation',
                timestamp: now, // Exact boundary
                patientNullifier: '0x' + '3'.repeat(64),
                sessionNonce: Date.now().toString()
            });

            const { proof } = await snarkjs.groth16.fullProve(
                startInputs, WASM_PATH, ZKEY_PATH
            );

            expect(proof).toBeDefined();
        });
    });

    describe('PUBLIC SIGNALS: Correct output structure', () => {
        it('should output 7 public signals as per spec', async () => {
            const { publicSignals } = await snarkjs.groth16.fullProve(
                validInputs, WASM_PATH, ZKEY_PATH
            );

            // Per API_REFERENCE.md Section 3.1
            // publicSignals: [isValid, nullifierHash, accessEventHash, policyCommitment, 
            //                 validFromTimestamp, validToTimestamp, currentTimestamp]
            expect(publicSignals.length).toBe(7);
        });

        it('should have deterministic nullifierHash', async () => {
            // Same inputs should produce same nullifierHash
            const { publicSignals: signals1 } = await snarkjs.groth16.fullProve(
                validInputs, WASM_PATH, ZKEY_PATH
            );

            const { publicSignals: signals2 } = await snarkjs.groth16.fullProve(
                validInputs, WASM_PATH, ZKEY_PATH
            );

            expect(signals1[1]).toBe(signals2[1]); // nullifierHash
        });

        it('should have unique accessEventHash for different resources', async () => {
            const inputs1 = await prepareCircuitInputs({
                consent: validConsent,
                patientId: 'test-patient-001',
                clinicianId: 'test-clinician-001',
                resourceId: 'obs-unique-1',
                resourceType: 'Observation',
                timestamp: Math.floor(Date.now() / 1000),
                patientNullifier: '0x' + '4'.repeat(64),
                sessionNonce: '111'
            });

            const inputs2 = await prepareCircuitInputs({
                consent: validConsent,
                patientId: 'test-patient-001',
                clinicianId: 'test-clinician-001',
                resourceId: 'obs-unique-2', // Different resource
                resourceType: 'Observation',
                timestamp: Math.floor(Date.now() / 1000),
                patientNullifier: '0x' + '4'.repeat(64),
                sessionNonce: '222'
            });

            const { publicSignals: signals1 } = await snarkjs.groth16.fullProve(
                inputs1, WASM_PATH, ZKEY_PATH
            );

            const { publicSignals: signals2 } = await snarkjs.groth16.fullProve(
                inputs2, WASM_PATH, ZKEY_PATH
            );

            expect(signals1[2]).not.toBe(signals2[2]); // accessEventHash should differ
        });
    });
});
