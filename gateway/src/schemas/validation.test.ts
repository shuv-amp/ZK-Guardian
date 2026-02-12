/**
 * Unit Tests for Validation Schemas
 * 
 * Tests all Zod validation schemas for proper input validation.
 */

import { describe, it, expect } from 'vitest';
import {
    PatientIdSchema,
    PractitionerIdSchema,
    ResourceTypeSchema,
    AccessHistoryQuerySchema,
    BreakGlassPayloadSchema,
    ConsentResponseSchema,
    FHIRSearchParamsSchema,
    validateOrThrow,
    ValidationError
} from './validation.js';

describe('Validation Schemas', () => {
    describe('PatientIdSchema', () => {
        it('should accept valid patient IDs', () => {
            expect(() => PatientIdSchema.parse('patient-123')).not.toThrow();
            expect(() => PatientIdSchema.parse('patient_123')).not.toThrow();
            expect(() => PatientIdSchema.parse('patient.123')).not.toThrow();
            expect(() => PatientIdSchema.parse('ABC-def-123')).not.toThrow();
        });

        it('should reject empty patient IDs', () => {
            expect(() => PatientIdSchema.parse('')).toThrow();
        });

        it('should reject IDs with invalid characters', () => {
            expect(() => PatientIdSchema.parse('patient@123')).toThrow();
            expect(() => PatientIdSchema.parse('patient#123')).toThrow();
            expect(() => PatientIdSchema.parse('patient/123')).toThrow();
            expect(() => PatientIdSchema.parse('patient 123')).toThrow();
        });

        it('should reject IDs exceeding max length', () => {
            const longId = 'a'.repeat(129);
            expect(() => PatientIdSchema.parse(longId)).toThrow();
        });

        it('should reject path traversal attempts', () => {
            expect(() => PatientIdSchema.parse('../etc/passwd')).toThrow();
            expect(() => PatientIdSchema.parse('..\\windows')).toThrow();
        });
    });

    describe('ResourceTypeSchema', () => {
        it('should accept valid FHIR resource types', () => {
            const validTypes = [
                'Patient', 'Observation', 'MedicationRequest', 'Condition',
                'DiagnosticReport', 'Encounter', 'AllergyIntolerance', 'Procedure',
                'Immunization', 'CarePlan', 'Goal', 'Consent'
            ];
            validTypes.forEach(type => {
                expect(() => ResourceTypeSchema.parse(type)).not.toThrow();
            });
        });

        it('should reject invalid resource types', () => {
            expect(() => ResourceTypeSchema.parse('InvalidType')).toThrow();
            expect(() => ResourceTypeSchema.parse('patient')).toThrow(); // Case-sensitive
            expect(() => ResourceTypeSchema.parse('')).toThrow();
        });
    });

    describe('BreakGlassPayloadSchema', () => {
        const validPayload = {
            reason: 'LIFE_THREATENING_EMERGENCY',
            justification: 'Patient presenting with acute myocardial infarction, immediate access required.',
            clinicianSignature: 'Dr. John Smith'
        };

        it('should accept valid break-glass payload', () => {
            expect(() => BreakGlassPayloadSchema.parse(validPayload)).not.toThrow();
        });

        it('should accept payload with optional fields', () => {
            const withOptional = {
                ...validPayload,
                witnessId: 'nurse-123',
                estimatedDuration: 120
            };
            expect(() => BreakGlassPayloadSchema.parse(withOptional)).not.toThrow();
        });

        it('should reject invalid reason codes', () => {
            const invalid = { ...validPayload, reason: 'INVALID_REASON' };
            expect(() => BreakGlassPayloadSchema.parse(invalid)).toThrow();
        });

        it('should require minimum justification length', () => {
            const shortJustification = { ...validPayload, justification: 'Too short' };
            expect(() => BreakGlassPayloadSchema.parse(shortJustification)).toThrow();
        });

        it('should reject overly long justification', () => {
            const longJustification = { ...validPayload, justification: 'a'.repeat(1001) };
            expect(() => BreakGlassPayloadSchema.parse(longJustification)).toThrow();
        });

        it('should require clinician signature', () => {
            const noSig = { ...validPayload, clinicianSignature: '' };
            expect(() => BreakGlassPayloadSchema.parse(noSig)).toThrow();
        });
    });

    describe('ConsentResponseSchema', () => {
        it('should accept valid consent approval', () => {
            const approval = {
                type: 'CONSENT_RESPONSE',
                requestId: '550e8400-e29b-41d4-a716-446655440000',
                approved: true,
                nullifier: '0x123abc',
                sessionNonce: '987654321'
            };
            expect(() => ConsentResponseSchema.parse(approval)).not.toThrow();
        });

        it('should accept valid consent denial', () => {
            const denial = {
                type: 'CONSENT_RESPONSE',
                requestId: '550e8400-e29b-41d4-a716-446655440000',
                approved: false
            };
            expect(() => ConsentResponseSchema.parse(denial)).not.toThrow();
        });

        it('should reject invalid nullifier format', () => {
            const invalid = {
                type: 'CONSENT_RESPONSE',
                requestId: '550e8400-e29b-41d4-a716-446655440000',
                approved: true,
                nullifier: 'invalid-not-hex'
            };
            expect(() => ConsentResponseSchema.parse(invalid)).toThrow();
        });

        it('should require valid UUID for requestId', () => {
            const invalid = {
                type: 'CONSENT_RESPONSE',
                requestId: 'not-a-uuid',
                approved: true
            };
            expect(() => ConsentResponseSchema.parse(invalid)).toThrow();
        });
    });

    describe('AccessHistoryQuerySchema', () => {
        it('should accept empty query (uses defaults)', () => {
            const result = AccessHistoryQuerySchema.parse({});
            expect(result.limit).toBe(50);
            expect(result.offset).toBe(0);
            expect(result.includeBreakGlass).toBe(true);
        });

        it('should coerce string numbers', () => {
            const result = AccessHistoryQuerySchema.parse({
                limit: '25',
                offset: '10'
            });
            expect(result.limit).toBe(25);
            expect(result.offset).toBe(10);
        });

        it('should enforce max limit', () => {
            expect(() => AccessHistoryQuerySchema.parse({ limit: 250 })).toThrow();
        });

        it('should accept valid date range', () => {
            const result = AccessHistoryQuerySchema.parse({
                from: '2024-01-01T00:00:00Z',
                to: '2024-12-31T23:59:59Z'
            });
            expect(result.from).toBe('2024-01-01T00:00:00Z');
            expect(result.to).toBe('2024-12-31T23:59:59Z');
        });
    });

    describe('FHIRSearchParamsSchema', () => {
        it('should pass through unknown FHIR params', () => {
            const result = FHIRSearchParamsSchema.parse({
                patient: 'patient-123',
                code: 'http://loinc.org|8480-6',
                _include: 'Observation:patient'
            });
            expect(result.patient).toBe('patient-123');
            expect(result.code).toBe('http://loinc.org|8480-6');
            expect((result as any)._include).toBe('Observation:patient');
        });

        it('should apply defaults', () => {
            const result = FHIRSearchParamsSchema.parse({});
            expect(result._count).toBe(10);
            expect(result._offset).toBe(0);
        });

        it('should enforce count limits', () => {
            expect(() => FHIRSearchParamsSchema.parse({ _count: 101 })).toThrow();
            expect(() => FHIRSearchParamsSchema.parse({ _count: 0 })).toThrow();
        });
    });

    describe('validateOrThrow', () => {
        it('should return validated data on success', () => {
            const result = validateOrThrow(PatientIdSchema, 'patient-123');
            expect(result).toBe('patient-123');
        });

        it('should throw ValidationError on failure', () => {
            expect(() => validateOrThrow(PatientIdSchema, '')).toThrow(ValidationError);
        });

        it('should include error details', () => {
            try {
                validateOrThrow(PatientIdSchema, '');
            } catch (error) {
                expect(error).toBeInstanceOf(ValidationError);
                expect((error as ValidationError).errors.length).toBeGreaterThan(0);
            }
        });
    });
});
