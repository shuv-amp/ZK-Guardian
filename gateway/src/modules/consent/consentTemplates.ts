/**
 * Consent Template Service
 * 
 * Provides pre-defined consent bundles to simplify the patient experience.
 * "One-click" consent configuration for common scenarios.
 */

import { logger } from '../../lib/logger.js';
import { prisma } from '../../db/client.js';
import { consentService } from './consentService.js';

export interface ConsentTemplate {
    id: string;
    name: string;
    description: string;
    icon: string; // Material Icon name
    resources: Array<{
        resourceType: string;
        accessMode: 'read' | 'write' | 'read-write';
        validityDays: number;
    }>;
}

const TEMPLATES: ConsentTemplate[] = [
    {
        id: 'primary-care',
        name: 'Standard Primary Care',
        description: 'Share essential records with your main doctor. Includes vitals, conditions, and allergies.',
        icon: 'medical-bag',
        resources: [
            { resourceType: 'Patient', accessMode: 'read', validityDays: 365 },
            { resourceType: 'Condition', accessMode: 'read', validityDays: 365 },
            { resourceType: 'Observation', accessMode: 'read', validityDays: 365 },
            { resourceType: 'AllergyIntolerance', accessMode: 'read', validityDays: 365 },
            { resourceType: 'Immunization', accessMode: 'read', validityDays: 365 }
        ]
    },
    {
        id: 'emergency-prep',
        name: 'Emergency Preparedness',
        description: 'Allow access to critical info for emergency responders.',
        icon: 'ambulance',
        resources: [
            { resourceType: 'Patient', accessMode: 'read', validityDays: 30 },
            { resourceType: 'AllergyIntolerance', accessMode: 'read', validityDays: 30 },
            { resourceType: 'Condition', accessMode: 'read', validityDays: 30 },
            { resourceType: 'MedicationRequest', accessMode: 'read', validityDays: 30 }
        ]
    },
    {
        id: 'specialist-referral',
        name: 'Specialist Referral',
        description: 'Temporary access for a new specialist consultation.',
        icon: 'doctor',
        resources: [
            { resourceType: 'Patient', accessMode: 'read', validityDays: 14 },
            { resourceType: 'Observation', accessMode: 'read', validityDays: 14 },
            { resourceType: 'DiagnosticReport', accessMode: 'read', validityDays: 14 }
        ]
    },
    {
        id: 'mental-health-privacy',
        name: 'Sensitive Care (Restricted)',
        description: 'Strictly limited access for mental health records.',
        icon: 'brain',
        resources: [
            { resourceType: 'Patient', accessMode: 'read', validityDays: 90 },
            // Deliberately excluding sensitive types by default, only basic info
        ]
    }
];

export class ConsentTemplateService {

    /**
     * Get available templates
     */
    async getTemplates(): Promise<ConsentTemplate[]> {
        return TEMPLATES;
    }

    /**
     * Apply a template for a patient and clinician
     * Creates multiple consent records in one transaction.
     */
    async applyTemplate(
        patientId: string,
        clinicianId: string,
        templateId: string,
        requestor: string
    ): Promise<number> {
        const template = TEMPLATES.find(t => t.id === templateId);
        if (!template) {
            throw new Error(`Template not found: ${templateId}`);
        }

        logger.info({ patientId, clinicianId, templateId }, 'Applying consent template');

        let createdCount = 0;

        // Use transaction not possible easily with API calls in service, 
        // so we iterate sequentially (less atomic but functional for MVP)
        // Ideally ConsentService would support bulk creation.

        for (const res of template.resources) {
            // Check if active consent already exists to avoid dupes
            const existing = await prisma.consentCache.findFirst({
                where: {
                    patientId,
                    practitionerId: clinicianId,
                    // Check if category is allowed
                    allowedCategories: { has: res.resourceType },
                    status: 'active',
                    validUntil: { gt: new Date() }
                }
            });

            if (!existing) {
                await consentService.createConsent({
                    patientId,
                    practitionerId: clinicianId,
                    allowedCategories: [res.resourceType],
                    deniedCategories: [],
                    validDays: res.validityDays,
                    requestorId: requestor
                });
                createdCount++;
            }
        }

        logger.info({ createdCount, templateId }, 'Template applied successfully');
        return createdCount;
    }
}

export const consentTemplateService = new ConsentTemplateService();
