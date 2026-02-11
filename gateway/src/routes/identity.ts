
import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { PatientIdentityService, ClinicianIdentityService } from '../modules/identity/identityService.js';
import { AuthorizationError, ValidationError } from '../lib/errors.js';
import { smartAuthMiddleware } from '../middleware/smartAuth.js';

export const identityRouter: Router = Router();

identityRouter.use(smartAuthMiddleware);

const RegisterPatientSchema = z.object({
    nullifier: z.string().min(10, 'Nullifier must be a large integer string')
});

const BlindedIdentitySchema = z.object({
    nullifier: z.string().min(10, 'Nullifier must be a large integer string')
});

const ClinicianRegisterSchema = z.object({
    licenseNumber: z.string().min(3, 'License number is required'),
    facilityId: z.string().min(2, 'Facility ID is required'),
    fhirPractitionerId: z.string().optional()
});

const PatientResetSchema = z.object({
    newNullifier: z.string().min(10, 'Nullifier must be a large integer string')
});

// Schema for Identity Reset
const ResetIdentitySchema = z.object({
    newNullifier: z.string().min(10, "Nullifier must be a large integer string")
});

const parseNullifier = (value: string, fieldName: string): bigint => {
    try {
        return BigInt(value);
    } catch (error) {
        throw new ValidationError('Invalid nullifier format', [{ path: fieldName, message: 'Must be a valid integer string' }]);
    }
};

/**
 * POST /identity/patient/register
 * Registers a patient nullifier and returns blinded ID preview.
 */
identityRouter.post('/patient/register', async (req: Request, res: Response, next: express.NextFunction) => {
    try {
        const smartContext = (req as any).smartContext;
        if (!smartContext?.patient) {
            throw new AuthorizationError('Patient authentication required');
        }

        const body = RegisterPatientSchema.parse(req.body);
        const nullifier = parseNullifier(body.nullifier, 'nullifier');

        const identity = await PatientIdentityService.registerPatient(smartContext.patient, nullifier);

        res.json({
            success: true,
            patientId: identity.patientId,
            blindedIdPreview: `${identity.blindedId.slice(0, 12)}...`,
            registeredAt: identity.registeredAt.toISOString()
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /identity/patient/blinded
 * Returns blinded identity fields for ZK proof generation.
 */
identityRouter.post('/patient/blinded', async (req: Request, res: Response, next: express.NextFunction) => {
    try {
        const smartContext = (req as any).smartContext;
        if (!smartContext?.patient) {
            throw new AuthorizationError('Patient authentication required');
        }

        const body = BlindedIdentitySchema.parse(req.body);
        const nullifier = parseNullifier(body.nullifier, 'nullifier');

        const result = await PatientIdentityService.getBlindedIdentity(smartContext.patient, nullifier);

        res.json({
            blindedIdFields: result.blindedIdFields.map(field => field.toString()),
            sessionNonce: result.sessionNonce.toString()
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /identity/patient/reset
 * Rotate nullifier for authenticated patient.
 */
identityRouter.post('/patient/reset', async (req: Request, res: Response, next: express.NextFunction) => {
    try {
        const smartContext = (req as any).smartContext;
        if (!smartContext?.patient) {
            throw new AuthorizationError('Patient authentication required');
        }

        const body = PatientResetSchema.parse(req.body);
        const newNullifier = parseNullifier(body.newNullifier, 'newNullifier');

        await PatientIdentityService.resetIdentity(smartContext.patient, newNullifier);

        res.json({
            success: true,
            message: 'Identity rotated successfully. Please re-sync your device.',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /identity/clinician/register
 * Register clinician credentials for break-glass.
 */
identityRouter.post('/clinician/register', async (req: Request, res: Response, next: express.NextFunction) => {
    try {
        const smartContext = (req as any).smartContext;
        if (!smartContext?.practitioner) {
            throw new AuthorizationError('Clinician authentication required');
        }

        const body = ClinicianRegisterSchema.parse(req.body);
        if (body.fhirPractitionerId && body.fhirPractitionerId !== smartContext.practitioner) {
            throw new AuthorizationError('Practitioner mismatch');
        }

        const identity = await ClinicianIdentityService.registerClinician(
            smartContext.practitioner,
            body.licenseNumber,
            body.facilityId
        );

        res.json({
            success: true,
            clinicianId: identity.clinicianId,
            credentialHash: identity.credentialHash
        });
    } catch (error) {
        next(error);
    }
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
