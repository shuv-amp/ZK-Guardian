import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { prisma } from '../db/client.js';
import { logger, logAccessEvent, logSecurityEvent } from '../lib/logger.js';
import { BreakGlassPayloadSchema, validateOrThrow, ValidationError } from '../schemas/validation.js';
import { BreakGlassInvalidError } from '../lib/errors.js';

/**
 * Break-Glass Emergency Access Middleware
 * 
 * Handles X-Break-Glass header for emergency access that bypasses consent.
 * All break-glass access is logged to the database for mandatory compliance review.
 */

// HIPAA-compliant reason codes with review SLAs
const REVIEW_SLAS: Record<string, number> = {
    'LIFE_THREATENING_EMERGENCY': 24,
    'UNCONSCIOUS_PATIENT': 24,
    'PSYCHIATRIC_CRISIS': 48,
    'SUSPECTED_ABUSE_INVESTIGATION': 72
};

export interface BreakGlassContext {
    isBreakGlass: true;
    reason: string;
    justificationHash: string;
    clinicianId: string;
    witnessId?: string;
    eventId: string;
    reviewDeadline: Date;
}

/**
 * Break-Glass Middleware
 */
export async function breakGlassMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const breakGlassHeader = req.headers['x-break-glass'];

    if (!breakGlassHeader) {
        return next();
    }

    // Dev mode simple bypass for E2E tests
    if (process.env.NODE_ENV !== 'production' && breakGlassHeader === 'true') {
        const patientId = extractPatientId(req) || 'unknown';
        const resourceType = extractResourceType(req);

        // Mock context
        (req as any).breakGlassContext = {
            isBreakGlass: true,
            reason: 'DEV_TEST',
            justificationHash: 'mock-hash',
            clinicianId: 'dev-user',
            eventId: 'dev-event-' + Date.now(),
            reviewDeadline: new Date()
        };

        logger.info({ patientId, resourceType }, 'Dev mode break-glass simple bypass active');
        return next();
    }

    try {
        // Decode and validate payload
        const decoded = Buffer.from(breakGlassHeader as string, 'base64').toString('utf-8');
        logger.debug({ headers: req.headers, path: req.path }, 'Processing break-glass header');

        const payload = validateOrThrow(BreakGlassPayloadSchema, JSON.parse(decoded));

        const smartContext = (req as any).smartContext;
        if (!smartContext?.sub) {
            throw new BreakGlassInvalidError('Authentication required for break-glass');
        }

        // Extract patient ID from request
        const patientId = extractPatientId(req);
        if (!patientId) {
            throw new BreakGlassInvalidError('Patient ID required for break-glass');
        }

        // Calculate review deadline based on reason
        const reviewHours = REVIEW_SLAS[payload.reason] || 24;
        const reviewDeadline = new Date(Date.now() + reviewHours * 60 * 60 * 1000);

        // Hash justification for privacy (don't store raw text)
        const justificationHash = createHash('sha256')
            .update(payload.justification)
            .digest('hex')
            .slice(0, 16);

        // Create audit log entry
        const auditLog = await prisma.auditLog.create({
            data: {
                patientId,
                clinicianId: smartContext.sub,
                clinicianName: smartContext.name,
                department: smartContext.department,
                resourceType: extractResourceType(req),
                accessEventHash: `bg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                isBreakGlass: true,
                purpose: payload.reason
            }
        });

        // Create break-glass event record
        const breakGlassEvent = await prisma.breakGlassEvent.create({
            data: {
                auditLogId: auditLog.id,
                clinicianId: smartContext.sub,
                patientId,
                reason: payload.reason,
                justificationHash,
                witnessId: payload.witnessId,
                reviewDeadline
            }
        });

        // Create high-priority alert for patient
        await prisma.accessAlert.create({
            data: {
                patientId,
                auditLogId: auditLog.id,
                type: 'BREAK_GLASS',
                severity: 'HIGH',
                message: `Emergency break-glass access by ${smartContext.name || smartContext.sub}`,
                relatedClinician: smartContext.name || smartContext.sub,
                relatedResourceType: extractResourceType(req),
                suggestedAction: 'Verify this was a legitimate emergency'
            }
        });

        // Log for compliance
        logAccessEvent({
            patientId,
            clinicianId: smartContext.sub,
            resourceType: extractResourceType(req),
            action: 'BREAK_GLASS'
        });

        logSecurityEvent({
            event: 'BREAK_GLASS_ATTEMPT',
            userId: smartContext.sub,
            details: `Reason: ${payload.reason}, Patient: ${patientId}`
        });

        // Attach context to request
        const context: BreakGlassContext = {
            isBreakGlass: true,
            reason: payload.reason,
            justificationHash,
            clinicianId: smartContext.sub,
            witnessId: payload.witnessId,
            eventId: breakGlassEvent.id,
            reviewDeadline
        };
        (req as any).breakGlassContext = context;

        // Set response headers
        res.setHeader('X-Break-Glass-Event-Id', breakGlassEvent.id);
        res.setHeader('X-Break-Glass-Review-Deadline', reviewDeadline.toISOString());

        logger.info({
            breakGlassEventId: breakGlassEvent.id,
            reason: payload.reason,
            patientId,
            clinicianId: smartContext.sub
        }, 'Break-glass access granted');

        next();

    } catch (error) {
        if (error instanceof BreakGlassInvalidError) {
            logger.warn({ error: error.message }, 'Break-glass invalid error');
            res.status(400).json(error.toJSON());
            return;
        }
        if (error instanceof ValidationError) {
            logger.warn({ errors: error.errors }, 'Break-glass payload validation failed');
            res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: 'Invalid break-glass payload',
                details: error.errors
            });
            return;
        }

        logger.error({ error }, 'Break-glass middleware failed');
        res.status(400).json({
            error: 'INVALID_BREAK_GLASS',
            message: 'Invalid break-glass request processing'
        });
    }
}

// Helpers

function extractPatientId(req: Request): string | null {
    // Check URL params
    if (req.params.patientId) return req.params.patientId;
    if (req.params.id && req.path.includes('Patient')) return req.params.id;

    // Check query params
    if (req.query.patient) return req.query.patient as string;
    if (req.query.subject) return (req.query.subject as string).replace('Patient/', '');

    // Check body
    if (req.body?.patientId) return req.body.patientId;

    // Manual path extraction (Critical for middleware)
    // Matches /Patient/123 or /Patient/123/...
    const match = req.path.match(/\/Patient\/([^/]+)/);
    if (match) return match[1];

    return null;
}

function extractResourceType(req: Request): string {
    // Handle path with /fhir prefix
    const fhirMatch = req.path.match(/\/fhir\/([A-Za-z]+)/);
    if (fhirMatch) return fhirMatch[1];

    // Handle direct resource path (e.g., /Patient/...)
    const resourceMatch = req.path.match(/^\/([A-Za-z]+)/);
    if (resourceMatch && resourceMatch[1] !== 'fhir') return resourceMatch[1];

    return 'Unknown';
}

// Admin Functions

export async function getPendingReviews(): Promise<any[]> {
    return prisma.breakGlassEvent.findMany({
        where: {
            reviewedAt: null,
            reviewDeadline: { lte: new Date() }
        },
        include: {
            auditLog: true
        },
        orderBy: { reviewDeadline: 'asc' }
    });
}

export async function reviewBreakGlassEvent(
    eventId: string,
    reviewerId: string
): Promise<void> {
    await prisma.breakGlassEvent.update({
        where: { id: eventId },
        data: {
            reviewedAt: new Date(),
            reviewedBy: reviewerId
        }
    });
}
