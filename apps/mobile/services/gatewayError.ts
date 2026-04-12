/**
 * Helpers for parsing and presenting gateway error responses in UI.
 */

export interface GatewayError {
    code?: string;
    message?: string;
}

export const parseGatewayError = async (response: Response): Promise<GatewayError> => {
    try {
        const body = await response.json();
        return {
            code: typeof body?.error === 'string' ? body.error : undefined,
            message: typeof body?.message === 'string' ? body.message : undefined,
        };
    } catch {
        return {};
    }
};

export const mapAccessErrorMessage = (code?: string, fallbackMessage?: string): string => {
    switch (code) {
        case 'CONSENT_DENIED':
            return 'Patient denied this access request.';
        case 'CONSENT_TIMEOUT':
            return 'Patient did not respond in time.';
        case 'CONSENT_REVOKED':
            return 'Consent was revoked. Request new consent from the patient.';
        case 'CONSENT_PRACTITIONER_MISMATCH':
            return 'Your clinician ID is not authorized by the patient consent.';
        case 'INSUFFICIENT_SCOPE':
            return 'Consent does not cover this resource type.';
        case 'ACCESS_RESTRICTED_BY_PATIENT_PREFERENCES':
            return fallbackMessage || 'Access is currently outside the patient allowed hours.';
        case 'FHIR_UNAVAILABLE':
            return 'FHIR server is unavailable right now. Please retry shortly.';
        case 'BLOCKCHAIN_NOT_CONFIGURED':
            return 'Audit chain is not configured right now. Contact system admin.';
        case 'CONSENT_INVALID':
            return 'Consent approval was invalid. Ask the patient to retry.';
        case 'PROOF_ALREADY_USED':
            return 'Replay protection triggered. Please retry the request.';
        default:
            return fallbackMessage || 'Access request failed.';
    }
};

export const mapBreakGlassErrorMessage = (code?: string, fallbackMessage?: string): string => {
    switch (code) {
        case 'BREAK_GLASS_DISABLED_BY_PATIENT':
            return 'Patient has disabled emergency break-glass access.';
        case 'BREAK_GLASS_ACTIVE':
            return 'An emergency session is already active for this patient.';
        case 'INVALID_BREAK_GLASS':
            return fallbackMessage || 'Invalid break-glass request.';
        case 'VALIDATION_ERROR':
            return fallbackMessage || 'Break-glass payload validation failed.';
        case 'NO_ACTIVE_SESSION':
            return 'No active break-glass session to close.';
        case 'STATUS_CHECK_FAILED':
            return 'Unable to fetch break-glass status right now.';
        case 'FORBIDDEN':
            return fallbackMessage || 'You are not authorized for this break-glass action.';
        default:
            return fallbackMessage || 'Break-glass request failed.';
    }
};
