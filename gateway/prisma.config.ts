import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 Configuration
 * 
 * Database URL is now configured here instead of in schema.prisma
 */

export default defineConfig({
    schema: path.join(__dirname, 'prisma', 'schema.prisma'),

    datasource: {
        url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zkguardian',
    },

    migrate: {
        async adapter() {
            const { PrismaPg } = await import('@prisma/adapter-pg');
            const { Pool } = await import('pg');

            const connectionString = process.env.DATABASE_URL ||
                'postgresql://postgres:postgres@localhost:5432/zkguardian';

            const pool = new Pool({ connectionString });
            return new PrismaPg(pool);
        }
    }
});
