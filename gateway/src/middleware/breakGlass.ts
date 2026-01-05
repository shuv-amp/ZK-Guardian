import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { prisma } from '../db/client.js';
import { logger, logAccessEvent, logSecurityEvent } from '../lib/logger.js';
import { BreakGlassPayloadSchema, validateOrThrow } from '../schemas/validation.js';
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

    try {
        // Decode and validate payload
        const decoded = Buffer.from(breakGlassHeader as string, 'base64').toString('utf-8');
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
            res.status(400).json(error.toJSON());
            return;
        }

        logger.error({ error }, 'Break-glass validation failed');
        res.status(400).json({
            error: 'INVALID_BREAK_GLASS',
            message: 'Invalid break-glass request'
        });
    }
}

// ============================================
// Helpers
// ============================================

function extractPatientId(req: Request): string | null {
    // Check URL params
    if (req.params.patientId) return req.params.patientId;
    if (req.params.id && req.path.includes('Patient')) return req.params.id;

    // Check query params
    if (req.query.patient) return req.query.patient as string;
    if (req.query.subject) return (req.query.subject as string).replace('Patient/', '');

    // Check body
    if (req.body?.patientId) return req.body.patientId;

    return null;
}

function extractResourceType(req: Request): string {
    const match = req.path.match(/\/fhir\/([A-Za-z]+)/);
    return match?.[1] || 'Unknown';
}

// ============================================
// Admin Functions
// ============================================

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
