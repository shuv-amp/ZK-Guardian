import { z } from 'zod';
import { formatFieldElementHex, isFieldElementInput } from '../lib/fieldEncoding.js';

/**
 * Zod Validation Schemas for ZK Guardian API
 * 
 * All input validation in one place for security and maintainability.
 */

// Common Validators

export const PatientIdSchema = z.string()
    .min(1, 'Patient ID is required')
    .max(128)
    .regex(/^[a-zA-Z0-9\-_.]+$/, 'Invalid patient ID format');

export const PractitionerIdSchema = z.string()
    .min(1, 'Practitioner ID is required')
    .max(128)
    .regex(/^[a-zA-Z0-9\-_.]+$/, 'Invalid practitioner ID format');

export const ResourceTypeSchema = z.enum([
    'Patient', 'Observation', 'MedicationRequest', 'Condition',
    'DiagnosticReport', 'Encounter', 'AllergyIntolerance', 'Procedure',
    'Immunization', 'CarePlan', 'Goal', 'Consent'
]);

// Audit API Schemas

export const AccessHistoryQuerySchema = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    resourceType: z.string().optional(),
    department: z.string().max(64).optional(),
    includeBreakGlass: z.coerce.boolean().default(true)
});

export const AccessAlertsQuerySchema = z.object({
    acknowledged: z.coerce.boolean().default(false),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional()
});

export const AcknowledgeAlertSchema = z.object({
    acknowledged: z.boolean(),
    notes: z.string().max(500).optional()
});

export const AlertSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const AlertTypeSchema = z.enum([
    'AFTER_HOURS', 'UNUSUAL_VOLUME', 'NEW_PROVIDER',
    'SENSITIVE_RESOURCE', 'BREAK_GLASS'
]);

// Break-Glass Schemas

export const BreakGlassReasonSchema = z.enum([
    'LIFE_THREATENING_EMERGENCY',
    'UNCONSCIOUS_PATIENT',
    'PSYCHIATRIC_CRISIS',
    'SUSPECTED_ABUSE_INVESTIGATION'
]);

export const BreakGlassPayloadSchema = z.object({
    reason: BreakGlassReasonSchema,
    justification: z.string()
        .min(20, 'Justification must be at least 20 characters')
        .max(1000),
    clinicianSignature: z.string().min(1),
    witnessId: z.string().max(128).optional(),
    estimatedDuration: z.number().int().positive().optional(),
    // V2: ZK Proof fields
    emergencyCode: z.number().int().min(1).max(4).optional(), // 1=Low, 2=Medium, 3=High, 4=Critical
    emergencyThreshold: z.number().int().min(1).max(4).optional() // Minimum required level
});

// WebSocket Message Schemas

export const ConsentRequestSchema = z.object({
    type: z.literal('CONSENT_REQUEST'),
    requestId: z.string().uuid(),
    clinicianName: z.string().max(128),
    resourceType: z.string(),
    purpose: z.string().max(256),
    expiresAt: z.number().int().positive()
});

export const ConsentResponseSchema = z.object({
    type: z.literal('CONSENT_RESPONSE'),
    requestId: z.string().uuid(),
    approved: z.boolean(),
    nullifier: z.string()
        .trim()
        .refine(isFieldElementInput, 'Nullifier must be a valid hex or decimal integer string')
        .transform(formatFieldElementHex)
        .optional(),
    sessionNonce: z.string()
        .trim()
        .refine(isFieldElementInput, 'Session nonce must be a valid hex or decimal integer string')
        .transform(formatFieldElementHex)
        .optional(),
    signature: z.string().optional()
});

// FHIR Query Schemas

export const FHIRSearchParamsSchema = z.object({
    patient: PatientIdSchema.optional(),
    subject: PatientIdSchema.optional(),
    _count: z.coerce.number().int().min(1).max(100).default(10),
    _offset: z.coerce.number().int().min(0).default(0),
    _sort: z.string().optional(),
    category: z.string().optional(),
    code: z.string().optional(),
    date: z.string().optional()
}).passthrough(); // Allow other FHIR params

// Validation Helper

export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        const errors = result.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
        }));
        throw new ValidationError('Validation failed', errors);
    }
    return result.data;
}

export class ValidationError extends Error {
    constructor(
        message: string,
        public readonly errors: Array<{ path: string; message: string }>
    ) {
        super(message);
        this.name = 'ValidationError';
    }
}

// Export all schemas
export type AccessHistoryQuery = z.infer<typeof AccessHistoryQuerySchema>;
export type AccessAlertsQuery = z.infer<typeof AccessAlertsQuerySchema>;
export type AcknowledgeAlertRequest = z.infer<typeof AcknowledgeAlertSchema>;
export type BreakGlassPayload = z.infer<typeof BreakGlassPayloadSchema>;
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;
export type ConsentResponse = z.infer<typeof ConsentResponseSchema>;
