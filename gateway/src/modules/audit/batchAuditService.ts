import { ethers } from 'ethers';
import { prisma } from '../../db/client.js';
import { enqueueBatchProof, dequeueBatchProofs, getBatchQueueSize } from '../../db/redis.js';
import { logger, logSystemEvent } from '../../lib/logger.js';
import { updateBatchQueueSize, recordGasUsed } from '../../metrics/prometheus.js';

/**
 * Batch Audit Service
 * 
 * Optimizes gas costs by batching ZK proofs before blockchain submission.
 * Expected savings: ~47% vs individual transactions.
 * 
 * Uses Redis as primary queue with PostgreSQL backup.
 */

interface QueuedProof {
    proofA: [string, string];
    proofB: [[string, string], [string, string]];
    proofC: [string, string];
    publicSignals: string[];
    patientId: string;
    resourceType: string;
    auditLogId?: string;
}

interface BatchResult {
    txHash: string;
    blockNumber: number;
    gasUsed: number;
    proofsProcessed: number;
}

class BatchAuditService {
    private isRunning = false;
    private intervalId: NodeJS.Timeout | null = null;
    private provider: ethers.JsonRpcProvider | null = null;
    private wallet: ethers.Wallet | null = null;
    private contract: ethers.Contract | null = null;

    private readonly BATCH_SIZE = 10;
    private readonly BATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    private readonly RPC_URL = process.env.POLYGON_AMOY_RPC || 'https://rpc-amoy.polygon.technology';
    private readonly CONTRACT_ADDRESS = process.env.AUDIT_CONTRACT_ADDRESS;
    private readonly PRIVATE_KEY = process.env.GATEWAY_PRIVATE_KEY;

    private readonly CONTRACT_ABI = [
        'function batchVerifyAndAudit(uint256[2][] calldata _pAs, uint256[2][2][] calldata _pBs, uint256[2][] calldata _pCs, uint256[7][] calldata _pubSignals) external',
        'function verifyAndAudit(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[7] calldata _pubSignals) external',
        'event AccessAudited(bytes32 indexed accessEventHash, bytes32 indexed proofHash, uint256 blindedPatientId, uint256 blindedAccessHash, uint64 timestamp, address indexed auditor)'
    ];

    async initialize(): Promise<void> {
        if (!this.CONTRACT_ADDRESS || !this.PRIVATE_KEY) {
            logger.warn('Blockchain credentials not configured - running in mock mode');
            return;
        }

        try {
            this.provider = new ethers.JsonRpcProvider(this.RPC_URL);
            this.wallet = new ethers.Wallet(this.PRIVATE_KEY, this.provider);
            this.contract = new ethers.Contract(
                this.CONTRACT_ADDRESS,
                this.CONTRACT_ABI,
                this.wallet
            );

            const network = await this.provider.getNetwork();
            logger.info({
                chainId: network.chainId.toString(),
                contractAddress: this.CONTRACT_ADDRESS
            }, 'Batch audit service connected to blockchain');

        } catch (error) {
            logger.error({ error }, 'Failed to initialize blockchain connection');
        }
    }

    start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.intervalId = setInterval(() => this.processBatch(), this.BATCH_INTERVAL_MS);

        logSystemEvent({ event: 'BATCH_FLUSH', details: 'Batch processor started' });
        logger.info({ interval: this.BATCH_INTERVAL_MS }, 'Batch audit processor started');
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('Batch audit processor stopped');
    }

    async queueProof(proof: QueuedProof): Promise<string> {
        const queueId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            // Primary: Redis queue
            await enqueueBatchProof({ ...proof, id: queueId });
        } catch (redisError) {
            // Fallback: PostgreSQL
            logger.warn({ error: redisError }, 'Redis queue failed, using database fallback');

            await prisma.batchProofQueue.create({
                data: {
                    proofA: JSON.stringify(proof.proofA),
                    proofB: JSON.stringify(proof.proofB),
                    proofC: JSON.stringify(proof.proofC),
                    publicSignals: JSON.stringify(proof.publicSignals),
                    patientId: proof.patientId,
                    resourceType: proof.resourceType,
                    status: 'pending'
                }
            });
        }

        // Update metrics
        const queueSize = await this.getQueueSize();
        updateBatchQueueSize(queueSize);

        logger.debug({ queueId, queueSize }, 'Proof queued');
        return queueId;
    }

    async getQueueSize(): Promise<number> {
        try {
            const redisSize = await getBatchQueueSize();
            const dbSize = await prisma.batchProofQueue.count({
                where: { status: 'pending' }
            });
            return redisSize + dbSize;
        } catch {
            return 0;
        }
    }

    async getQueueStatus(): Promise<{
        size: number;
        oldestTimestamp?: string;
        lastFlush?: string;
    }> {
        const size = await this.getQueueSize();

        const oldest = await prisma.batchProofQueue.findFirst({
            where: { status: 'pending' },
            orderBy: { createdAt: 'asc' }
        });

        return {
            size,
            oldestTimestamp: oldest?.createdAt.toISOString()
        };
    }

    async processBatch(): Promise<BatchResult | null> {
        // Get proofs from Redis
        let proofs: QueuedProof[] = [];

        try {
            proofs = await dequeueBatchProofs(this.BATCH_SIZE) as QueuedProof[];
        } catch (redisError) {
            logger.warn({ error: redisError }, 'Redis dequeue failed, using database');
        }

        // Also get from database fallback
        const dbProofs = await prisma.batchProofQueue.findMany({
            where: { status: 'pending' },
            take: this.BATCH_SIZE - proofs.length,
            orderBy: { createdAt: 'asc' }
        });

        if (dbProofs.length > 0) {
            proofs.push(...dbProofs.map(p => ({
                proofA: JSON.parse(p.proofA),
                proofB: JSON.parse(p.proofB),
                proofC: JSON.parse(p.proofC),
                publicSignals: JSON.parse(p.publicSignals),
                patientId: p.patientId,
                resourceType: p.resourceType
            })));
        }

        if (proofs.length === 0) {
            logger.debug('No proofs to process');
            return null;
        }

        logger.info({ count: proofs.length }, 'Processing batch');

        if (!this.contract) {
            // Mock mode
            logger.info({ count: proofs.length }, 'Mock batch processed (no blockchain)');

            // Mark DB proofs as processed
            await prisma.batchProofQueue.updateMany({
                where: { id: { in: dbProofs.map(p => p.id) } },
                data: { status: 'verified', processedAt: new Date() }
            });

            return {
                txHash: `mock-${Date.now()}`,
                blockNumber: 0,
                gasUsed: 0,
                proofsProcessed: proofs.length
            };
        }

        try {
            // Prepare batch data in contract-native format
            const proofAs = proofs.map(p => p.proofA);
            const proofBs = proofs.map(p => p.proofB);
            const proofCs = proofs.map(p => p.proofC);
            const publicSignals = proofs.map(p => p.publicSignals.map(s => BigInt(s)));

            // Submit batch transaction
            const tx = await this.contract.batchVerifyAndAudit(proofAs, proofBs, proofCs, publicSignals);
            const receipt = await tx.wait();

            const result: BatchResult = {
                txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: Number(receipt.gasUsed),
                proofsProcessed: proofs.length
            };

            // Record metrics
            recordGasUsed(result.gasUsed);

            // Update database records
            await prisma.batchProofQueue.updateMany({
                where: { id: { in: dbProofs.map(p => p.id) } },
                data: {
                    status: 'verified',
                    txHash: result.txHash,
                    processedAt: new Date()
                }
            });

            logSystemEvent({
                event: 'BATCH_FLUSH',
                details: `${proofs.length} proofs, tx: ${result.txHash}`
            });

            logger.info(result, 'Batch submitted to blockchain');
            return result;

        } catch (error) {
            logger.error({ error }, 'Batch submission failed');

            // Mark as failed in database
            await prisma.batchProofQueue.updateMany({
                where: { id: { in: dbProofs.map(p => p.id) } },
                data: {
                    status: 'failed',
                    error: (error as Error).message
                }
            });

            return null;
        }
    }

    async forceFlush(): Promise<BatchResult | null> {
        logger.info('Force flushing batch queue');
        return this.processBatch();
    }
}

export const batchAuditService = new BatchAuditService();
export { BatchAuditService, QueuedProof, BatchResult };
