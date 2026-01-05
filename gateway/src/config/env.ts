/**
 * Gateway Environment Configuration
 * Validated with Zod for type safety
 */

import { z } from 'zod';

const envSchema = z.object({
    // Server
    PORT: z.string().default('3000').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // FHIR
    HAPI_FHIR_URL: z.string().url().default('http://localhost:8080/fhir'),

    // Auth
    JWT_SECRET: z.string().min(32),

    // Consent
    CONSENT_TIMEOUT_MS: z.string().default('60000').transform(Number),

    // Blockchain
    POLYGON_AMOY_RPC: z.string().url().default('https://rpc-amoy.polygon.technology'),
    GATEWAY_PRIVATE_KEY: z.string().optional(),
    AUDIT_CONTRACT_ADDRESS: z.string().optional(),
    REVOCATION_CONTRACT_ADDRESS: z.string().optional(),

    // Monitoring
    PROMETHEUS_ENABLED: z.string().default('false').transform(v => v === 'true'),

    // CORS
    CORS_ORIGINS: z.string().default('*').transform(v => v === '*' ? '*' : v.split(',')),
});

// Parse and validate environment
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(parseResult.error.format());
    process.exit(1);
}

export const env = parseResult.data;

export type Env = z.infer<typeof envSchema>;
