import { config } from '../config/env';
import { smartAuth } from './SMARTAuthService';
import { secureFetch } from '../utils/secureFetch';

/**
 * FHIRClient Service
 * 
 * Standardized FHIR API client for the mobile app.
 * Per Development Guide §1.
 * 
 * Features:
 * - Resource CRUD operations
 * - Search capabilities
 * - Pagination handling
 * - Error handling with FHIR OperationOutcome
 */

export interface FHIRResource {
    resourceType: string;
    id?: string;
    meta?: {
        versionId?: string;
        lastUpdated?: string;
    };
    [key: string]: any;
}

export interface FHIRBundle {
    resourceType: 'Bundle';
    type: string;
    total?: number;
    link?: Array<{
        relation: string;
        url: string;
    }>;
    entry?: Array<{
        fullUrl?: string;
        resource: FHIRResource;
        search?: {
            mode: string;
            score?: number;
        };
    }>;
}

export interface FHIRConsent extends FHIRResource {
    resourceType: 'Consent';
    status: 'draft' | 'proposed' | 'active' | 'rejected' | 'inactive' | 'entered-in-error';
    scope: {
        coding: Array<{
            system: string;
            code: string;
            display?: string;
        }>;
    };
    patient: {
        reference: string;
    };
    dateTime?: string;
    performer?: Array<{
        reference: string;
    }>;
    provision?: {
        type?: 'deny' | 'permit';
        period?: {
            start?: string;
            end?: string;
        };
        actor?: Array<{
            role: {
                coding: Array<{
                    system: string;
                    code: string;
                }>;
            };
            reference: {
                reference: string;
            };
        }>;
        class?: Array<{
            system: string;
            code: string;
        }>;
    };
}

export interface FHIRPatient extends FHIRResource {
    resourceType: 'Patient';
    name?: Array<{
        use?: string;
        family?: string;
        given?: string[];
    }>;
    birthDate?: string;
    gender?: string;
}

export interface FHIROperationOutcome extends FHIRResource {
    resourceType: 'OperationOutcome';
    issue: Array<{
        severity: 'fatal' | 'error' | 'warning' | 'information';
        code: string;
        diagnostics?: string;
        details?: {
            text?: string;
        };
    }>;
}

export class FHIRClientError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public operationOutcome?: FHIROperationOutcome
    ) {
        super(message);
        this.name = 'FHIRClientError';
    }
}

export class FHIRClient {
    private baseUrl: string;

    constructor() {
        this.baseUrl = config.GATEWAY_URL
            ? `${config.GATEWAY_URL}/fhir`
            : 'http://localhost:3000/fhir';
    }

    /**
     * Make an authenticated FHIR request
     */
    private async request<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const accessToken = await smartAuth.getAccessToken();

        const headers: HeadersInit = {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json',
            ...options.headers
        };

        if (accessToken) {
            (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
        }

        const url = `${this.baseUrl}${path}`;

        console.log(`[FHIRClient] ${options.method || 'GET'} ${url}`);

        try {
            const response = await secureFetch(url, {
                ...options,
                headers
            });

            // Handle no content
            if (response.status === 204) {
                return {} as T;
            }

            const data = await response.json();

            // Check for FHIR OperationOutcome errors
            if (!response.ok) {
                const outcome = data as FHIROperationOutcome;
                const message = outcome.issue?.[0]?.diagnostics
                    || outcome.issue?.[0]?.details?.text
                    || `FHIR request failed with status ${response.status}`;

                throw new FHIRClientError(message, response.status, outcome);
            }

            return data as T;
        } catch (error) {
            if (error instanceof FHIRClientError) {
                throw error;
            }

            console.error('[FHIRClient] Request failed:', error);
            throw new FHIRClientError(
                error instanceof Error ? error.message : 'Network request failed',
                0
            );
        }
    }

    // ============================================
    // CRUD Operations
    // ============================================

    /**
     * Read a resource by ID
     */
    async read<T extends FHIRResource>(
        resourceType: string,
        id: string
    ): Promise<T> {
        return this.request<T>(`/${resourceType}/${id}`);
    }

    /**
     * Create a new resource
     */
    async create<T extends FHIRResource>(resource: T): Promise<T> {
        return this.request<T>(`/${resource.resourceType}`, {
            method: 'POST',
            body: JSON.stringify(resource)
        });
    }

    /**
     * Update a resource
     */
    async update<T extends FHIRResource>(resource: T): Promise<T> {
        if (!resource.id) {
            throw new Error('Resource ID is required for update');
        }

        return this.request<T>(`/${resource.resourceType}/${resource.id}`, {
            method: 'PUT',
            body: JSON.stringify(resource)
        });
    }

    /**
     * Delete a resource
     */
    async delete(resourceType: string, id: string): Promise<void> {
        await this.request(`/${resourceType}/${id}`, {
            method: 'DELETE'
        });
    }

    /**
     * Search for resources
     */
    async search<T extends FHIRResource>(
        resourceType: string,
        params: Record<string, string | string[]>
    ): Promise<FHIRBundle> {
        const searchParams = new URLSearchParams();

        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                value.forEach(v => searchParams.append(key, v));
            } else {
                searchParams.append(key, value);
            }
        }

        return this.request<FHIRBundle>(`/${resourceType}?${searchParams.toString()}`);
    }

    // ============================================
    // Consent-Specific Methods
    // ============================================

    /**
     * Get all active consents for a patient
     */
    async getPatientConsents(patientId: string): Promise<FHIRConsent[]> {
        const bundle = await this.search<FHIRConsent>('Consent', {
            patient: `Patient/${patientId}`,
            status: 'active'
        });

        return (bundle.entry || []).map(entry => entry.resource as FHIRConsent);
    }

    /**
     * Get a specific consent
     */
    async getConsent(consentId: string): Promise<FHIRConsent> {
        return this.read<FHIRConsent>('Consent', consentId);
    }

    /**
     * Create a new consent
     */
    async createConsent(consent: Omit<FHIRConsent, 'resourceType'>): Promise<FHIRConsent> {
        return this.create<FHIRConsent>({
            resourceType: 'Consent',
            ...consent
        } as FHIRConsent);
    }

    /**
     * Update consent status (e.g., to revoke)
     */
    async updateConsentStatus(
        consentId: string,
        status: FHIRConsent['status']
    ): Promise<FHIRConsent> {
        const consent = await this.getConsent(consentId);
        consent.status = status;
        return this.update<FHIRConsent>(consent);
    }

    // ============================================
    // Patient Methods
    // ============================================

    /**
     * Get the current patient (from SMART context)
     */
    async getCurrentPatient(): Promise<FHIRPatient | null> {
        const patientId = await smartAuth.getPatientId();

        if (!patientId) {
            console.warn('[FHIRClient] No patient ID in context');
            return null;
        }

        try {
            return await this.read<FHIRPatient>('Patient', patientId);
        } catch (error) {
            console.error('[FHIRClient] Failed to fetch patient:', error);
            return null;
        }
    }

    /**
     * Get patient demographic summary
     */
    async getPatientSummary(patientId: string): Promise<{
        id: string;
        name: string;
        birthDate?: string;
        gender?: string;
    } | null> {
        try {
            const patient = await this.read<FHIRPatient>('Patient', patientId);

            const name = patient.name?.[0];
            const displayName = name
                ? `${name.given?.join(' ') || ''} ${name.family || ''}`.trim()
                : 'Unknown';

            return {
                id: patient.id!,
                name: displayName,
                birthDate: patient.birthDate,
                gender: patient.gender
            };
        } catch (error) {
            console.error('[FHIRClient] Failed to get patient summary:', error);
            return null;
        }
    }

    // ============================================
    // Audit Trail
    // ============================================

    /**
     * Get access history for a patient
     */
    async getAccessHistory(
        patientId: string,
        options: {
            limit?: number;
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<FHIRBundle> {
        const params: Record<string, string> = {
            patient: `Patient/${patientId}`,
            _sort: '-date',
            _count: (options.limit || 20).toString()
        };

        if (options.startDate) {
            params['date'] = `ge${options.startDate.toISOString().split('T')[0]}`;
        }

        if (options.endDate) {
            params['date'] = `le${options.endDate.toISOString().split('T')[0]}`;
        }

        return this.search<FHIRResource>('AuditEvent', params);
    }

    // ============================================
    // Pagination
    // ============================================

    /**
     * Get the next page from a bundle
     */
    async getNextPage(bundle: FHIRBundle): Promise<FHIRBundle | null> {
        const nextLink = bundle.link?.find(l => l.relation === 'next');

        if (!nextLink) {
            return null;
        }

        // Extract path from full URL
        const url = new URL(nextLink.url);
        const path = url.pathname + url.search;

        return this.request<FHIRBundle>(path.replace('/fhir', ''));
    }

    /**
     * Iterate through all pages of a search result
     */
    async *searchAll<T extends FHIRResource>(
        resourceType: string,
        params: Record<string, string | string[]>
    ): AsyncGenerator<T> {
        let bundle = await this.search<T>(resourceType, params);

        while (bundle) {
            for (const entry of bundle.entry || []) {
                yield entry.resource as T;
            }

            bundle = await this.getNextPage(bundle) as FHIRBundle;
        }
    }

    // ============================================
    // Capability Statement
    // ============================================

    /**
     * Get server capabilities
     */
    async getCapabilityStatement(): Promise<FHIRResource> {
        return this.request<FHIRResource>('/metadata');
    }
}

// Singleton instance
export const fhirClient = new FHIRClient();
