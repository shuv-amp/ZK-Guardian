/**
 * Environment Configuration
 * 
 * Validates environment variables at startup.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const booleanFromEnv = (defaultValue: boolean) =>
    z.preprocess((value) => {
        if (value === undefined || value === null) return undefined;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
            if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
        }
        return value;
    }, z.boolean().default(defaultValue));

const optionalUrlFromEnv = () =>
    z.preprocess((value) => {
        if (value === undefined || value === null) return undefined;
        if (typeof value !== 'string') return value;

        const normalized = value.trim();
        if (!normalized) return undefined;

        const lower = normalized.toLowerCase();
        if (lower === 'undefined' || lower === 'null' || lower === 'none' || lower === 'n/a') {
            return undefined;
        }

        try {
            // Validate syntax. Invalid optional URLs should not invalidate all env loading.
            // Returning undefined here lets optional fields gracefully drop out.
            // eslint-disable-next-line no-new
            new URL(normalized);
            return normalized;
        } catch {
            return undefined;
        }
    }, z.string().url().optional());

const optionalPositiveNumberFromEnv = () =>
    z.preprocess((value) => {
        if (value === undefined || value === null) return undefined;
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value <= 0) return undefined;
            return value;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized === 'none' || normalized === 'n/a') {
                return undefined;
            }

            const parsed = Number(normalized);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                return undefined;
            }
            return parsed;
        }
        return value;
    }, z.coerce.number().optional());

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
    DATABASE_URL: optionalUrlFromEnv().transform(url => {
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
    REDIS_URL: optionalUrlFromEnv().transform(url => {
        if (process.env.NODE_ENV === 'development' && url?.includes('//redis:')) {
            console.log('[Config] Auto-fixing Redis URL for local development: redis -> localhost');
            return url.replace('//redis:', '//localhost:');
        }
        return url;
    }),

    // HAPI FHIR
    HAPI_FHIR_URL: z.string().url().default('http://localhost:8080'),

    // Blockchain
    POLYGON_AMOY_RPC: optionalUrlFromEnv(),
    AUDIT_CONTRACT_ADDRESS: z.string().optional(),
    GATEWAY_PRIVATE_KEY: z.string().optional(),
    CONSENT_REVOCATION_REGISTRY_ADDRESS: z.string().optional(),
    CREDENTIAL_REGISTRY_ADDRESS: z.string().optional(),

    // SMART on FHIR
    SMART_ISSUER: optionalUrlFromEnv(),
    SMART_CLIENT_ID: z.string().optional(),
    SMART_CLIENT_SECRET: z.string().optional(),
    SMART_AUDIENCE: z.string().optional(),
    SMART_PRIVATE_JWK: z.string().optional(),
    SMART_REDIRECT_URIS: z.string().optional(),
    ALLOW_DEV_BYPASS: booleanFromEnv(false),

    // Logging
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_FILE: z.string().optional(),
    LOG_RETENTION_DAYS: z.coerce.number().default(14),

    // Features
    PROMETHEUS_ENABLED: booleanFromEnv(true),
    BATCH_INTERVAL_MS: z.coerce.number().default(300000), // 5 minutes
    BATCH_SIZE: z.coerce.number().default(10),

    // Rate limiting overrides (optional)
    RATE_LIMIT_BREAK_GLASS_LIMIT: optionalPositiveNumberFromEnv(),
    RATE_LIMIT_BREAK_GLASS_WINDOW_SEC: optionalPositiveNumberFromEnv(),
    RATE_LIMIT_DEFAULT_LIMIT: optionalPositiveNumberFromEnv(),
    RATE_LIMIT_DEFAULT_WINDOW_SEC: optionalPositiveNumberFromEnv(),

    // === New: Tracing & Keys ===
    JAEGER_ENDPOINT: optionalUrlFromEnv(),
    KEY_MASTER_PASSWORD: z.string().optional(),

    // Circuit integrity checksums (optional, for production verification)
    CIRCUIT_WASM_SHA256: z.string().optional(),
    CIRCUIT_ZKEY_SHA256: z.string().optional(),

    // Feature flags
    ENABLE_TRACING: booleanFromEnv(false),
    ENABLE_WORKER_POOL: booleanFromEnv(false),
    ENABLE_SYNTHETIC_CONSENT: booleanFromEnv(false)
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

    if (process.env.NODE_ENV !== 'production') {
        const redacted = {
            ...parsed.data,
            DATABASE_URL: parsed.data.DATABASE_URL ? '[redacted]' : undefined,
            REDIS_URL: parsed.data.REDIS_URL ? '[redacted]' : undefined,
            GATEWAY_PRIVATE_KEY: parsed.data.GATEWAY_PRIVATE_KEY ? '[redacted]' : undefined,
            SMART_CLIENT_SECRET: parsed.data.SMART_CLIENT_SECRET ? '[redacted]' : undefined,
            SMART_PRIVATE_JWK: parsed.data.SMART_PRIVATE_JWK ? '[redacted]' : undefined,
        };

        console.log('[DEBUG] Loaded Env:', JSON.stringify(redacted, null, 2));
    }
    return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
