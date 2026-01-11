/**
 * Push Notification Service
 * 
 * Sends push notifications to patients using Expo Push API.
 * Used for:
 * - Consent request notifications
 * - After-hours access alerts
 * - Break-glass emergency notifications
 * - New provider access alerts
 */

import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

// Expo Push API endpoint
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
    to: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: 'default' | null;
    badge?: number;
    priority?: 'default' | 'normal' | 'high';
    categoryId?: string;
}

interface ExpoPushTicket {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: { error?: string };
}

/**
 * Send push notification to a patient
 */
export async function sendPushToPatient(
    patientId: string,
    title: string,
    body: string,
    data?: Record<string, any>
): Promise<boolean> {
    try {
        // Check if patient wants push notifications
        const prefs = await prisma.patientPreferences.findUnique({
            where: { patientId }
        });

        if (prefs && !prefs.pushNotifications) {
            logger.info({ patientId }, 'Push notifications disabled by patient preference');
            return false;
        }

        // Get patient's device tokens
        const tokens = await prisma.deviceToken.findMany({
            where: { patientId }
        });

        if (tokens.length === 0) {
            logger.info({ patientId }, 'No device tokens registered for patient');
            return false;
        }

        // Build messages for all devices
        const messages: ExpoPushMessage[] = tokens.map((t: any) => ({
            to: t.token,
            title,
            body,
            data: { ...data, patientId },
            sound: 'default',
            priority: 'high',
        }));

        // Send via Expo Push API
        const response = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
        });

        if (!response.ok) {
            logger.error({ patientId, status: response.status }, 'Expo Push API error');
            return false;
        }

        const result: any = await response.json();
        const tickets: ExpoPushTicket[] = result.data || [];

        // Check for errors and clean up invalid tokens
        for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            if (ticket.status === 'error') {
                logger.warn({
                    patientId,
                    token: tokens[i].token,
                    error: ticket.details?.error
                }, 'Push delivery error');

                // Remove invalid tokens
                if (ticket.details?.error === 'DeviceNotRegistered') {
                    await prisma.deviceToken.delete({
                        where: { id: tokens[i].id }
                    });
                    logger.info({ tokenId: tokens[i].id }, 'Removed invalid device token');
                }
            }
        }

        const successCount = tickets.filter(t => t.status === 'ok').length;
        logger.info({ patientId, sent: successCount, total: tokens.length }, 'Push notifications sent');

        return successCount > 0;

    } catch (error) {
        logger.error({ error, patientId }, 'Failed to send push notification');
        return false;
    }
}

/**
 * Send consent request notification
 */
export async function notifyConsentRequest(
    patientId: string,
    clinicianName: string,
    resourceType: string
): Promise<boolean> {
    return sendPushToPatient(
        patientId,
        '🔒 Access Request',
        `${clinicianName} is requesting access to your ${resourceType}`,
        {
            type: 'CONSENT_REQUEST',
            clinicianName,
            resourceType,
        }
    );
}

/**
 * Send after-hours access alert notification
 */
export async function notifyAfterHoursAccess(
    patientId: string,
    clinicianName: string,
    hour: number
): Promise<boolean> {
    return sendPushToPatient(
        patientId,
        '⚠️ After-Hours Access',
        `${clinicianName} accessed your records at ${hour}:00`,
        {
            type: 'AFTER_HOURS_ALERT',
            clinicianName,
            hour,
        }
    );
}

/**
 * Send break-glass emergency notification
 */
export async function notifyBreakGlassAccess(
    patientId: string,
    clinicianName: string,
    reason: string
): Promise<boolean> {
    return sendPushToPatient(
        patientId,
        '🚨 Emergency Access',
        `${clinicianName} used break-glass emergency access`,
        {
            type: 'BREAK_GLASS_ALERT',
            clinicianName,
            reason,
        }
    );
}

/**
 * Send new provider access notification
 */
export async function notifyNewProviderAccess(
    patientId: string,
    clinicianName: string,
    department: string
): Promise<boolean> {
    return sendPushToPatient(
        patientId,
        '👤 New Provider Access',
        `${clinicianName} from ${department} accessed your records for the first time`,
        {
            type: 'NEW_PROVIDER_ALERT',
            clinicianName,
            department,
        }
    );
}

/**
 * Register a device token for a patient
 */
export async function registerDeviceToken(
    patientId: string,
    token: string,
    platform: 'ios' | 'android' | 'web'
): Promise<void> {
    try {
        await prisma.deviceToken.upsert({
            where: { token },
            update: {
                patientId,
                platform,
                lastUsedAt: new Date(),
            },
            create: {
                patientId,
                token,
                platform,
            },
        });

        logger.info({ patientId, platform }, 'Device token registered');

    } catch (error) {
        logger.error({ error, patientId }, 'Failed to register device token');
        throw error;
    }
}

export const pushNotificationService = {
    sendPushToPatient,
    notifyConsentRequest,
    notifyAfterHoursAccess,
    notifyBreakGlassAccess,
    notifyNewProviderAccess,
    registerDeviceToken,
};
