import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

type CheckStatus = 'pass' | 'fail' | 'skip';

type CheckRecord = {
    name: string;
    status: CheckStatus;
    required: boolean;
    startedAt: string;
    finishedAt: string;
    details: Record<string, unknown>;
};

type Options = {
    baseUrl: string;
    wsUrl: string;
    outputPath: string;
    timeoutMs: number;
    strict: boolean;
    expectExternalAuth: boolean;
    patientToken?: string;
    clinicianToken?: string;
    revokedToken?: string;
    patientId?: string;
};

type FetchResult = {
    status: number;
    ok: boolean;
    url: string;
    headers: Record<string, string>;
    text: string;
    json: any;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gatewayDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(gatewayDir, '..');

const DEFAULT_OUTPUT_PATH = path.join(
    repoRoot,
    '.artifacts',
    'staging-validation',
    'latest.json'
);

function printHelp(): void {
    console.log(`ZK Guardian staging validation helper

Usage:
  pnpm --filter gateway verify:staging -- [options]

Options:
  --base-url <url>        Gateway base URL. Default: $BASE_URL or http://127.0.0.1:3000
  --ws-url <url>          Consent WebSocket URL. Default: derived from base URL
  --patient-id <id>       Patient ID for clinician status checks
  --output <path>         Evidence JSON output path
  --timeout-ms <ms>       Per-check timeout in milliseconds. Default: 10000
  --strict                Fail if optional auth inputs are missing
  --expect-local-auth     Allow local gateway /oauth discovery instead of external SMART endpoints
  --help                  Show this help

Environment inputs:
  BASE_URL
  WS_URL
  OUTPUT_PATH
  PATIENT_ACCESS_TOKEN
  CLINICIAN_ACCESS_TOKEN
  REVOKED_ACCESS_TOKEN
  PATIENT_ID
  STRICT_STAGING_VALIDATION
  EXPECT_EXTERNAL_AUTH
  REQUEST_TIMEOUT_MS
`);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function deriveWsUrl(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws/consent';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function resolveOutputPath(outputPath: string): string {
    if (path.isAbsolute(outputPath)) {
        return outputPath;
    }
    return path.resolve(repoRoot, outputPath);
}

function parseArgs(argv: string[]): Options {
    const envBaseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
    const envWsUrl = process.env.WS_URL || deriveWsUrl(envBaseUrl);
    const envOutputPath = process.env.OUTPUT_PATH || DEFAULT_OUTPUT_PATH;
    const envTimeoutMs = parseNumber(process.env.REQUEST_TIMEOUT_MS, 10_000);
    const envStrict = parseBoolean(process.env.STRICT_STAGING_VALIDATION, false);
    const envExpectExternalAuth = parseBoolean(process.env.EXPECT_EXTERNAL_AUTH, true);

    let baseUrl = envBaseUrl;
    let wsUrl = envWsUrl;
    let outputPath = envOutputPath;
    let patientId = process.env.PATIENT_ID;
    let timeoutMs = envTimeoutMs;
    let strict = envStrict;
    let expectExternalAuth = envExpectExternalAuth;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        if (arg === '--strict') {
            strict = true;
            continue;
        }
        if (arg === '--expect-local-auth') {
            expectExternalAuth = false;
            continue;
        }
        if (arg === '--base-url') {
            baseUrl = argv[i + 1] || baseUrl;
            i += 1;
            continue;
        }
        if (arg === '--ws-url') {
            wsUrl = argv[i + 1] || wsUrl;
            i += 1;
            continue;
        }
        if (arg === '--output') {
            outputPath = argv[i + 1] || outputPath;
            i += 1;
            continue;
        }
        if (arg === '--patient-id') {
            patientId = argv[i + 1] || patientId;
            i += 1;
            continue;
        }
        if (arg === '--timeout-ms') {
            timeoutMs = parseNumber(argv[i + 1], timeoutMs);
            i += 1;
            continue;
        }
    }

    baseUrl = new URL(baseUrl).toString().replace(/\/$/, '');
    wsUrl = new URL(wsUrl || deriveWsUrl(baseUrl)).toString();

    return {
        baseUrl,
        wsUrl,
        outputPath: resolveOutputPath(outputPath),
        timeoutMs,
        strict,
        expectExternalAuth,
        patientToken: process.env.PATIENT_ACCESS_TOKEN,
        clinicianToken: process.env.CLINICIAN_ACCESS_TOKEN,
        revokedToken: process.env.REVOKED_ACCESS_TOKEN,
        patientId
    };
}

function serializeHeaders(headers: Headers): Record<string, string> {
    return Object.fromEntries(headers.entries());
}

async function fetchWithTimeout(
    url: string,
    timeoutMs: number,
    init?: RequestInit
): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal
        });
        const text = await response.text();
        let json: any = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }

        return {
            status: response.status,
            ok: response.ok,
            url,
            headers: serializeHeaders(response.headers),
            text,
            json
        };
    } finally {
        clearTimeout(timer);
    }
}

function makeSkipDetails(reason: string): Record<string, unknown> {
    return { reason };
}

function buildSummary(checks: CheckRecord[]): Record<string, number> {
    return checks.reduce(
        (acc, check) => {
            acc[check.status] += 1;
            if (check.required && check.status === 'fail') {
                acc.requiredFailures += 1;
            }
            if (check.required && check.status === 'skip') {
                acc.requiredSkips += 1;
            }
            return acc;
        },
        { pass: 0, fail: 0, skip: 0, requiredFailures: 0, requiredSkips: 0 }
    );
}

function logResult(check: CheckRecord): void {
    const label = check.status.toUpperCase().padEnd(4, ' ');
    console.log(`${label} ${check.name}`);
    if (Object.keys(check.details).length > 0) {
        console.log(JSON.stringify(check.details, null, 2));
    }
}

async function runCheck(
    checks: CheckRecord[],
    name: string,
    required: boolean,
    fn: () => Promise<{ status: CheckStatus; details: Record<string, unknown> }>
): Promise<void> {
    const startedAt = new Date().toISOString();

    try {
        const { status, details } = await fn();
        const record: CheckRecord = {
            name,
            status,
            required,
            startedAt,
            finishedAt: new Date().toISOString(),
            details
        };
        checks.push(record);
        logResult(record);
    } catch (error) {
        const record: CheckRecord = {
            name,
            status: 'fail',
            required,
            startedAt,
            finishedAt: new Date().toISOString(),
            details: {
                error: error instanceof Error ? error.message : String(error)
            }
        };
        checks.push(record);
        logResult(record);
    }
}

function hasAllCriticalReady(healthJson: any): boolean {
    const services = healthJson?.services;
    const critical = ['database', 'zkProver', 'fhir', 'blockchain', 'auth', 'secrets'];
    return critical.every((name) => services?.[name]?.status === 'connected');
}

async function validateWebSocketAuth(wsUrl: string, token: string, timeoutMs: number): Promise<Record<string, unknown>> {
    return await new Promise((resolve, reject) => {
        let settled = false;
        const socket = new WebSocket(wsUrl, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            socket.terminate();
            reject(new Error(`Timed out waiting for WebSocket auth response after ${timeoutMs}ms`));
        }, timeoutMs);

        const finish = (fn: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            fn();
        };

        socket.once('message', (buffer) => {
            finish(() => {
                const raw = buffer.toString();
                let parsed: any = null;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    parsed = null;
                }

                socket.close();

                if (parsed?.type === 'AUTH_SUCCESS') {
                    resolve({
                        wsUrl,
                        messageType: parsed.type,
                        sessionId: parsed.sessionId ?? null
                    });
                    return;
                }

                reject(new Error(`Unexpected WebSocket auth message: ${raw}`));
            });
        });

        socket.once('close', (code, reasonBuffer) => {
            finish(() => {
                reject(new Error(`WebSocket closed before auth success: code=${code} reason=${reasonBuffer.toString()}`));
            });
        });

        socket.once('error', (error) => {
            finish(() => {
                reject(error);
            });
        });
    });
}

async function writeEvidence(outputPath: string, payload: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const checks: CheckRecord[] = [];

    console.log('Staging validation configuration');
    console.log(JSON.stringify({
        baseUrl: options.baseUrl,
        wsUrl: options.wsUrl,
        outputPath: options.outputPath,
        timeoutMs: options.timeoutMs,
        strict: options.strict,
        expectExternalAuth: options.expectExternalAuth,
        hasPatientToken: !!options.patientToken,
        hasClinicianToken: !!options.clinicianToken,
        hasRevokedToken: !!options.revokedToken,
        patientId: options.patientId ?? null
    }, null, 2));

    await runCheck(checks, 'Gateway liveness', true, async () => {
        const result = await fetchWithTimeout(`${options.baseUrl}/health/live`, options.timeoutMs);
        const pass = result.status === 200 && result.json?.alive === true;
        return {
            status: pass ? 'pass' : 'fail',
            details: {
                url: result.url,
                httpStatus: result.status,
                body: result.json ?? result.text
            }
        };
    });

    await runCheck(checks, 'Gateway health', true, async () => {
        const result = await fetchWithTimeout(`${options.baseUrl}/health`, options.timeoutMs);
        const pass = result.status === 200 && typeof result.json?.services === 'object';
        return {
            status: pass ? 'pass' : 'fail',
            details: {
                url: result.url,
                httpStatus: result.status,
                overallStatus: result.json?.status ?? null,
                services: result.json?.services ?? null
            }
        };
    });

    await runCheck(checks, 'Gateway readiness', true, async () => {
        const result = await fetchWithTimeout(`${options.baseUrl}/health/ready`, options.timeoutMs);
        const pass = result.status === 200 && result.json?.ready === true && hasAllCriticalReady(result.json);
        return {
            status: pass ? 'pass' : 'fail',
            details: {
                url: result.url,
                httpStatus: result.status,
                ready: result.json?.ready ?? null,
                services: result.json?.services ?? null
            }
        };
    });

    await runCheck(checks, 'SMART discovery', true, async () => {
        const result = await fetchWithTimeout(`${options.baseUrl}/.well-known/smart-configuration`, options.timeoutMs);
        const discovery = result.json ?? {};
        const requiredKeys = [
            'issuer',
            'authorization_endpoint',
            'token_endpoint',
            'introspection_endpoint',
            'jwks_uri'
        ];
        const missingKeys = requiredKeys.filter((key) => !discovery[key]);

        let pass = result.status === 200 && missingKeys.length === 0;
        let localAuthEndpoints: string[] = [];

        if (pass && options.expectExternalAuth) {
            const baseOrigin = new URL(options.baseUrl).origin;
            const candidateValues = [
                discovery.authorization_endpoint,
                discovery.token_endpoint,
                discovery.introspection_endpoint,
                discovery.revocation_endpoint,
                discovery.jwks_uri
            ].filter((value): value is string => typeof value === 'string');

            localAuthEndpoints = candidateValues.filter((value) =>
                value.startsWith(`${baseOrigin}/oauth/`) || value === `${baseOrigin}/.well-known/jwks.json`
            );

            pass = localAuthEndpoints.length === 0;
        }

        return {
            status: pass ? 'pass' : 'fail',
            details: {
                url: result.url,
                httpStatus: result.status,
                missingKeys,
                localAuthEndpoints,
                discovery
            }
        };
    });

    const patientRequired = options.strict;
    await runCheck(checks, 'Patient token route', patientRequired, async () => {
        if (!options.patientToken) {
            return {
                status: options.strict ? 'fail' : 'skip',
                details: makeSkipDetails('PATIENT_ACCESS_TOKEN not provided')
            };
        }

        const result = await fetchWithTimeout(`${options.baseUrl}/api/patient/preferences`, options.timeoutMs, {
            headers: {
                Authorization: `Bearer ${options.patientToken}`
            }
        });

        return {
            status: result.status === 200 ? 'pass' : 'fail',
            details: {
                url: result.url,
                httpStatus: result.status,
                body: result.json ?? result.text
            }
        };
    });

    const clinicianRequired = options.strict;
    await runCheck(checks, 'Clinician break-glass status route', clinicianRequired, async () => {
        if (!options.clinicianToken || !options.patientId) {
            const missing = [
                !options.clinicianToken ? 'CLINICIAN_ACCESS_TOKEN' : null,
                !options.patientId ? 'PATIENT_ID' : null
            ].filter((value): value is string => !!value);

            return {
                status: options.strict ? 'fail' : 'skip',
                details: makeSkipDetails(`Missing ${missing.join(' and ')}`)
            };
        }

        const result = await fetchWithTimeout(
            `${options.baseUrl}/api/break-glass/${encodeURIComponent(options.patientId)}/status`,
            options.timeoutMs,
            {
                headers: {
                    Authorization: `Bearer ${options.clinicianToken}`
                }
            }
        );

        const pass = result.status === 200 && typeof result.json?.hasActiveSession === 'boolean';
        return {
            status: pass ? 'pass' : 'fail',
            details: {
                url: result.url,
                httpStatus: result.status,
                body: result.json ?? result.text
            }
        };
    });

    await runCheck(checks, 'Revoked token rejection', false, async () => {
        if (!options.revokedToken) {
            return {
                status: 'skip',
                details: makeSkipDetails('REVOKED_ACCESS_TOKEN not provided')
            };
        }

        const result = await fetchWithTimeout(`${options.baseUrl}/api/patient/preferences`, options.timeoutMs, {
            headers: {
                Authorization: `Bearer ${options.revokedToken}`
            }
        });

        const pass = result.status >= 400;
        return {
            status: pass ? 'pass' : 'fail',
            details: {
                url: result.url,
                httpStatus: result.status,
                body: result.json ?? result.text
            }
        };
    });

    const websocketRequired = options.strict;
    await runCheck(checks, 'Consent WebSocket authentication', websocketRequired, async () => {
        if (!options.patientToken) {
            return {
                status: options.strict ? 'fail' : 'skip',
                details: makeSkipDetails('PATIENT_ACCESS_TOKEN not provided')
            };
        }

        const details = await validateWebSocketAuth(options.wsUrl, options.patientToken, options.timeoutMs);
        return {
            status: 'pass',
            details
        };
    });

    const summary = buildSummary(checks);
    const payload = {
        generatedAt: new Date().toISOString(),
        options: {
            baseUrl: options.baseUrl,
            wsUrl: options.wsUrl,
            outputPath: options.outputPath,
            timeoutMs: options.timeoutMs,
            strict: options.strict,
            expectExternalAuth: options.expectExternalAuth,
            patientId: options.patientId ?? null
        },
        summary,
        checks
    };

    await writeEvidence(options.outputPath, payload);

    console.log(`Evidence written to ${options.outputPath}`);
    console.log(JSON.stringify(summary, null, 2));

    if (summary.requiredFailures > 0 || summary.requiredSkips > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
});
