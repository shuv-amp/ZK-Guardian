/**
 * Consent Management API Routes
 * 
 * Per API_REFERENCE.md - Consent Management section
 * 
 * Endpoints:
 * - GET  /api/patient/:patientId/consents - List active consents
 * - POST /api/patient/:patientId/consents - Create new consent
 * - GET  /api/patient/:patientId/consents/:consentId - Get consent details
 * - POST /api/patient/:patientId/consents/:consentId/revoke - Revoke consent
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { ethers } from 'ethers';
import { createHash } from 'crypto';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { validateQuery, validateBody } from '../middleware/validation.js';
import { hashFhirConsent } from '../utils/fhirToPoseidon.js';

export const consentsRouter: Router = Router({ mergeParams: true });

const HAPI_FHIR_URL = env.HAPI_FHIR_URL || 'http://localhost:8080/fhir';

// ============================================
// Schemas
// ============================================

const ListConsentsQuerySchema = z.object({
    status: z.enum(['active', 'inactive', 'revoked', 'all']).default('active'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
});

const CreateConsentSchema = z.object({
    grantedTo: z.object({
        type: z.enum(['Practitioner', 'Organization', 'RelatedPerson']),
        reference: z.string().min(1).max(256),
        displayName: z.string().max(256).optional()
    }),
    allowedCategories: z.array(z.string().max(64)).min(1).max(20),
    deniedCategories: z.array(z.string().max(64)).default([]),
    validPeriod: z.object({
        start: z.string().datetime(),
        end: z.string().datetime()
    }),
    purpose: z.string().max(500).optional()
});

const RevokeConsentSchema = z.object({
    signature: z.string().min(1).max(500),
    reason: z.string().max(500).optional(),
    revokeImmediately: z.boolean().default(true)
});

// ============================================
// GET /api/patient/:patientId/consents
// ============================================

consentsRouter.get('/', validateQuery(ListConsentsQuerySchema), async (req: Request, res: Response) => {
    try {
        const { patientId } = req.params;
        const query = req.query as unknown as z.infer<typeof ListConsentsQuerySchema>;

        // Authorization check: patient can only see their own consents
        const smartContext = req.smartContext;
        if (smartContext?.patient && smartContext.patient !== patientId && !smartContext.practitioner) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Cannot view consents for another patient'
            });
        }

        // Build query
        const where: any = { patientId };
        if (query.status !== 'all') {
            where.status = query.status;
        }

        // Fetch from local cache
        const [consents, total] = await Promise.all([
            prisma.consentCache.findMany({
                where,
                orderBy: { syncedAt: 'desc' },
                take: query.limit,
                skip: query.offset
            }),
            prisma.consentCache.count({ where })
        ]);

        // Transform to API format
        const formatted = consents.map(c => ({
            id: c.fhirConsentId,
            status: c.status,
            scope: 'patient-privacy',
            grantedTo: c.practitionerId ? {
                type: 'Practitioner',
                reference: c.practitionerId,
                displayName: null // Would need to fetch from FHIR
            } : null,
            allowedCategories: c.allowedCategories,
            deniedCategories: c.deniedCategories,
            validPeriod: {
                start: c.validFrom.toISOString(),
                end: c.validUntil.toISOString()
            },
            createdAt: c.syncedAt.toISOString(),
            revokedAt: c.revokedAt?.toISOString() || null
        }));

        res.json({
            consents: formatted,
            pagination: {
                total,
                limit: query.limit,
                offset: query.offset ?? 0,
                hasMore: (query.offset ?? 0) + consents.length < total
            }
        });

    } catch (error: any) {
        logger.error({ error, patientId: req.params.patientId }, 'Failed to list consents');
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to list consents'
        });
    }
});

// ============================================
// POST /api/patient/:patientId/consents
// ============================================

consentsRouter.post('/', validateBody(CreateConsentSchema), async (req: Request, res: Response) => {
    try {
        const { patientId } = req.params;
        const body = req.body as z.infer<typeof CreateConsentSchema>;

        // Authorization: only patient can create their own consents
        const smartContext = req.smartContext;
        if (smartContext?.patient && smartContext.patient !== patientId) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Cannot create consents for another patient'
            });
        }

        // Build FHIR Consent resource
        const consentId = `consent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();

        const fhirConsent = {
            resourceType: 'Consent',
            id: consentId,
            status: 'active',
            scope: {
                coding: [{
                    system: 'http://terminology.hl7.org/CodeSystem/consentscope',
                    code: 'patient-privacy',
                    display: 'Privacy Consent'
                }]
            },
            category: [{
                coding: [{
                    system: 'http://loinc.org',
                    code: '59284-0',
                    display: 'Consent Document'
                }]
            }],
            patient: { reference: `Patient/${patientId}` },
            dateTime: now,
            performer: [{ reference: `Patient/${patientId}` }],
            organization: body.grantedTo.type === 'Organization' 
                ? [{ reference: body.grantedTo.reference }]
                : undefined,
            provision: {
                type: 'permit',
                period: {
                    start: body.validPeriod.start,
                    end: body.validPeriod.end
                },
                actor: [{
                    role: {
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                            code: 'PRCP',
                            display: 'primary recipient'
                        }]
                    },
                    reference: { reference: body.grantedTo.reference }
                }],
                class: body.allowedCategories.map((cat: string) => ({
                    system: 'http://hl7.org/fhir/resource-types',
                    code: cat
                })),
                provision: (body.deniedCategories ?? []).length > 0 ? [{
                    type: 'deny',
                    class: (body.deniedCategories ?? []).map((cat: string) => ({
                        system: 'http://hl7.org/fhir/resource-types',
                        code: cat
                    }))
                }] : undefined,
                purpose: body.purpose ? [{
                    system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
                    code: 'TREAT',
                    display: body.purpose
                }] : undefined
            }
        };

        // Create in FHIR server
        try {
            await axios.put(
                `${HAPI_FHIR_URL}/Consent/${consentId}`,
                fhirConsent,
                { headers: { 'Content-Type': 'application/fhir+json' } }
            );
        } catch (fhirError: any) {
            logger.error({ error: fhirError.response?.data || fhirError.message }, 'FHIR consent creation failed');
            return res.status(502).json({
                error: 'FHIR_ERROR',
                message: 'Failed to create consent in FHIR server'
            });
        }

        // Compute consent hash for ZK proofs
        const consentHash = await hashFhirConsent(fhirConsent as any);

        // Cache locally
        const cached = await prisma.consentCache.create({
            data: {
                patientId,
                fhirConsentId: consentId,
                practitionerId: body.grantedTo.type === 'Practitioner' 
                    ? body.grantedTo.reference.replace('Practitioner/', '')
                    : null,
                allowedCategories: body.allowedCategories,
                deniedCategories: body.deniedCategories,
                validFrom: new Date(body.validPeriod.start),
                validUntil: new Date(body.validPeriod.end),
                status: 'active'
            }
        });

        logger.info({ consentId, patientId }, 'Consent created');

        res.status(201).json({
            id: consentId,
            status: 'active',
            grantedTo: body.grantedTo,
            allowedCategories: body.allowedCategories,
            deniedCategories: body.deniedCategories,
            validPeriod: body.validPeriod,
            createdAt: now,
            consentHash
        });

    } catch (error: any) {
        logger.error({ error, patientId: req.params.patientId }, 'Failed to create consent');
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to create consent'
        });
    }
});

// ============================================
// GET /api/patient/:patientId/consents/:consentId
// ============================================

consentsRouter.get('/:consentId', async (req: Request, res: Response) => {
    try {
        const { patientId, consentId } = req.params;

        // Check local cache first
        const cached = await prisma.consentCache.findFirst({
            where: {
                patientId,
                fhirConsentId: consentId
            }
        });

        if (!cached) {
            // Try fetching from FHIR
            try {
                const response = await axios.get(
                    `${HAPI_FHIR_URL}/Consent/${consentId}`,
                    { headers: { Accept: 'application/fhir+json' } }
                );
                
                const fhirConsent = response.data;
                
                // Verify it belongs to this patient
                const consentPatient = fhirConsent.patient?.reference?.replace('Patient/', '');
                if (consentPatient !== patientId) {
                    return res.status(404).json({
                        error: 'NOT_FOUND',
                        message: 'Consent not found'
                    });
                }

                // Return FHIR data directly
                return res.json({
                    id: fhirConsent.id,
                    status: fhirConsent.status,
                    fhirResource: fhirConsent
                });

            } catch (fhirError: any) {
                if (fhirError.response?.status === 404) {
                    return res.status(404).json({
                        error: 'NOT_FOUND',
                        message: 'Consent not found'
                    });
                }
                throw fhirError;
            }
        }

        res.json({
            id: cached.fhirConsentId,
            status: cached.status,
            grantedTo: cached.practitionerId ? {
                type: 'Practitioner',
                reference: `Practitioner/${cached.practitionerId}`
            } : null,
            allowedCategories: cached.allowedCategories,
            deniedCategories: cached.deniedCategories,
            validPeriod: {
                start: cached.validFrom.toISOString(),
                end: cached.validUntil.toISOString()
            },
            createdAt: cached.syncedAt.toISOString(),
            revokedAt: cached.revokedAt?.toISOString() || null
        });

    } catch (error: any) {
        logger.error({ error, consentId: req.params.consentId }, 'Failed to get consent');
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to get consent'
        });
    }
});

// ============================================
// POST /api/patient/:patientId/consents/:consentId/revoke
// ============================================

consentsRouter.post('/:consentId/revoke', validateBody(RevokeConsentSchema), async (req: Request, res: Response) => {
    try {
        const { patientId, consentId } = req.params;
        const body = req.body as z.infer<typeof RevokeConsentSchema>;

        // Authorization: only patient can revoke their own consents
        const smartContext = req.smartContext;
        if (smartContext?.patient && smartContext.patient !== patientId) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Cannot revoke consents for another patient'
            });
        }

        // Verify consent exists and belongs to patient
        const cached = await prisma.consentCache.findFirst({
            where: {
                patientId,
                fhirConsentId: consentId
            }
        });

        if (!cached) {
            return res.status(404).json({
                error: 'NOT_FOUND',
                message: 'Consent not found'
            });
        }

        if (cached.status === 'revoked') {
            return res.status(400).json({
                error: 'ALREADY_REVOKED',
                message: 'Consent has already been revoked'
            });
        }

        const revokedAt = new Date();
        let txHash: string | null = null;
        let blockNumber: number | null = null;

        // Compute consent hash for on-chain revocation
        const consentHashHex = createHash('sha256')
            .update(consentId + patientId)
            .digest('hex');
        const consentHashBytes32 = '0x' + consentHashHex.slice(0, 64);

        // Submit to blockchain if configured
        if (env.POLYGON_AMOY_RPC && env.GATEWAY_PRIVATE_KEY && process.env.REVOCATION_CONTRACT_ADDRESS) {
            try {
                const provider = new ethers.JsonRpcProvider(env.POLYGON_AMOY_RPC);
                const wallet = new ethers.Wallet(env.GATEWAY_PRIVATE_KEY, provider);
                
                const contract = new ethers.Contract(
                    process.env.REVOCATION_CONTRACT_ADDRESS,
                    ['function revokeConsent(bytes32 consentHash, string calldata reason) external'],
                    wallet
                );

                const tx = await contract.revokeConsent(
                    consentHashBytes32,
                    body.reason || 'Patient revoked'
                );
                
                const receipt = await tx.wait();
                txHash = receipt.hash;
                blockNumber = receipt.blockNumber;

                logger.info({ consentId, txHash }, 'Consent revoked on-chain');

            } catch (blockchainError: any) {
                logger.error({ error: blockchainError.message }, 'Blockchain revocation failed');
                // Continue with local revocation even if blockchain fails
            }
        }

        // Update FHIR server
        try {
            await axios.patch(
                `${HAPI_FHIR_URL}/Consent/${consentId}`,
                [{
                    op: 'replace',
                    path: '/status',
                    value: 'inactive'
                }],
                { 
                    headers: { 
                        'Content-Type': 'application/json-patch+json',
                        'Accept': 'application/fhir+json'
                    } 
                }
            );
        } catch (fhirError: any) {
            logger.warn({ error: fhirError.message }, 'FHIR consent update failed');
            // Continue - local update is authoritative
        }

        // Update local cache
        await prisma.consentCache.update({
            where: { id: cached.id },
            data: {
                status: 'revoked',
                revokedAt
            }
        });

        logger.info({ consentId, patientId }, 'Consent revoked');

        res.json({
            success: true,
            consentId,
            txHash,
            revokedAt: revokedAt.toISOString(),
            effectiveFrom: body.revokeImmediately ? revokedAt.toISOString() : cached.validUntil.toISOString(),
            blockNumber
        });

    } catch (error: any) {
        logger.error({ error, consentId: req.params.consentId }, 'Failed to revoke consent');
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to revoke consent'
        });
    }
});

export default consentsRouter;
