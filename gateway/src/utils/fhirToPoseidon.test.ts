/**
 * Unit Tests for fhirToPoseidon utility
 * 
 * Tests FHIR Consent to Poseidon hash conversion per ZK Guardian spec.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    initPoseidon,
    stringToFieldElement,
    splitIdToFields,
    hashFhirConsent,
    extractAllowedCategories,
    prepareCircuitInputs,
    FhirConsent
} from '../utils/fhirToPoseidon.js';

describe('fhirToPoseidon', () => {
    beforeAll(async () => {
        // Initialize Poseidon for all tests
        await initPoseidon();
    });

    describe('stringToFieldElement', () => {
        it('should convert string to field element', () => {
            const result = stringToFieldElement('test-patient-123');
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            // Should be a valid BigInt string
            expect(() => BigInt(result)).not.toThrow();
        });

        it('should produce consistent hashes for same input', () => {
            const hash1 = stringToFieldElement('patient-123');
            const hash2 = stringToFieldElement('patient-123');
            expect(hash1).toBe(hash2);
        });

        it('should produce different hashes for different inputs', () => {
            const hash1 = stringToFieldElement('patient-123');
            const hash2 = stringToFieldElement('patient-456');
            expect(hash1).not.toBe(hash2);
        });

        it('should fit within BN254 field (< 2^254)', () => {
            const result = BigInt(stringToFieldElement('any-string'));
            const bn254Max = BigInt(2) ** BigInt(254);
            expect(result < bn254Max).toBe(true);
        });
    });

    describe('splitIdToFields', () => {
        it('should split ID into 4 field elements', () => {
            const fields = splitIdToFields('patient-123');
            expect(fields).toHaveLength(4);
            fields.forEach(field => {
                expect(typeof field).toBe('string');
                expect(() => BigInt(field)).not.toThrow();
            });
        });

        it('should produce consistent splits for same ID', () => {
            const fields1 = splitIdToFields('clinician-456');
            const fields2 = splitIdToFields('clinician-456');
            expect(fields1).toEqual(fields2);
        });

        it('should fit each element in uint64', () => {
            const fields = splitIdToFields('test-id');
            const uint64Max = BigInt(2) ** BigInt(64);
            fields.forEach(field => {
                expect(BigInt(field) < uint64Max).toBe(true);
            });
        });
    });

    describe('hashFhirConsent', () => {
        const validConsent: FhirConsent = {
            resourceType: 'Consent',
            id: 'consent-123',
            status: 'active',
            scope: {
                coding: [{
                    system: 'http://terminology.hl7.org/CodeSystem/consentscope',
                    code: 'patient-privacy'
                }]
            },
            patient: { reference: 'Patient/123' },
            dateTime: '2024-01-01T00:00:00Z',
            provision: {
                type: 'permit',
                period: {
                    start: '2024-01-01T00:00:00Z',
                    end: '2024-12-31T23:59:59Z'
                },
                class: [
                    { code: 'Observation' },
                    { code: 'DiagnosticReport' }
                ]
            }
        };

        it('should hash a valid FHIR Consent resource', async () => {
            const hash = await hashFhirConsent(validConsent);
            expect(hash).toBeDefined();
            expect(typeof hash).toBe('string');
            expect(() => BigInt(hash)).not.toThrow();
        });

        it('should throw for consent without ID', async () => {
            const invalidConsent = { ...validConsent, id: undefined } as any;
            await expect(hashFhirConsent(invalidConsent)).rejects.toThrow('missing id');
        });

        it('should produce consistent hashes for same consent', async () => {
            const hash1 = await hashFhirConsent(validConsent);
            const hash2 = await hashFhirConsent(validConsent);
            expect(hash1).toBe(hash2);
        });

        it('should produce different hashes for different consents', async () => {
            const consent2 = { ...validConsent, id: 'consent-456' };
            const hash1 = await hashFhirConsent(validConsent);
            const hash2 = await hashFhirConsent(consent2);
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('extractAllowedCategories', () => {
        it('should extract resource categories from provision', async () => {
            const provision = {
                type: 'permit' as const,
                class: [
                    { code: 'Observation' },
                    { code: 'DiagnosticReport' },
                    { code: 'MedicationRequest' }
                ]
            };

            const categories = await extractAllowedCategories(provision);
            expect(categories).toHaveLength(8); // Padded to maxCategories

            // First 3 should be non-zero
            expect(categories[0]).not.toBe('0');
            expect(categories[1]).not.toBe('0');
            expect(categories[2]).not.toBe('0');

            // Rest should be zero padding
            expect(categories[3]).toBe('0');
        });

        it('should return padded zeros for empty provision', async () => {
            const categories = await extractAllowedCategories(undefined);
            expect(categories).toHaveLength(8);
            categories.forEach(cat => expect(cat).toBe('0'));
        });

        it('should handle nested provisions', async () => {
            const provision = {
                type: 'permit' as const,
                class: [{ code: 'Observation' }],
                provision: [{
                    class: [{ code: 'MedicationRequest' }]
                }]
            };

            const categories = await extractAllowedCategories(provision);
            // Should include both Observation and MedicationRequest
            expect(categories[0]).not.toBe('0');
            expect(categories[1]).not.toBe('0');
        });
    });

    describe('prepareCircuitInputs', () => {
        const consent: FhirConsent = {
            resourceType: 'Consent',
            id: 'consent-test',
            status: 'active',
            patient: { reference: 'Patient/test-patient' },
            dateTime: '2024-01-01T00:00:00Z',
            provision: {
                type: 'permit',
                period: {
                    start: '2024-01-01T00:00:00Z',
                    end: '2024-12-31T23:59:59Z'
                },
                class: [{ code: 'Observation' }]
            }
        };

        it('should prepare all required circuit inputs', async () => {
            const inputs = await prepareCircuitInputs({
                consent,
                patientId: 'patient-123',
                clinicianId: 'clinician-456',
                resourceId: 'resource-789',
                resourceType: 'Observation',
                timestamp: Math.floor(Date.now() / 1000),
                patientNullifier: '12345678901234567890',
                sessionNonce: '98765432109876543210'
            });

            // Check all required fields exist
            expect(inputs.patientId).toHaveLength(4);
            expect(inputs.clinicianId).toHaveLength(4);
            expect(inputs.consentPolicyHash).toBeDefined();
            expect(inputs.requestedResourceId).toHaveLength(4);
            expect(inputs.allowedResourceCategories).toHaveLength(8);
            expect(inputs.validFromTimestamp).toBeDefined();
            expect(inputs.validToTimestamp).toBeDefined();
            expect(inputs.patientNullifier).toBe('12345678901234567890');
            expect(inputs.sessionNonce).toBe('98765432109876543210');
            expect(inputs.proofOfPolicyMatch).toBeDefined();
            expect(inputs.currentTimestamp).toBeDefined();
            expect(inputs.accessEventHash).toBeDefined();
        });

        it('should use resourceType for requestedResourceId (not resourceId)', async () => {
            // This is the critical fix for category matching
            const inputs1 = await prepareCircuitInputs({
                consent,
                patientId: 'p1',
                clinicianId: 'c1',
                resourceId: 'different-resource-id',
                resourceType: 'Observation',
                timestamp: 1000,
                patientNullifier: '123',
                sessionNonce: '456'
            });

            const inputs2 = await prepareCircuitInputs({
                consent,
                patientId: 'p1',
                clinicianId: 'c1',
                resourceId: 'another-resource-id',
                resourceType: 'Observation', // Same resource type
                timestamp: 1000,
                patientNullifier: '123',
                sessionNonce: '456'
            });

            // requestedResourceId should be the same because resourceType is the same
            expect(inputs1.requestedResourceId).toEqual(inputs2.requestedResourceId);
        });

        it('should compute valid timestamps from provision period', async () => {
            const inputs = await prepareCircuitInputs({
                consent,
                patientId: 'p1',
                clinicianId: 'c1',
                resourceId: 'r1',
                resourceType: 'Observation',
                timestamp: Math.floor(Date.now() / 1000),
                patientNullifier: '123',
                sessionNonce: '456'
            });

            const validFrom = parseInt(inputs.validFromTimestamp);
            const validTo = parseInt(inputs.validToTimestamp);

            expect(validFrom).toBeLessThan(validTo);
            // 2024-01-01 should be in the past
            expect(validFrom).toBeLessThan(Math.floor(Date.now() / 1000));
        });
    });
});
