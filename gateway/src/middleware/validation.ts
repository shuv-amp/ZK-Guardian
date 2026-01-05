/**
 * Request Validation Middleware
 * 
 * Wraps Zod schemas for Express route validation per security checklist API4.
 * 
 * Usage:
 *   router.post('/endpoint', validateBody(MySchema), (req, res) => { ... })
 *   router.get('/endpoint', validateQuery(MySchema), (req, res) => { ... })
 *   router.get('/endpoint/:id', validateParams(IdSchema), (req, res) => { ... })
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { logger } from '../lib/logger.js';

/**
 * Format Zod errors for consistent API responses
 */
function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
    return error.errors.map(err => ({
        path: err.path.join('.'),
        message: err.message
    }));
}

/**
 * Create validation middleware for request body
 */
export function validateBody<T extends ZodSchema>(schema: T): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = schema.safeParse(req.body);
            
            if (!result.success) {
                logger.warn({
                    path: req.path,
                    method: req.method,
                    errors: formatZodError(result.error)
                }, 'Request body validation failed');
                
                res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    message: 'Request body validation failed',
                    details: formatZodError(result.error)
                });
                return;
            }
            
            // Replace body with validated/transformed data
            req.body = result.data;
            next();
        } catch (error) {
            logger.error({ error }, 'Validation middleware error');
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    };
}

/**
 * Create validation middleware for query parameters
 */
export function validateQuery<T extends ZodSchema>(schema: T): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = schema.safeParse(req.query);
            
            if (!result.success) {
                logger.warn({
                    path: req.path,
                    method: req.method,
                    errors: formatZodError(result.error)
                }, 'Query parameter validation failed');
                
                res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    message: 'Query parameter validation failed',
                    details: formatZodError(result.error)
                });
                return;
            }
            
            // Replace query with validated/transformed data
            (req as any).validatedQuery = result.data;
            next();
        } catch (error) {
            logger.error({ error }, 'Validation middleware error');
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    };
}

/**
 * Create validation middleware for URL parameters
 */
export function validateParams<T extends ZodSchema>(schema: T): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = schema.safeParse(req.params);
            
            if (!result.success) {
                logger.warn({
                    path: req.path,
                    method: req.method,
                    errors: formatZodError(result.error)
                }, 'URL parameter validation failed');
                
                res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    message: 'URL parameter validation failed',
                    details: formatZodError(result.error)
                });
                return;
            }
            
            // Store validated params
            (req as any).validatedParams = result.data;
            next();
        } catch (error) {
            logger.error({ error }, 'Validation middleware error');
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    };
}

/**
 * Combined validation - validates body, query, and params in one call
 */
export function validate<
    TBody extends ZodSchema = z.ZodUndefined,
    TQuery extends ZodSchema = z.ZodUndefined,
    TParams extends ZodSchema = z.ZodUndefined
>(options: {
    body?: TBody;
    query?: TQuery;
    params?: TParams;
}): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const errors: Array<{ path: string; message: string; location: string }> = [];
            
            // Validate body
            if (options.body) {
                const result = options.body.safeParse(req.body);
                if (!result.success) {
                    errors.push(...result.error.errors.map(e => ({
                        path: e.path.join('.'),
                        message: e.message,
                        location: 'body'
                    })));
                } else {
                    req.body = result.data;
                }
            }
            
            // Validate query
            if (options.query) {
                const result = options.query.safeParse(req.query);
                if (!result.success) {
                    errors.push(...result.error.errors.map(e => ({
                        path: e.path.join('.'),
                        message: e.message,
                        location: 'query'
                    })));
                } else {
                    (req as any).validatedQuery = result.data;
                }
            }
            
            // Validate params
            if (options.params) {
                const result = options.params.safeParse(req.params);
                if (!result.success) {
                    errors.push(...result.error.errors.map(e => ({
                        path: e.path.join('.'),
                        message: e.message,
                        location: 'params'
                    })));
                } else {
                    (req as any).validatedParams = result.data;
                }
            }
            
            if (errors.length > 0) {
                logger.warn({
                    path: req.path,
                    method: req.method,
                    errors
                }, 'Request validation failed');
                
                res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    message: 'Request validation failed',
                    details: errors
                });
                return;
            }
            
            next();
        } catch (error) {
            logger.error({ error }, 'Validation middleware error');
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    };
}

/**
 * Schema for common patient route parameter
 */
export const PatientParamsSchema = z.object({
    patientId: z.string()
        .min(1, 'Patient ID is required')
        .max(128)
        .regex(/^[a-zA-Z0-9\-_.]+$/, 'Invalid patient ID format')
});

/**
 * Schema for consent ID parameter
 */
export const ConsentParamsSchema = z.object({
    consentId: z.string()
        .min(1, 'Consent ID is required')
        .max(256)
});

/**
 * Schema for alert ID parameter
 */
export const AlertParamsSchema = z.object({
    alertId: z.string()
        .min(1, 'Alert ID is required')
        .max(256)
});

/**
 * Schema for combined patient and alert params
 */
export const PatientAlertParamsSchema = PatientParamsSchema.merge(AlertParamsSchema);
