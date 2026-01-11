
import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { PatientIdentityService } from '../modules/identity/identityService.js';
import { AuthorizationError, ValidationError } from '../lib/errors.js';

export const identityRouter: Router = Router();

// Schema for Identity Reset
const ResetIdentitySchema = z.object({
    newNullifier: z.string().min(10, "Nullifier must be a large integer string")
});

/**
 * POST /api/auth/reset-identity
 * 
 * Allows a rigorously authenticated user (via OIDC/Smart) to rotate their ZK Nullifier.
 * This is the "Life Raft" for users who lose their device.
 * 
 * SECURITY: This endpoint must require HIGH assurance authentication.
 * For MVP, we use the standard Bearer token from OIDC.
 */
identityRouter.post('/reset-identity', async (req: Request, res: Response, next: express.NextFunction) => {
    try {
        const smartContext = (req as any).smartContext;
        if (!smartContext?.patient) {
            throw new AuthorizationError('Authentication required to reset identity');
        }

        const body = ResetIdentitySchema.parse(req.body);

        // Parse nullifier as BigInt safe
        let nullifierBigInt: bigint;
        try {
            nullifierBigInt = BigInt(body.newNullifier);
        } catch (e) {
            throw new ValidationError('Invalid nullifier format', [{ path: 'newNullifier', message: 'Must be a valid integer string' }]);
        }

        logger.warn({ patientId: smartContext.patient }, 'SECURITY: Initiating Identity Reset / Nullifier Rotation');

        await PatientIdentityService.resetIdentity(smartContext.patient, nullifierBigInt);

        res.json({
            success: true,
            message: 'Identity rotated successfully. Please re-sync your device.',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        next(error);
    }
});
