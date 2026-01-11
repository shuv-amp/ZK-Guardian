/**
 * Environment Configuration
 * 
 * Validates environment variables at startup.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

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
    DATABASE_URL: z.string().url().optional().transform(url => {
        console.log('[Config] Raw DATABASE_URL:', url);
        if (process.env.NODE_ENV === 'development' && url) {
            console.log('[Config] Checking for auto-fix...');
            if (url.includes('@postgres:') || url.includes('@db:')) {
                console.log('[Config] Auto-fixing Database URL for local development: postgres -> localhost');
                let fixed = url.replace('@postgres:', '@localhost:').replace('@db:', '@localhost:');
                return fixed;
            }
        }
        return url;
    }),

    // Redis
    REDIS_URL: z.string().url().optional().transform(url => {
        if (process.env.NODE_ENV === 'development' && url?.includes('//redis:')) {
            console.log('[Config] Auto-fixing Redis URL for local development: redis -> localhost');
            return url.replace('//redis:', '//localhost:');
        }
        return url;
    }),

    // HAPI FHIR
    HAPI_FHIR_URL: z.string().url().default('http://localhost:8080'),

    // Blockchain
    POLYGON_AMOY_RPC: z.string().url().optional(),
    AUDIT_CONTRACT_ADDRESS: z.string().optional(),
    GATEWAY_PRIVATE_KEY: z.string().optional(),
    CONSENT_REVOCATION_REGISTRY_ADDRESS: z.string().optional(),

    // SMART on FHIR
    SMART_ISSUER: z.string().url().optional(),
    SMART_CLIENT_ID: z.string().optional(),

    // Logging
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_FILE: z.string().optional(),
    LOG_RETENTION_DAYS: z.coerce.number().default(14),

    // Features
    PROMETHEUS_ENABLED: z.coerce.boolean().default(true),
    BATCH_INTERVAL_MS: z.coerce.number().default(300000), // 5 minutes
    BATCH_SIZE: z.coerce.number().default(10),

    // === New: Tracing & Keys ===
    JAEGER_ENDPOINT: z.string().url().optional(),
    KEY_MASTER_PASSWORD: z.string().optional(),

    // Circuit integrity checksums (optional, for production verification)
    CIRCUIT_WASM_SHA256: z.string().optional(),
    CIRCUIT_ZKEY_SHA256: z.string().optional(),

    // Feature flags
    ENABLE_TRACING: z.coerce.boolean().default(false),
    ENABLE_WORKER_POOL: z.coerce.boolean().default(false),
    ENABLE_SYNTHETIC_CONSENT: z.coerce.boolean().default(false)
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

    console.log('[DEBUG] Loaded Env:', JSON.stringify(parsed.data, null, 2));
    return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
