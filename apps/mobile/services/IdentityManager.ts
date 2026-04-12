/**
 * Identity Manager
 * 
 * Manages patient identity lifecycle in the mobile app:
 * - Initial registration with FHIR Patient ID
 * - Generates and stores nullifier securely
 * - Gets blinded identity for ZK proofs
 * - Handles identity rotation
 */

import * as SecureStore from '../utils/SecureStorage';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import { config } from '../config/env';
import { secureFetch } from '../utils/secureFetch';

const NULLIFIER_KEY = 'zk_guardian_patient_nullifier';
const PATIENT_ID_KEY = 'zk_guardian_patient_id';
const REGISTRATION_KEY = 'zk_guardian_registration_status';

export interface PatientIdentity {
    patientId: string;
    nullifier: bigint;
    isRegistered: boolean;
    registeredAt: Date | null;
}

export interface RegistrationResult {
    success: boolean;
    patientId: string;
    blindedIdPreview: string;
    registeredAt: string;
}

const GATEWAY_URL = config.GATEWAY_URL;

const buildAuthHeaders = (accessToken?: string) => {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
};

const ensureHexValue = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
        return `0x${trimmed.slice(2)}`;
    }
    return `0x${trimmed}`;
};

export class IdentityManager {

    /**
     * Initialize patient identity
     * Called during app first launch or when linking to FHIR
     * 
     * @param fhirPatientId - The Patient ID from FHIR server
     */
    static async initializeIdentity(fhirPatientId: string, accessToken?: string): Promise<RegistrationResult> {
        console.log('[IdentityManager] Initializing identity for:', fhirPatientId);

        // Generate nullifier if doesn't exist
        let nullifierHex = await SecureStore.getItemAsync(NULLIFIER_KEY);

        if (!nullifierHex) {
            console.log('[IdentityManager] Generating new nullifier...');
            const randomBytes = await Crypto.getRandomBytesAsync(32);
            nullifierHex = Array.from(new Uint8Array(randomBytes))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            await SecureStore.setItemAsync(NULLIFIER_KEY, nullifierHex);
        }

        // Store patient ID
        await SecureStore.setItemAsync(PATIENT_ID_KEY, fhirPatientId);

        // Register with gateway
        try {
            const response = await secureFetch(`${GATEWAY_URL}/identity/patient/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(accessToken) },
                body: JSON.stringify({
                    nullifier: ensureHexValue(nullifierHex)
                })
            });

            if (!response.ok) {
                throw new Error('Registration failed');
            }

            const result = await response.json();

            // Mark as registered
            await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify({
                isRegistered: true,
                registeredAt: result.registeredAt
            }));

            console.log('[IdentityManager] Identity registered successfully');

            return {
                success: true,
                patientId: fhirPatientId,
                blindedIdPreview: result.blindedIdPreview,
                registeredAt: result.registeredAt
            };

        } catch (error: any) {
            console.error('[IdentityManager] Registration failed:', error);
            throw new Error('REGISTRATION_FAILED');
        }
    }

    /**
     * Get current identity status
     */
    static async getIdentity(): Promise<PatientIdentity | null> {
        const patientId = await SecureStore.getItemAsync(PATIENT_ID_KEY);
        const nullifierHex = await SecureStore.getItemAsync(NULLIFIER_KEY);
        const registrationJson = await SecureStore.getItemAsync(REGISTRATION_KEY);

        if (!patientId || !nullifierHex) {
            return null;
        }

        const registration = registrationJson ? JSON.parse(registrationJson) : null;

        return {
            patientId,
            nullifier: BigInt('0x' + nullifierHex),
            isRegistered: registration?.isRegistered || false,
            registeredAt: registration?.registeredAt ? new Date(registration.registeredAt) : null
        };
    }

    /**
     * Get blinded identity fields for ZK proof
     * Requires biometric authentication
     */
    static async getBlindedIdentity(accessToken?: string): Promise<{
        blindedIdFields: string[];
        sessionNonce: string;
    }> {
        // Require biometric auth
        const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Authenticate to access your identity',
            fallbackLabel: 'Use Passcode'
        });

        if (!authResult.success) {
            throw new Error('BIOMETRIC_AUTH_FAILED');
        }

        const patientId = await SecureStore.getItemAsync(PATIENT_ID_KEY);
        const nullifierHex = await SecureStore.getItemAsync(NULLIFIER_KEY);

        if (!patientId || !nullifierHex) {
            throw new Error('IDENTITY_NOT_INITIALIZED');
        }

        // Request blinded identity from gateway
        const response = await secureFetch(`${GATEWAY_URL}/identity/patient/blinded`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(accessToken) },
            body: JSON.stringify({
                nullifier: ensureHexValue(nullifierHex)
            })
        });

        if (!response.ok) {
            throw new Error('BLINDED_IDENTITY_FAILED');
        }

        return response.json();
    }

    /**
     * Rotate nullifier and reset identity
     * Called when user wants to break audit trail linkability
     */
    static async rotateIdentity(reason: 'consent_revoke' | 'user_request', accessToken?: string): Promise<void> {
        console.log('[IdentityManager] Rotating identity, reason:', reason);

        // Require biometric for this sensitive operation
        const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Authenticate to reset your identity',
            fallbackLabel: 'Use Passcode'
        });

        if (!authResult.success) {
            throw new Error('BIOMETRIC_AUTH_FAILED');
        }

        const patientId = await SecureStore.getItemAsync(PATIENT_ID_KEY);
        if (!patientId) {
            throw new Error('IDENTITY_NOT_INITIALIZED');
        }

        // Generate new nullifier
        const randomBytes = await Crypto.getRandomBytesAsync(32);
        const newNullifierHex = Array.from(new Uint8Array(randomBytes))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Update on gateway
        const response = await secureFetch(`${GATEWAY_URL}/identity/patient/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(accessToken) },
            body: JSON.stringify({
                newNullifier: ensureHexValue(newNullifierHex)
            })
        });

        if (!response.ok) {
            throw new Error('IDENTITY_RESET_FAILED');
        }

        // Store new nullifier
        await SecureStore.setItemAsync(NULLIFIER_KEY, newNullifierHex);

        console.log('[IdentityManager] Identity rotated successfully');
    }

    /**
     * Check if identity is set up
     */
    static async isInitialized(): Promise<boolean> {
        const patientId = await SecureStore.getItemAsync(PATIENT_ID_KEY);
        const registrationJson = await SecureStore.getItemAsync(REGISTRATION_KEY);

        if (!patientId || !registrationJson) {
            return false;
        }

        const registration = JSON.parse(registrationJson);
        return registration.isRegistered === true;
    }

    /**
     * Clear all identity data (for logout/unlink)
     */
    static async clearIdentity(): Promise<void> {
        // Require biometric
        const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Authenticate to clear identity',
            fallbackLabel: 'Use Passcode'
        });

        if (!authResult.success) {
            throw new Error('BIOMETRIC_AUTH_FAILED');
        }

        await SecureStore.deleteItemAsync(NULLIFIER_KEY);
        await SecureStore.deleteItemAsync(PATIENT_ID_KEY);
        await SecureStore.deleteItemAsync(REGISTRATION_KEY);

        console.log('[IdentityManager] Identity cleared');
    }
}

// Also export clinician identity manager for clinician app
export class ClinicianIdentityManager {

    /**
     * Register clinician credentials
     */
    static async registerCredentials(
        fhirPractitionerId: string,
        licenseNumber: string,
        facilityId: string,
        accessToken?: string
    ): Promise<{ success: boolean; credentialHash: string }> {
        console.log('[ClinicianIdentityManager] Registering credentials');

            const response = await secureFetch(`${GATEWAY_URL}/identity/clinician/register`, {
            method: 'POST',
                headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(accessToken) },
            body: JSON.stringify({
                fhirPractitionerId,
                licenseNumber,
                facilityId
            })
        });

        if (!response.ok) {
            throw new Error('CREDENTIAL_REGISTRATION_FAILED');
        }

        const result = await response.json();

        // Store locally (for proof generation)
        await SecureStore.setItemAsync('clinician_practitioner_id', fhirPractitionerId);
        await SecureStore.setItemAsync('clinician_license', licenseNumber);
        await SecureStore.setItemAsync('clinician_facility', facilityId);

        return {
            success: true,
            credentialHash: result.credentialHash
        };
    }

}
