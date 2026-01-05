import { PrismaClient as GeneratedPrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';

/**
 * Prisma Database Client
 * 
 * Singleton instance with connection pooling and error handling.
 * Uses @prisma/adapter-pg for efficient serverless/edge compatibility.
 */

// Re-export the type
export type PrismaClient = GeneratedPrismaClient;

let prismaInstance: GeneratedPrismaClient | null = null;

function createClient(): GeneratedPrismaClient {
    const connectionString = env.DATABASE_URL;

    // Create a connection pool
    const pool = new Pool({
        connectionString,
        max: 10, // Default pool size
        idleTimeoutMillis: 30000
    });

    // Create the adapter
    const adapter = new PrismaPg(pool);

    // Pass the adapter to PrismaClient
    return new GeneratedPrismaClient({
        adapter,
        log: ['warn', 'error']
    });
}

export function getPrisma(): GeneratedPrismaClient {
    if (!prismaInstance) {
        prismaInstance = createClient();
    }
    return prismaInstance;
}

// Export singleton for convenience
export const prisma = getPrisma();

/**
 * Test database connection
 */
export async function testDatabaseConnection(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch (error) {
        console.error('[DB] Connection failed:', error);
        return false;
    }
}

/**
 * Graceful shutdown
 */
export async function disconnectDatabase(): Promise<void> {
    if (prismaInstance) {
        await prismaInstance.$disconnect();
    }
}
