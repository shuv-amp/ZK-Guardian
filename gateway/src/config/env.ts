/**
 * Environment Configuration
 * 
 * Validates environment variables at startup.
 */

import { z } from 'zod';

const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    npm_package_version: z.string().optional(),

    // CORS
    CORS_ORIGINS: z.string().transform(val =>
        val === '*' ? '*' : val.split(',').map(s => s.trim())
    ).default('*'),

    // Database
    DATABASE_URL: z.string().url().optional(),

    // Redis
    REDIS_URL: z.string().url().optional(),

    // HAPI FHIR
    HAPI_FHIR_URL: z.string().url().default('http://localhost:8080'),

    // Blockchain
    POLYGON_AMOY_RPC: z.string().url().optional(),
    AUDIT_CONTRACT_ADDRESS: z.string().optional(),
    GATEWAY_PRIVATE_KEY: z.string().optional(),

    // SMART on FHIR
    SMART_ISSUER: z.string().url().optional(),
    SMART_CLIENT_ID: z.string().optional(),

    // Logging
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // Features
    PROMETHEUS_ENABLED: z.coerce.boolean().default(true),
    BATCH_INTERVAL_MS: z.coerce.number().default(300000), // 5 minutes
    BATCH_SIZE: z.coerce.number().default(10)
});

function loadEnv() {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
        console.error('❌ Invalid environment configuration:');
        parsed.error.issues.forEach(issue => {
            console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
        });

        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }

        // Return defaults in development
        return envSchema.parse({});
    }

    return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
