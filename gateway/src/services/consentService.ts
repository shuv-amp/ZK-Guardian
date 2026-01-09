/**
 * Consent Service
 * Handling all things consent here. Keeps our local DB and the FHIR server in sync.
 */

import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import axios from 'axios';
import { hashFhirConsent } from '../utils/fhirToPoseidon.js';
import { v4 as uuidv4 } from 'uuid';

const HAPI_FHIR_URL = env.HAPI_FHIR_URL || 'http://localhost:8080/fhir';

export interface CreateConsentParams {
    patientId: string;
    practitionerId: string;
    allowedCategories: string[];
    deniedCategories: string[];
    validDays: number;
    requestorId: string;
}

export class ConsentService {

    /**
     * Spins up a new consent record. Syncs to FHIR + local cache.
     */
    async createConsent(params: CreateConsentParams) {
        const { patientId, practitionerId, allowedCategories, deniedCategories, validDays, requestorId } = params;
        const consentId = uuidv4();

        const validFrom = new Date();
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + validDays);

        // Craft the FHIR resource. Server is picky about the structure.
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
                    system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
                    code: 'INFA',
                    display: 'information access'
                }]
            }],
            patient: {
                reference: `Patient/${patientId}`
            },
            performer: [{
                reference: `Practitioner/${practitionerId}`
            }], // Use performer/grantor properly in real FHIR, mapped for simplicity
            provision: {
                type: 'permit',
                period: {
                    start: validFrom.toISOString(),
                    end: validUntil.toISOString()
                },
                actor: [{
                    role: {
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                            code: 'PRCP', // Primary recipient
                            display: 'primary recipient'
                        }]
                    },
                    reference: {
                        reference: `Practitioner/${practitionerId}`
                    }
                }],
                // Categories
                action: [{
                    coding: [{
                        system: "http://terminology.hl7.org/CodeSystem/consentaction",
                        code: "access"
                    }]
                }],
                // Real FHIR consent is wildly complex. Keeping it simple here. 
                // or assume 'permit' covers permitted categories and deny covers others.
                // For MVP: We are storing categories in our cache mainly.
            }
        };

        // Ship it to the FHIR server. Fingers crossed.
        try {
            await axios.put(
                `${HAPI_FHIR_URL}/Consent/${consentId}`,
                fhirConsent,
                { headers: { 'Content-Type': 'application/fhir+json' } }
            );
        } catch (fhirError: any) {
            logger.error({ error: fhirError.response?.data || fhirError.message }, 'FHIR consent creation failed');
            throw new Error('FHIR_ERROR: Failed to sync consent to FHIR server');
        }

        // 3. Compute Hash
        // (Assuming hashFhirConsent works with this structure, if not we rely on standard hashing)
        // const consentHash = await hashFhirConsent(fhirConsent as any);

        // Save it locally so we don't spam the FHIR server.
        const cached = await prisma.consentCache.create({
            data: {
                patientId,
                fhirConsentId: consentId,
                practitionerId,
                allowedCategories,
                deniedCategories,
                validFrom,
                validUntil,
                status: 'active'
            }
        });

        logger.info({ consentId, patientId, practitionerId }, 'Consent created via Service');
        return cached;
    }
}

export const consentService = new ConsentService();
