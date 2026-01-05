import { config, isBackendConfigured } from '../config/env';
import { NullifierManager } from './NullifierManager';
import * as LocalAuthentication from 'expo-local-authentication';

type ConsentRequest = {
    type: 'CONSENT_REQUEST';
    requestId: string;
    details: {
        practitioner: string;
        resourceType: string;
        resourceId: string;
    };
    timestamp: number;
};

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

type ConsentRequestHandler = (request: ConsentRequest) => void;

/**
 * ConsentHandshakeClient
 * 
 * Manages WebSocket connection to the Gateway for real-time consent requests.
 * Implements automatic reconnection with exponential backoff.
 */
export class ConsentHandshakeClient {
    private socket: WebSocket | null = null;
    private patientId: string | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private baseReconnectDelay = 1000; // 1 second
    private reconnectTimer: NodeJS.Timeout | null = null;

    private onRequestCallback: ConsentRequestHandler | null = null;
    private onStateChangeCallback: ((state: ConnectionState) => void) | null = null;

    /**
     * Connects to the Gateway's WebSocket endpoint.
     * Must be called after user authentication with a valid patientId.
     */
    connect(patientId: string) {
        if (!isBackendConfigured()) {
            console.warn('[ConsentClient] Backend not configured. Skipping WebSocket connection.');
            this.updateState('error');
            return;
        }

        this.patientId = patientId;
        this.reconnectAttempts = 0;
        this.doConnect();
    }

    private doConnect() {
        if (!this.patientId) return;

        this.updateState('connecting');
        const wsUrl = `${config.WS_URL}?patientId=${encodeURIComponent(this.patientId)}`;

        console.log('[ConsentClient] Connecting to:', wsUrl);

        try {
            this.socket = new WebSocket(wsUrl);

            this.socket.onopen = () => {
                console.log('[ConsentClient] Connected');
                this.updateState('connected');
                this.reconnectAttempts = 0;
            };

            this.socket.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.socket.onclose = (event) => {
                console.log('[ConsentClient] Disconnected:', event.code, event.reason);
                this.updateState('disconnected');
                this.scheduleReconnect();
            };

            this.socket.onerror = (error) => {
                console.error('[ConsentClient] WebSocket error:', error);
                this.updateState('error');
            };
        } catch (error) {
            console.error('[ConsentClient] Failed to create WebSocket:', error);
            this.updateState('error');
            this.scheduleReconnect();
        }
    }

    private handleMessage(data: string) {
        try {
            const message = JSON.parse(data) as ConsentRequest;

            if (message.type === 'CONSENT_REQUEST') {
                console.log('[ConsentClient] Received consent request:', message.requestId);
                this.onRequestCallback?.(message);
            }
        } catch (error) {
            console.error('[ConsentClient] Failed to parse message:', error);
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[ConsentClient] Max reconnect attempts reached');
            this.updateState('error');
            return;
        }

        const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;

        console.log(`[ConsentClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.doConnect();
        }, delay);
    }

    private updateState(state: ConnectionState) {
        this.connectionState = state;
        this.onStateChangeCallback?.(state);
    }

    /**
     * Sends a consent response back to the Gateway.
     * Called after user approves/denies via UI.
     */
    async sendResponse(requestId: string, approved: boolean) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        const payload: any = {
            type: 'CONSENT_RESPONSE',
            requestId,
            approved,
        };

        // If approved, include nullifier and nonce
        if (approved) {
            const nullifier = await NullifierManager.getOrCreateNullifier();
            const sessionNonce = NullifierManager.generateSessionNonce();

            payload.nullifier = nullifier.toString();
            payload.sessionNonce = sessionNonce.toString();
        }

        this.socket.send(JSON.stringify(payload));
        console.log('[ConsentClient] Sent response:', requestId, approved);
    }

    /**
     * Performs biometric authentication before approving consent.
     * Returns true if biometric check passed or unavailable (fallback to password).
     */
    async authenticateForConsent(): Promise<boolean> {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
            // Fallback: Allow if biometrics not available (could add PIN fallback here)
            console.log('[ConsentClient] Biometrics not available, allowing consent');
            return true;
        }

        const result = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Confirm your identity to approve access',
            fallbackLabel: 'Use Passcode',
            cancelLabel: 'Cancel',
        });

        return result.success;
    }

    /**
     * Registers a callback for incoming consent requests.
     * The UI should call this to display the consent modal.
     */
    onConsentRequest(callback: ConsentRequestHandler) {
        this.onRequestCallback = callback;
    }

    /**
     * Registers a callback for connection state changes.
     * Useful for showing connection status indicator in UI.
     */
    onStateChange(callback: (state: ConnectionState) => void) {
        this.onStateChangeCallback = callback;
    }

    /**
     * Disconnects from the Gateway.
     * Call on logout or app background.
     */
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.patientId = null;
        this.updateState('disconnected');
    }

    getConnectionState(): ConnectionState {
        return this.connectionState;
    }
}

// Singleton instance for app-wide use
export const consentClient = new ConsentHandshakeClient();
