
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';

interface PendingRequest {
    resolve: (granted: boolean) => void;
    reject: (reason: any) => void;
    timer: NodeJS.Timeout;
}

export class ConsentHandshakeService {
    // Map patientId -> Set of active WebSockets (multi-device support)
    private clients: Map<string, Set<WebSocket>> = new Map();
    // Map requestId -> Pending Promise handlers
    private pendingRequests: Map<string, PendingRequest> = new Map();

    constructor() {
        // Singleton pattern usually managed by module exports
    }

    /**
     * Handles new WebSocket connections.
     * Expects patientId in query params (e.g., ?patientId=123) to bind the socket.
     */
    public handleConnection(ws: WebSocket, req: IncomingMessage) {
        // Parse patientId from URL parameters: /ws/consent?patientId=123
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const patientId = url.searchParams.get("patientId");

        if (!patientId) {
            console.warn("[WS] Connection rejected: Missing patientId");
            ws.close(1008, "Missing patientId");
            return;
        }

        console.log(`[WS] Patient ${patientId} connected`);

        // Add to clients map
        if (!this.clients.has(patientId)) {
            this.clients.set(patientId, new Set());
        }
        this.clients.get(patientId)?.add(ws);

        ws.on('message', (message) => this.handleMessage(patientId, message));

        ws.on('close', () => {
            console.log(`[WS] Patient ${patientId} disconnected`);
            const userSockets = this.clients.get(patientId);
            if (userSockets) {
                userSockets.delete(ws);
                if (userSockets.size === 0) {
                    this.clients.delete(patientId);
                }
            }
        });

        ws.on('error', (err) => {
            console.error(`[WS] Error on patient ${patientId} socket:`, err);
        });
    }

    /**
     * Router for incoming messages.
     * Currently only listens for CONSENT_RESPONSE to resolve pending promises.
     */
    private handleMessage(patientId: string, message: any) {
        try {
            const data = JSON.parse(message.toString());
            // Expected format: { type: "CONSENT_RESPONSE", requestId: "...", approved: true }

            if (data.type === "CONSENT_RESPONSE" && data.requestId) {
                const request = this.pendingRequests.get(data.requestId);
                if (request) {
                    console.log(`[WS] Received consent response for ${data.requestId}: ${data.approved}`);
                    clearTimeout(request.timer);
                    request.resolve(!!data.approved);
                    this.pendingRequests.delete(data.requestId);
                } else {
                    console.warn(`[WS] Unknown or expired request ID: ${data.requestId}`);
                }
            }
        } catch (e) {
            console.error("[WS] Failed to parse message:", e);
        }
    }

    /**
     * Initiates a real-time consent request to the patient.
     * Returns a Promise that resolves true (approved) or false (denied/timeout).
     */
    public async requestConsent(
        patientId: string,
        requestDetails: {
            practitioner: string,
            resourceType: string,
            resourceId: string
        },
        timeoutMs = 30000 // 30 second default timeout
    ): Promise<boolean> {
        const sockets = this.clients.get(patientId);
        if (!sockets || sockets.size === 0) {
            console.log(`[WS] No active device found for patient ${patientId}`);
            return false; // Patient offline
        }

        const requestId = uuidv4();
        console.log(`[WS] Requesting consent ${requestId} from patient ${patientId}`);

        // Broadcast request to all patient devices
        const payload = JSON.stringify({
            type: "CONSENT_REQUEST",
            requestId,
            details: requestDetails,
            timestamp: Date.now()
        });

        for (const ws of sockets) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }

        // Return a promise that waits for response
        return new Promise<boolean>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    console.log(`[WS] Consent request ${requestId} timed out`);
                    this.pendingRequests.delete(requestId);
                    resolve(false); // Default to deny on timeout
                }
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timer });
        });
    }
}

// Singleton Instance
export const consentHandshakeService = new ConsentHandshakeService();

// Helper for index.ts to wire it up
export const setupConsentWebSocket = (wss: WebSocketServer) => {
    wss.on('connection', (ws, req) => {
        consentHandshakeService.handleConnection(ws, req);
    });
};
