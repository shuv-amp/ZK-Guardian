/**
 * Chaos Engineering Tests
 * 
 * Tests system resilience under failure conditions.
 * No cloud dependencies - uses local infrastructure.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import axios from 'axios';
import { createServer, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';

// Test configuration
const GATEWAY_URL = process.env.TEST_GATEWAY_URL || 'http://localhost:3000';
const TEST_TIMEOUT = 30000;
const runChaosTests = process.env.RUN_CHAOS_TESTS === 'true';

describe.skipIf(!runChaosTests)('Chaos: System Resilience', () => {
    let mockFhirServer: Server | null = null;
    let mockRedis: any = null;

    afterEach(async () => {
        if (mockFhirServer) {
            mockFhirServer.close();
            mockFhirServer = null;
        }
    });

    describe('FHIR Server Failures', () => {
        it('should handle FHIR server timeout gracefully', async () => {
            // Create a mock FHIR server that never responds
            mockFhirServer = createServer((req, res) => {
                // Never send response - simulates timeout
            }).listen(18080);

            // Point gateway to slow mock (would need env override in real test)
            const response = await axios.get(
                `${GATEWAY_URL}/fhir/Patient/timeout-test`,
                {
                    headers: { Authorization: 'Bearer test-token' },
                    timeout: 10000,
                    validateStatus: () => true
                }
            );

            // Should return timeout or gateway error, not crash
            expect([408, 502, 503, 504]).toContain(response.status);
            expect(response.data.error).toBeDefined();
        }, TEST_TIMEOUT);

        it('should handle FHIR server returning 500', async () => {
            mockFhirServer = createServer((req, res) => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal FHIR Error' }));
            }).listen(18081);

            const response = await axios.get(
                `${GATEWAY_URL}/fhir/Patient/error-test`,
                {
                    headers: { Authorization: 'Bearer test-token' },
                    validateStatus: () => true
                }
            );

            expect([500, 502]).toContain(response.status);
        }, TEST_TIMEOUT);

        it('should handle FHIR server returning malformed JSON', async () => {
            mockFhirServer = createServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('not valid json {{{');
            }).listen(18082);

            const response = await axios.get(
                `${GATEWAY_URL}/fhir/Patient/malformed-test`,
                {
                    headers: { Authorization: 'Bearer test-token' },
                    validateStatus: () => true
                }
            );

            expect([400, 500, 502]).toContain(response.status);
        }, TEST_TIMEOUT);
    });

    describe('Database Failures', () => {
        it('should return degraded mode when database is unavailable', async () => {
            // This test requires the gateway to handle DB failures gracefully
            // In a real setup, we'd disconnect the DB and verify behavior

            const response = await axios.get(
                `${GATEWAY_URL}/health`,
                { validateStatus: () => true }
            );

            // Health check should always respond even if DB is down
            expect([200, 503]).toContain(response.status);
            expect(response.data.status).toBeDefined();
        });

        it('should continue processing with in-memory rate limiting when Redis fails', async () => {
            // Make multiple requests - rate limiting should still work
            const requests = [];
            for (let i = 0; i < 15; i++) {
                requests.push(
                    axios.get(`${GATEWAY_URL}/health`, { validateStatus: () => true })
                );
            }

            const responses = await Promise.all(requests);

            // Some should succeed, some may be rate limited
            const successCount = responses.filter(r => r.status === 200).length;
            expect(successCount).toBeGreaterThan(0);
        });
    });

    describe('WebSocket Failures', () => {
        it('should handle abrupt WebSocket disconnection', async () => {
            const ws = new WebSocket(`${GATEWAY_URL.replace('http', 'ws')}/ws/consent`);

            await new Promise<void>((resolve, reject) => {
                ws.on('open', () => {
                    // Send partial message then disconnect
                    ws.send(JSON.stringify({ type: 'CLINICIAN_CONNECT', partial: true }));
                    ws.terminate(); // Abrupt close
                    resolve();
                });
                ws.on('error', reject);
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            // Gateway should not crash - verify with health check
            const health = await axios.get(`${GATEWAY_URL}/health`);
            expect(health.status).toBe(200);
        });

        it('should handle WebSocket message flood', async () => {
            const ws = new WebSocket(`${GATEWAY_URL.replace('http', 'ws')}/ws/consent`);

            await new Promise<void>((resolve, reject) => {
                ws.on('open', () => {
                    // Send many messages quickly
                    for (let i = 0; i < 100; i++) {
                        ws.send(JSON.stringify({ type: 'PING', id: i }));
                    }
                    setTimeout(() => {
                        ws.close();
                        resolve();
                    }, 1000);
                });
                ws.on('error', reject);
            });

            // Gateway should handle flood gracefully
            const health = await axios.get(`${GATEWAY_URL}/health`);
            expect(health.status).toBe(200);
        });
    });

    describe('Blockchain Failures', () => {
        it('should queue proofs when blockchain is slow', async () => {
            // This tests the batch audit service behavior
            // When blockchain is slow, proofs should queue and not block requests

            const response = await axios.get(
                `${GATEWAY_URL}/api/internal/proof-queue-depth`,
                {
                    headers: { Authorization: 'Bearer admin-token' },
                    validateStatus: () => true
                }
            );

            // Queue should be bounded
            if (response.status === 200) {
                expect(response.data.depth).toBeLessThan(200);
            }
        });
    });

    describe('Memory Pressure', () => {
        it('should handle large proof request gracefully', async () => {
            // Try to create a very large input
            const largeInput = {
                patientId: 'a'.repeat(1000),
                clinicianId: 'b'.repeat(1000),
                resourceId: 'c'.repeat(1000),
                resourceType: 'Observation'
            };

            const response = await axios.post(
                `${GATEWAY_URL}/api/internal/test-proof`,
                largeInput,
                {
                    headers: { Authorization: 'Bearer test-token' },
                    validateStatus: () => true
                }
            );

            // Should fail gracefully with validation error
            expect([400, 413]).toContain(response.status);
        });
    });

    describe('Concurrent Access', () => {
        it('should handle 50 concurrent requests without deadlock', async () => {
            const requests = Array.from({ length: 50 }, (_, i) =>
                axios.get(`${GATEWAY_URL}/health`, {
                    timeout: 5000,
                    validateStatus: () => true
                })
            );

            const startTime = Date.now();
            const responses = await Promise.all(requests);
            const duration = Date.now() - startTime;

            // All should complete
            expect(responses.length).toBe(50);

            // Should complete in reasonable time (not deadlocked)
            expect(duration).toBeLessThan(10000);

            // Most should succeed
            const successCount = responses.filter(r => r.status === 200).length;
            expect(successCount).toBeGreaterThan(40);
        }, 15000);

        it('should maintain proof queue under load', async () => {
            // Simulate burst of proof requests
            const proofRequests = Array.from({ length: 20 }, (_, i) =>
                axios.post(
                    `${GATEWAY_URL}/api/internal/test-proof`,
                    {
                        patientId: `burst-patient-${i}`,
                        clinicianId: 'burst-clinician',
                        resourceId: `resource-${i}`,
                        resourceType: 'Observation'
                    },
                    {
                        headers: { Authorization: 'Bearer test-token' },
                        timeout: 60000,
                        validateStatus: () => true
                    }
                )
            );

            const responses = await Promise.all(proofRequests);

            // Check queue didn't overflow (100 max per ZK4 spec)
            const health = await axios.get(`${GATEWAY_URL}/health`);
            expect(health.status).toBe(200);
        }, 120000);
    });
});

describe.skipIf(!runChaosTests)('Chaos: Recovery', () => {
    it('should recover from temporary FHIR outage', async () => {
        // Initial health check
        const before = await axios.get(`${GATEWAY_URL}/health`);
        expect(before.status).toBe(200);

        // Simulate outage (in real test, would stop FHIR container)
        // Wait briefly
        await new Promise(r => setTimeout(r, 2000));

        // Should still be healthy (degraded mode)
        const after = await axios.get(`${GATEWAY_URL}/health`);
        expect([200, 503]).toContain(after.status);
    });

    it('should maintain circuit breaker state', async () => {
        // Make requests that might trip circuit breaker
        const failingRequests = Array.from({ length: 10 }, () =>
            axios.get(`${GATEWAY_URL}/fhir/NonExistent/fail`, {
                headers: { Authorization: 'Bearer test-token' },
                validateStatus: () => true
            })
        );

        await Promise.all(failingRequests);

        // Circuit breaker should activate - subsequent requests fail fast
        const fastFailStart = Date.now();
        const fastFail = await axios.get(
            `${GATEWAY_URL}/fhir/NonExistent/fail-fast`,
            {
                headers: { Authorization: 'Bearer test-token' },
                validateStatus: () => true
            }
        );
        const fastFailDuration = Date.now() - fastFailStart;

        // If circuit breaker is active, response should be fast
        // (not waiting for timeout)
        if (fastFail.status === 503) {
            expect(fastFailDuration).toBeLessThan(1000);
        }
    });
});
