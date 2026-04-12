/**
 * Replay Protection Service
 * 
 * Tracks proof hashes to prevent replay attacks before blockchain confirmation.
 * Uses Redis for distributed locking with PostgreSQL fallback.
 * 
 * Security Requirements:
 * - AV1: Replay protection via proofHash mapping ✅
 * - Track proofHash BEFORE submitting to blockchain
 * - Atomic check-and-set to prevent race conditions
 * - TTL-based expiration for failed transactions
 */

import { createHash } from 'crypto';
import { getRedis } from '../../db/redis.js';
import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

// Redis key prefix for proof hashes
const PROOF_HASH_PREFIX = 'proof:used:';
// TTL for pending proofs (5 minutes) - allows time for blockchain confirmation
const PENDING_TTL_SECONDS = 300;
// TTL for confirmed proofs (24 hours) - after which blockchain is source of truth
const CONFIRMED_TTL_SECONDS = 86400;

export interface ProofEntry {
    proofHash: string;
    accessEventHash: string;
    patientId: string;
    clinicianId: string;
    resourceType: string;
    status: 'pending' | 'confirmed' | 'failed';
    txHash?: string;
    createdAt: Date;
    confirmedAt?: Date;
}

class ReplayProtectionService {
    private useRedis = true;

    /**
     * Check if a proof hash has already been used
     * Returns true if proof is new (safe to use), false if replay detected
     */
    async checkAndReserve(
        proofHash: string,
        metadata: {
            accessEventHash: string;
            patientId: string;
            clinicianId: string;
            resourceType: string;
        }
    ): Promise<{ isNew: boolean; existingEntry?: ProofEntry }> {
        const normalizedHash = this.normalizeHash(proofHash);

        // Always persist reservation state in PostgreSQL for durability.
        // Redis remains the fast-path lock for distributed race protection.
        const reserveInDb = async (): Promise<{ isNew: boolean; existingEntry?: ProofEntry }> => {
            return this.reservePostgres(normalizedHash, metadata);
        };

        try {
            // Try Redis first for speed
            if (this.useRedis) {
                const result = await this.checkRedis(normalizedHash, metadata);
                if (result !== null) {
                    if (!result.isNew) {
                        return result;
                    }

                    // Redis lock acquired. Persist to DB as source-of-truth.
                    try {
                        const dbResult = await reserveInDb();
                        if (!dbResult.isNew) {
                            // DB says this proof already exists; release Redis reservation.
                            const redis = getRedis();
                            await redis.del(PROOF_HASH_PREFIX + normalizedHash);
                            return dbResult;
                        }
                        return { isNew: true };
                    } catch (dbError) {
                        // Keep Redis reservation when DB persistence fails.
                        logger.warn({ error: dbError }, 'PostgreSQL reservation failed, continuing with Redis reservation only');
                        return { isNew: true };
                    }
                }
            }
        } catch (error) {
            logger.warn({ error }, 'Redis check failed, falling back to PostgreSQL');
            this.useRedis = false;
        }

        // Fallback to PostgreSQL
        return this.reservePostgres(normalizedHash, metadata);
    }

    /**
     * Mark a proof as confirmed (blockchain tx successful)
     */
    async confirmProof(proofHash: string, txHash: string): Promise<void> {
        const normalizedHash = this.normalizeHash(proofHash);

        try {
            // Update Redis TTL
            if (this.useRedis) {
                const redis = getRedis();
                const key = PROOF_HASH_PREFIX + normalizedHash;
                
                // Update the entry with txHash and extend TTL
                const existing = await redis.get(key);
                if (existing) {
                    const entry = JSON.parse(existing);
                    entry.status = 'confirmed';
                    entry.txHash = txHash;
                    entry.confirmedAt = new Date().toISOString();
                    
                    await redis.setex(key, CONFIRMED_TTL_SECONDS, JSON.stringify(entry));
                }
            }
        } catch (error) {
            logger.warn({ error }, 'Redis confirmation failed');
        }

        // Update PostgreSQL record for durability
        try {
            const now = new Date();
            const expiry = new Date(now.getTime() + CONFIRMED_TTL_SECONDS * 1000);

            await prisma.proofSubmission.upsert({
                where: {
                    proofHash: normalizedHash
                },
                update: {
                    status: 'confirmed',
                    txHash,
                    confirmedAt: now,
                    expiresAt: expiry
                },
                create: {
                    proofHash: normalizedHash,
                    status: 'confirmed',
                    txHash,
                    confirmedAt: now,
                    expiresAt: expiry
                }
            });
        } catch (error) {
            logger.warn({ error }, 'PostgreSQL confirmation failed');
        }
    }

    /**
     * Mark a proof as failed (blockchain tx failed or timeout)
     */
    async markFailed(proofHash: string, error: string): Promise<void> {
        const normalizedHash = this.normalizeHash(proofHash);

        try {
            if (this.useRedis) {
                const redis = getRedis();
                const key = PROOF_HASH_PREFIX + normalizedHash;
                
                // Remove from Redis - allows retry with new proof
                await redis.del(key);
            }
        } catch (redisError) {
            logger.warn({ error: redisError }, 'Redis cleanup failed');
        }

        try {
            // Failed proofs can be retried later; keep short-lived metadata.
            await prisma.proofSubmission.upsert({
                where: {
                    proofHash: normalizedHash
                },
                update: {
                    status: 'failed',
                    txHash: null,
                    confirmedAt: null,
                    expiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000)
                },
                create: {
                    proofHash: normalizedHash,
                    status: 'failed',
                    expiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000)
                }
            });
        } catch (dbError) {
            logger.warn({ error: dbError, details: error }, 'PostgreSQL markFailed failed');
        }
    }

    /**
     * Normalize proof hash to consistent format
     */
    private normalizeHash(proofHash: string): string {
        // Remove 0x prefix if present
        const clean = proofHash.startsWith('0x') ? proofHash.slice(2) : proofHash;
        
        // If it's already a hash, return lowercase
        if (/^[0-9a-fA-F]{64}$/.test(clean)) {
            return clean.toLowerCase();
        }
        
        // Otherwise, compute SHA-256
        return createHash('sha256').update(proofHash).digest('hex');
    }

    /**
     * Redis-based check with atomic SETNX
     */
    private async checkRedis(
        normalizedHash: string,
        metadata: {
            accessEventHash: string;
            patientId: string;
            clinicianId: string;
            resourceType: string;
        }
    ): Promise<{ isNew: boolean; existingEntry?: ProofEntry } | null> {
        const redis = getRedis();
        const key = PROOF_HASH_PREFIX + normalizedHash;

        // Check if already exists
        const existing = await redis.get(key);
        if (existing) {
            const entry = JSON.parse(existing) as ProofEntry;
            logger.warn({
                proofHash: normalizedHash,
                existingStatus: entry.status,
                originalPatient: entry.patientId
            }, 'Replay attack detected');
            
            return { isNew: false, existingEntry: entry };
        }

        // Try to reserve atomically using SETNX
        const entry: ProofEntry = {
            proofHash: normalizedHash,
            accessEventHash: metadata.accessEventHash,
            patientId: metadata.patientId,
            clinicianId: metadata.clinicianId,
            resourceType: metadata.resourceType,
            status: 'pending',
            createdAt: new Date()
        };

        // SETNX returns 1 if key was set, 0 if already exists
        const result = await redis.set(
            key,
            JSON.stringify(entry),
            'EX', PENDING_TTL_SECONDS,
            'NX'
        );

        if (result === null) {
            // Race condition - another request reserved it
            const existing = await redis.get(key);
            if (existing) {
                return { isNew: false, existingEntry: JSON.parse(existing) };
            }
        }

        return { isNew: true };
    }

    /**
     * PostgreSQL-based check with row locking
     */
    private async reservePostgres(
        normalizedHash: string,
        metadata: {
            accessEventHash: string;
            patientId: string;
            clinicianId: string;
            resourceType: string;
        }
    ): Promise<{ isNew: boolean; existingEntry?: ProofEntry }> {
        const now = new Date();
        const pendingExpiry = new Date(now.getTime() + PENDING_TTL_SECONDS * 1000);

        const existing = await prisma.proofSubmission.findUnique({
            where: { proofHash: normalizedHash }
        });

        if (!existing) {
            try {
                await prisma.proofSubmission.create({
                    data: {
                        proofHash: normalizedHash,
                        patientId: metadata.patientId,
                        clinicianId: metadata.clinicianId,
                        resourceType: metadata.resourceType,
                        status: 'pending',
                        expiresAt: pendingExpiry
                    }
                });
                return { isNew: true };
            } catch (error: any) {
                // Handle unique race gracefully
                if (error?.code === 'P2002') {
                    const raced = await prisma.proofSubmission.findUnique({
                        where: { proofHash: normalizedHash }
                    });
                    if (raced) {
                        return {
                            isNew: false,
                            existingEntry: this.mapSubmissionToEntry(raced, metadata.accessEventHash)
                        };
                    }
                }
                throw error;
            }
        }

        // Allow retry if previous submission explicitly failed or pending lease expired.
        const isExpiredPending = existing.status === 'pending' && existing.expiresAt < now;
        const canReuse = existing.status === 'failed' || isExpiredPending;

        if (canReuse) {
            await prisma.proofSubmission.update({
                where: { proofHash: normalizedHash },
                data: {
                    patientId: metadata.patientId,
                    clinicianId: metadata.clinicianId,
                    resourceType: metadata.resourceType,
                    status: 'pending',
                    txHash: null,
                    confirmedAt: null,
                    expiresAt: pendingExpiry
                }
            });
            return { isNew: true };
        }

        logger.warn({
            proofHash: normalizedHash,
            status: existing.status
        }, 'Replay attack detected (PostgreSQL)');

        return {
            isNew: false,
            existingEntry: this.mapSubmissionToEntry(existing, metadata.accessEventHash)
        };
    }

    private mapSubmissionToEntry(
        submission: {
            proofHash: string;
            patientId: string | null;
            clinicianId: string | null;
            resourceType: string | null;
            status: string;
            txHash: string | null;
            createdAt: Date;
            confirmedAt: Date | null;
        },
        accessEventHash: string
    ): ProofEntry {
        const status: ProofEntry['status'] =
            submission.status === 'confirmed'
                ? 'confirmed'
                : submission.status === 'failed'
                    ? 'failed'
                    : 'pending';

        return {
            proofHash: submission.proofHash,
            accessEventHash,
            patientId: submission.patientId || 'unknown',
            clinicianId: submission.clinicianId || 'unknown',
            resourceType: submission.resourceType || 'unknown',
            status,
            txHash: submission.txHash || undefined,
            createdAt: submission.createdAt,
            confirmedAt: submission.confirmedAt || undefined
        };
    }

    /**
     * Clean up expired pending proofs (maintenance job)
     */
    async cleanupExpired(): Promise<number> {
        const now = new Date();

        const deleted = await prisma.proofSubmission.deleteMany({
            where: {
                expiresAt: { lt: now }
            }
        });

        if (deleted.count > 0) {
            logger.info({ count: deleted.count }, 'Cleaned up expired proof submissions');
        }

        return deleted.count;
    }
}

export const replayProtection = new ReplayProtectionService();
