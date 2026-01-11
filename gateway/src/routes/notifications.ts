/**
 * Notification Routes
 * 
 * API endpoints for managing push notifications and device tokens.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validation.js';
import { pushNotificationService } from '../modules/notification/pushNotificationService.js';
import { logger } from '../lib/logger.js';

export const notificationsRouter: Router = Router();

// Validation schema for device token registration
const RegisterDeviceTokenSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    platform: z.enum(['ios', 'android', 'web']).default('ios')
});

/**
 * POST /api/patient/notifications/device-token
 * 
 * Register a device token for push notifications.
 * Can be called multiple times for different devices.
 */
notificationsRouter.post(
    '/device-token',
    validateBody(RegisterDeviceTokenSchema),
    async (req: Request, res: Response) => {
        try {
            const { token, platform } = req.body;

            // Patient ID comes from authenticated context
            const patientId = req.smartContext?.patient;

            if (!patientId) {
                return res.status(403).json({
                    error: 'FORBIDDEN',
                    message: 'Only patients can register device tokens'
                });
            }

            await pushNotificationService.registerDeviceToken(
                patientId,
                token,
                platform
            );

            logger.info({ patientId, platform }, 'Device token registered via API');

            res.status(200).json({
                success: true,
                message: 'Device token registered'
            });

        } catch (error) {
            logger.error({ error }, 'Failed to register device token');
            res.status(500).json({
                error: 'INTERNAL_ERROR',
                message: 'Failed to register device token'
            });
        }
    }
);
