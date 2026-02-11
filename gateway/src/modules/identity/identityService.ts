/**
 * Identity Service
 * Handles identity generation and verification.
 * 
 * We NEVER expose real FHIR IDs on-chain.
 * Instead, we bake "blinded" hashes that prove ID without doxxing.
 * Deterministic, unlinkable (without key), and ZK-ready.
 */

import { buildPoseidon } from 'circomlibjs';
import crypto from 'crypto';
import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getRedis } from '../../db/redis.js';
import { ethers } from 'ethers';
import { env } from '../../config/env.js';

// Type imports
type Poseidon = Awaited<ReturnType<typeof buildPoseidon>>;

interface PatientIdentity {
    patientId: string;           // Original FHIR Patient ID
    blindedId: string;           // Blinded identifier for on-chain use
    blindedIdFields: bigint[];   // Split into 4 field elements for circuit
    registeredAt: Date;
}

interface ClinicianIdentity {
    clinicianId: string;         // FHIR Practitioner ID
    blindedId: string;           // Blinded identifier
    blindedIdFields: bigint[];   // Split into 4 field elements
    facilityId: string;
    licenseHash: string;
    credentialHash: string;      // For BreakGlass Merkle tree
    registeredAt: Date;
}

let poseidon: Poseidon | null = null;
let F: any = null;

/**
 * Initialize the Poseidon hasher
 */
async function initPoseidon(): Promise<void> {
    if (!poseidon) {
        poseidon = await buildPoseidon();
        F = poseidon.F;
        logger.info('Identity Service: Poseidon initialized');
    }
}

/**
 * Convert a string to a field element (fits in BN254 field)
 */
function stringToFieldElement(str: string): bigint {
    const hash = crypto.createHash('sha256').update(str).digest();
    // Take first 31 bytes to ensure it fits in BN254 field
    return BigInt('0x' + hash.subarray(0, 31).toString('hex'));
}

/**
 * Split a large ID into 4 field elements (each 64-bit) for circuit input
 */
function splitToFieldElements(id: string): bigint[] {
    const hash = stringToFieldElement(id);
    return [
        (hash >> 192n) & 0xFFFFFFFFFFFFFFFFn,
        (hash >> 128n) & 0xFFFFFFFFFFFFFFFFn,
        (hash >> 64n) & 0xFFFFFFFFFFFFFFFFn,
        hash & 0xFFFFFFFFFFFFFFFFn
    ];
}

/**
 * Patient Identity Management
 */
export class PatientIdentityService {

    /**
     * Registers a new patient. Runs when they first link their wallet.
     * @param fhirPatientId The hospital ID
     * @param nullifier User's private key derivative
     */
    static async registerPatient(
        fhirPatientId: string,
        nullifier: bigint
    ): Promise<PatientIdentity> {
        await initPoseidon();

        // Generate blinded patient ID
        const patientIdFields = splitToFieldElements(fhirPatientId);

        // Blinded = Poseidon(nullifier, patientId[0], patientId[1], patientId[2], patientId[3])
        const blindedHash = F.toString(poseidon!([
            nullifier,
            ...patientIdFields
        ]));

        const blindedIdFields = splitToFieldElements(blindedHash);

        // Store mapping in database (encrypted at rest)
        const identity = await prisma.patientIdentity.upsert({
            where: { fhirPatientId },
            create: {
                fhirPatientId,
                blindedId: blindedHash,
                registeredAt: new Date()
            },
            update: {
                blindedId: blindedHash
            }
        });

        logger.info({ fhirPatientId, blindedId: blindedHash.slice(0, 16) + '...' },
            'Patient identity registered');

        return {
            patientId: fhirPatientId,
            blindedId: blindedHash,
            blindedIdFields,
            registeredAt: identity.registeredAt
        };
    }

    /**
     * Get a patient's blinded identity for ZK proof generation
     */
    static async getBlindedIdentity(
        fhirPatientId: string,
        nullifier: bigint
    ): Promise<{ blindedIdFields: bigint[]; sessionNonce: bigint }> {
        await initPoseidon();

        const patientIdFields = splitToFieldElements(fhirPatientId);

        // Generate session-specific nonce
        const sessionNonce = BigInt(Date.now()) * 1000000n +
            BigInt(crypto.randomInt(0, 1000000));

        // Blinded with session nonce for unlinkability
        const blindedHash = F.toString(poseidon!([
            nullifier,
            sessionNonce,
            ...patientIdFields
        ]));

        return {
            blindedIdFields: splitToFieldElements(blindedHash),
            sessionNonce
        };
    }

    /**
     * Rotate keys. Called when a user loses their device.
     */
    static async resetIdentity(
        fhirPatientId: string,
        newNullifier: bigint
    ): Promise<void> {
        logger.info({ fhirPatientId }, 'Resetting patient identity');
        await initPoseidon(); // Ensure poseidon initialized

        // Just re-register will update the blindedId
        await this.registerPatient(fhirPatientId, newNullifier);
    }
}

/**
 * Clinician Identity Management
 */
export class ClinicianIdentityService {

    /**
     * Register a clinician with their credentials
     * 
     * @param fhirPractitionerId - FHIR Practitioner resource ID
     * @param licenseNumber - Medical license number
     * @param facilityId - Facility/hospital ID
     */
    static async registerClinician(
        fhirPractitionerId: string,
        licenseNumber: string,
        facilityId: string
    ): Promise<ClinicianIdentity> {
        await initPoseidon();

        // Generate blinded clinician ID
        const clinicianIdFields = splitToFieldElements(fhirPractitionerId);
        const licenseFields = splitToFieldElements(licenseNumber);
        const facilityFields = splitToFieldElements(facilityId);

        // Blinded ID = Poseidon(clinicianId[4], license[4])
        const blindedHash = F.toString(poseidon!([
            ...clinicianIdFields,
            ...licenseFields
        ]));

        // Credential hash for BreakGlass Merkle tree
        // Must match: Poseidon(clinicianId[4], license[4], facilityId[0])
        const credentialHash = F.toString(poseidon!([
            ...clinicianIdFields,
            ...licenseFields,
            facilityFields[0]
        ]));

        const licenseHash = crypto.createHash('sha256')
            .update(licenseNumber)
            .digest('hex');

        // Store in database
        const identity = await prisma.clinicianIdentity.upsert({
            where: { fhirPractitionerId },
            create: {
                fhirPractitionerId,
                blindedId: blindedHash,
                credentialHash,
                facilityId,
                licenseHash,
                registeredAt: new Date()
            },
            update: {
                blindedId: blindedHash,
                credentialHash,
                facilityId,
                licenseHash
            }
        });

        // Register belief on-chain. Critical for Break-Glass contract checks.
        if (env.POLYGON_AMOY_RPC && env.GATEWAY_PRIVATE_KEY && env.CREDENTIAL_REGISTRY_ADDRESS) {
            try {
                const provider = new ethers.JsonRpcProvider(env.POLYGON_AMOY_RPC);
                const wallet = new ethers.Wallet(env.GATEWAY_PRIVATE_KEY, provider);
                const credentialRegistryAbi = ['function registerCredential(bytes32 credentialHash) external'];
            const contract = new ethers.Contract(env.CREDENTIAL_REGISTRY_ADDRESS, credentialRegistryAbi, wallet);

            logger.info({ credentialHash, address: env.CREDENTIAL_REGISTRY_ADDRESS }, 'Registering credential on-chain...');

                const tx = await contract.registerCredential(credentialHash);
                await tx.wait();

                logger.info({ txHash: tx.hash }, 'Credential registered on-chain');
            } catch (error: any) {
                logger.error({ error: error.message }, 'Failed to register credential on-chain');
                // We don't throw here to avoid blocking registration, but this IS a critical gap for break-glass
                // Ideally we should have a retry queue
            }
        } else {
            logger.warn('Blockchain config missing - skipping on-chain credential registration');
        }

        logger.info({
            fhirPractitionerId,
            facilityId,
            blindedId: blindedHash.slice(0, 16) + '...'
        }, 'Clinician identity registered');

        return {
            clinicianId: fhirPractitionerId,
            blindedId: blindedHash,
            blindedIdFields: splitToFieldElements(blindedHash),
            facilityId,
            licenseHash,
            credentialHash,
            registeredAt: identity.registeredAt
        };
    }

    /**
     * Get clinician fields for ZK proof generation
     */
    static async getClinicianFields(
        fhirPractitionerId: string,
        licenseNumber: string
    ): Promise<{ clinicianIdFields: bigint[]; licenseFields: bigint[] }> {
        return {
            clinicianIdFields: splitToFieldElements(fhirPractitionerId),
            licenseFields: splitToFieldElements(licenseNumber)
        };
    }

    /**
     * Verify clinician is registered with valid credentials
     */
    static async verifyCredentials(
        fhirPractitionerId: string
    ): Promise<boolean> {
        const identity = await prisma.clinicianIdentity.findUnique({
            where: { fhirPractitionerId }
        });

        return identity !== null;
    }

    /**
     * Get credential hash for BreakGlass Merkle tree registration
     */
    static async getCredentialHash(
        fhirPractitionerId: string
    ): Promise<string | null> {
        const identity = await prisma.clinicianIdentity.findUnique({
            where: { fhirPractitionerId }
        });

        return identity?.credentialHash || null;
    }
}

/**
 * Utility exports for use in ZK proof generation
 */
export {
    stringToFieldElement,
    splitToFieldElements,
    initPoseidon
};
