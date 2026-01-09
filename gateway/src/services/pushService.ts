/**
 * Push Notification Service
 * 
 * Handles delivery of push notifications to mobile devices via Expo.
 * 
 * Requirements (SECURITY_AUDIT_CHECKLIST.md CF4):
 * - CF4: Push notifications: no PHI
 */

import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export class PushService {
    private expo: Expo;

    constructor() {
        this.expo = new Expo();
    }

    /**
     * Register a device token for a patient
     */
    async registerToken(patientId: string, token: string, platform: string): Promise<void> {
        if (!Expo.isExpoPushToken(token)) {
            logger.warn({ token }, 'Invalid Expo push token');
            throw new Error('INVALID_PUSH_TOKEN');
        }

        await prisma.deviceToken.upsert({
            where: { token },
            update: {
                patientId,
                lastUsedAt: new Date()
            },
            create: {
                patientId,
                token,
                platform
            }
        });

        logger.info({ patientId, platform }, 'Device token registered');
    }

    /**
     * Send a notification to a patient
     * CRITICAL: Do not include PHI in title or body
     */
    async sendNotification(patientId: string, title: string, body: string, data?: any): Promise<void> {
        // Fetch valid tokens for patient
        const devices = await prisma.deviceToken.findMany({
            where: { patientId }
        });

        if (devices.length === 0) {
            return;
        }

        const messages: ExpoPushMessage[] = devices.map(device => ({
            to: device.token,
            sound: 'default',
            title,
            body,
            data,
            channelId: 'default'
        }));

        try {
            const chunks = this.expo.chunkPushNotifications(messages);

            for (const chunk of chunks) {
                try {
                    const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
                    logger.debug({ count: chunk.length }, 'Push notification chunk sent');

                    // Handle errors in tickets (invalid tokens, etc.)
                    // Basic error handling for invalid tokens could update DB here
                } catch (error) {
                    logger.error({ error }, 'Failed to send push notification chunk');
                }
            }
        } catch (error) {
            logger.error({ error, patientId }, 'Failed to process push notifications');
        }
    }

    /**
     * Send alert notification (Safety wrapper)
     */
    async sendAlert(patientId: string, alertType: string): Promise<void> {
        // Generic messages without PHI
        const MESSAGES: Record<string, { title: string, body: string }> = {
            'BREAK_GLASS': {
                title: 'Emergency Access Alert',
                body: 'Emergency access to your records was detected. Tap to review.'
            },
            'UNUSUAL_VOLUME': {
                title: 'Security Alert',
                body: 'Unusual activity detected on your account. Tap to review.'
            },
            'NEW_PROVIDER': {
                title: 'New Provider Access',
                body: 'A new provider accessed your records. Tap to review.'
            }
        };

        const message = MESSAGES[alertType] || {
            title: 'Security Alert',
            body: 'New activity detected on your account. Tap to review.'
        };

        await this.sendNotification(patientId, message.title, message.body, { type: alertType });
    }
}

export const pushService = new PushService();
