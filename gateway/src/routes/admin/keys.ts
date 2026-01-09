/**
 * Key Rotation Admin Routes
 * 
 * Endpoints for managing and rotating system keys.
 * Protected by strict admin scopes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { keyRotationService } from '../../lib/keyRotation.js';
import { requireScopes } from '../../middleware/apiKeyAuth.js';
import { logger } from '../../lib/logger.js';
import { z } from 'zod';

export const keysRouter: Router = Router();

/**
 * POST /api/admin/keys/gateway/rotate
 * Trigger rotation of the Gateway's blockchain wallet
 */
keysRouter.post('/gateway/rotate', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const safeMode = req.body.safeMode !== false; // Default to true (safe mode)

        logger.warn({ user: (req as any).apiKey?.name, safeMode }, 'Gateway key rotation requested');

        const result = await keyRotationService.rotateGatewayKey(safeMode);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({
            message: 'Gateway key rotation initiated',
            result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/admin/keys/jwt/rotate
 * Trigger rotation of the JWT signing secret
 */
keysRouter.post('/jwt/rotate', requireScopes('admin:write'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        logger.warn({ user: (req as any).apiKey?.name }, 'JWT secret rotation requested');

        const result = await keyRotationService.rotateJWTSecret();

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({
            message: 'JWT secret rotated',
            result
        });
    } catch (error) {
        next(error);
    }
});
