/**
 * Patient Preferences Routes
 * 
 * Allows patients to configure their access control preferences:
 * - After-hours access restrictions (7AM-7PM)
 * - Emergency (break-glass) access toggle
 * - Alert preferences
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { validateBody } from '../middleware/validation.js';

export const patientPreferencesRouter: Router = Router();

// Schema for updating preferences
const UpdatePreferencesSchema = z.object({
    allowEmergencyAccess: z.boolean().optional(),
    restrictAccessHours: z.boolean().optional(),
    accessHoursStart: z.number().min(0).max(23).optional(),
    accessHoursEnd: z.number().min(0).max(23).optional(),
    alertsForAfterHours: z.boolean().optional(),
    alertsForNewProvider: z.boolean().optional(),
    alertsForBreakGlass: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    biometricEnabled: z.boolean().optional(),
});

// GET /api/patient/preferences - Get patient's preferences
patientPreferencesRouter.get('/preferences', async (req: Request, res: Response) => {
    try {
        const smartContext = req.smartContext;
        if (!smartContext?.patient) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Only patients can access their preferences'
            });
        }

        const patientId = smartContext.patient;

        // Get or create preferences with defaults
        let preferences = await prisma.patientPreferences.findUnique({
            where: { patientId }
        });

        if (!preferences) {
            // Create with defaults
            preferences = await prisma.patientPreferences.create({
                data: { patientId }
            });
        }

        res.json({
            allowEmergencyAccess: preferences.allowEmergencyAccess,
            restrictAccessHours: preferences.restrictAccessHours,
            accessHoursStart: preferences.accessHoursStart,
            accessHoursEnd: preferences.accessHoursEnd,
            alertsForAfterHours: preferences.alertsForAfterHours,
            alertsForNewProvider: preferences.alertsForNewProvider,
            alertsForBreakGlass: preferences.alertsForBreakGlass,
            pushNotifications: preferences.pushNotifications,
            biometricEnabled: preferences.biometricEnabled,
            updatedAt: preferences.updatedAt.toISOString()
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to get patient preferences');
        res.status(500).json({
            error: 'PREFERENCES_FETCH_FAILED',
            message: 'Failed to retrieve preferences'
        });
    }
});

// PUT /api/patient/preferences - Update patient's preferences
patientPreferencesRouter.put(
    '/preferences',
    validateBody(UpdatePreferencesSchema),
    async (req: Request, res: Response) => {
        try {
            const smartContext = req.smartContext;
            if (!smartContext?.patient) {
                return res.status(403).json({
                    error: 'FORBIDDEN',
                    message: 'Only patients can update their preferences'
                });
            }

            const patientId = smartContext.patient;
            const updates = req.body;

            // Validate access hours if provided
            if (updates.accessHoursStart !== undefined && updates.accessHoursEnd !== undefined) {
                if (updates.accessHoursStart >= updates.accessHoursEnd) {
                    return res.status(400).json({
                        error: 'INVALID_HOURS',
                        message: 'Access hours start must be before end'
                    });
                }
            }

            // Upsert preferences
            const preferences = await prisma.patientPreferences.upsert({
                where: { patientId },
                update: updates,
                create: { patientId, ...updates }
            });

            logger.info({ patientId, updates: Object.keys(updates) }, 'Patient preferences updated');

            res.json({
                success: true,
                allowEmergencyAccess: preferences.allowEmergencyAccess,
                restrictAccessHours: preferences.restrictAccessHours,
                accessHoursStart: preferences.accessHoursStart,
                accessHoursEnd: preferences.accessHoursEnd,
                alertsForAfterHours: preferences.alertsForAfterHours,
                alertsForNewProvider: preferences.alertsForNewProvider,
                alertsForBreakGlass: preferences.alertsForBreakGlass,
                pushNotifications: preferences.pushNotifications,
                biometricEnabled: preferences.biometricEnabled,
                updatedAt: preferences.updatedAt.toISOString()
            });

        } catch (error: any) {
            logger.error({ error }, 'Failed to update patient preferences');
            res.status(500).json({
                error: 'PREFERENCES_UPDATE_FAILED',
                message: 'Failed to update preferences'
            });
        }
    }
);

// Helper function to check access against patient preferences
export async function checkAccessRestrictions(patientId: string): Promise<{
    allowed: boolean;
    reason?: string;
    preferences?: any;
}> {
    try {
        const prefs = await prisma.patientPreferences.findUnique({
            where: { patientId }
        });

        if (!prefs) {
            // No preferences set, allow access
            return { allowed: true };
        }

        // Check access hours restriction
        if (prefs.restrictAccessHours) {
            const now = new Date();
            const currentHour = now.getHours();

            if (currentHour < prefs.accessHoursStart || currentHour >= prefs.accessHoursEnd) {
                return {
                    allowed: false,
                    reason: `Access restricted outside ${prefs.accessHoursStart}:00-${prefs.accessHoursEnd}:00`,
                    preferences: prefs
                };
            }
        }

        return { allowed: true, preferences: prefs };

    } catch (error) {
        logger.error({ error, patientId }, 'Failed to check access restrictions');
        // Fail open for now, but log the error
        return { allowed: true };
    }
}

// Helper to check if break-glass is allowed
export async function isBreakGlassAllowed(patientId: string): Promise<boolean> {
    try {
        const prefs = await prisma.patientPreferences.findUnique({
            where: { patientId }
        });

        // Default to allowed if no preferences set
        return prefs?.allowEmergencyAccess ?? true;

    } catch (error) {
        logger.error({ error, patientId }, 'Failed to check break-glass permission');
        // Fail open for emergencies
        return true;
    }
}

// Helper to check if an alert should be created
export async function shouldCreateAlert(
    patientId: string,
    alertType: 'AFTER_HOURS' | 'NEW_PROVIDER' | 'BREAK_GLASS'
): Promise<boolean> {
    try {
        const prefs = await prisma.patientPreferences.findUnique({
            where: { patientId }
        });

        if (!prefs) return true; // Default to creating alerts

        switch (alertType) {
            case 'AFTER_HOURS':
                return prefs.alertsForAfterHours;
            case 'NEW_PROVIDER':
                return prefs.alertsForNewProvider;
            case 'BREAK_GLASS':
                return prefs.alertsForBreakGlass;
            default:
                return true;
        }
    } catch (error) {
        logger.error({ error, patientId }, 'Failed to check alert preferences');
        return true;
    }
}
