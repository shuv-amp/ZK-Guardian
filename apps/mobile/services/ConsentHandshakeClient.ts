import { Platform } from 'react-native';
import { config, isBackendConfigured } from '../config/env';
import { NullifierManager } from './NullifierManager';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as SecureStorage from '../utils/SecureStorage';

const TOKEN_KEY = 'zk_guardian_tokens';

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
 * Consent Handshake Client
 * 
 * This little guy manages the real-time WebSocket connection.
 * It's what keeps the phone and the gateway talking for instant consent popups.
 * Includes auto-reconnect backoff so we don't hammer the server.
 */
export class ConsentHandshakeClient {
    private socket: WebSocket | null = null;
    private patientId: string | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private baseReconnectDelay = 1000; // 1 second
    private reconnectTimer: NodeJS.Timeout | null = null;

    private onRequestCallbacks = new Set<ConsentRequestHandler>();
    private onStateChangeCallbacks = new Set<(state: ConnectionState) => void>();

    /**
     * Connects to the Gateway.
     * Call this ONLY after we know who the patient is.
     * Smart enough to not connect twice.
     */
    connect(patientId: string) {
        // Prevent duplicate connections
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            console.log('[ConsentClient] Already connected/connecting, skipping');
            return;
        }

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

        // Guard against duplicate connect attempts during reconnection
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            console.log('[ConsentClient] Socket already active, skipping doConnect');
            return;
        }

        this.updateState('connecting');

        const wsUrl = `${config.WS_URL}?patientId=${encodeURIComponent(this.patientId)}`;

        console.log('[ConsentClient] Connecting to:', wsUrl);

        try {
            this.attachSocket(wsUrl);
        } catch (error) {
            console.error('[ConsentClient] Failed to create WebSocket:', error);
            this.updateState('error');
            this.scheduleReconnect();
        }
    }

    private async attachSocket(baseUrl: string) {
        const token = await this.getStoredAccessToken();
        const wsUrl = token ? `${baseUrl}&access_token=${encodeURIComponent(token)}` : baseUrl;

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            console.log('[ConsentClient] Connected');
            this.updateState('connected');
            this.reconnectAttempts = 0;
        };

        this.socket.onmessage = (event) => {
            void this.handleMessage(event.data);
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
    }

    private async getStoredAccessToken(): Promise<string | null> {
        try {
            const stored = await SecureStorage.getItemAsync(TOKEN_KEY);
            if (!stored) return null;

            const parsed = JSON.parse(stored) as { accessToken?: string; expiresAt?: number };
            if (!parsed.accessToken) return null;
            if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null;

            return parsed.accessToken;
        } catch (error) {
            console.warn('[ConsentClient] Failed to read access token from storage:', error);
            return null;
        }
    }

    private async clearStoredAccessToken(): Promise<void> {
        try {
            await SecureStorage.deleteItemAsync(TOKEN_KEY);
        } catch (error) {
            console.warn('[ConsentClient] Failed to clear stored access token:', error);
        }
    }

    private async handleMessage(data: string) {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'AUTH_CHALLENGE':
                    // Gateway is asking us to authenticate
                    console.log('[ConsentClient] Received AUTH_CHALLENGE');
                    this.handleAuthChallenge(message.challenge);
                    break;

                case 'AUTH_SUCCESS':
                    console.log('[ConsentClient] Authentication successful');
                    // Session is now authenticated, ready to handle consent requests
                    break;

                case 'AUTH_REQUIRED':
                    console.warn('[ConsentClient] Auth required:', message.message);
                    // Re-trigger authentication
                    if (message.challenge) {
                        this.handleAuthChallenge(message.challenge);
                    }
                    break;

                case 'AUTH_FAILED':
                    console.warn('[ConsentClient] Authentication failed:', message.reason);
                    await this.clearStoredAccessToken();
                    break;

                case 'CONSENT_REQUEST':
                    console.log('[ConsentClient] Received consent request:', message.requestId);
                    this.onRequestCallbacks.forEach(callback => callback(message));
                    break;

                default:
                    console.log('[ConsentClient] Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('[ConsentClient] Failed to parse message:', error);
        }
    }

    /**
     * Challenge Accepted!
     * The gateway wants proof we are who we say we are.
     * In prod, we'd sign this with a real private key. For now, a hash will do.
     */
    private async handleAuthChallenge(challenge: string) {
        try {
            // In development mode, use a simplified auth response
            // In production, this should use proper cryptographic signing with patient's private key
            const timestamp = Date.now();

            // Simple hash-based signature (for development)
            // In production: Use actual crypto signing with user's keypair
            const signature = await this.signChallenge(challenge, timestamp);

            const authResponse = {
                type: 'AUTH_RESPONSE',
                signature,
                timestamp,
            };

            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify(authResponse));
                console.log('[ConsentClient] Sent AUTH_RESPONSE');
            }
        } catch (error) {
            console.error('[ConsentClient] Failed to handle auth challenge:', error);
        }
    }

    /**
     * Signs a challenge for authentication.
     * In development, uses a simple hash. In production, should use proper key-based signing.
     */
    private async signChallenge(challenge: string, timestamp: number): Promise<string> {
        // Development: Create a simple deterministic signature
        // Production: Use actual private key signing
        const message = `${challenge}:${timestamp}:${this.patientId}`;

        // Use a simple hash for now (crypto.subtle not available in RN by default)
        // This is acceptable for development but should be replaced with proper signing
        let hash = 0;
        for (let i = 0; i < message.length; i++) {
            const char = message.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `dev_sig_${Math.abs(hash).toString(16)}`;
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
        this.onStateChangeCallbacks.forEach(callback => callback(state));
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
     * Biometric Check.
     * Before we say "Yes" to sharing data, we need to know it's really the user.
     * Skips on Web/Dev because... well, simulators don't have FaceID.
     */
    async authenticateForConsent(): Promise<boolean> {
        // Skip biometrics on web - not supported
        if (Platform.OS === 'web') {
            console.log('[ConsentClient] Web platform - skipping biometrics');
            return true;
        }

        // In development mode, skip biometrics for easier testing
        if (__DEV__) {
            console.log('[ConsentClient] DEV mode - skipping biometrics');
            return true;
        }

        try {
            // Check if user has disabled biometrics in settings
            const biometricPref = await SecureStore.getItemAsync('zk_guardian_biometric_enabled');

            if (biometricPref === 'false') {
                console.log('[ConsentClient] Biometrics disabled by user preference');
                return true;
            }

            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const isEnrolled = await LocalAuthentication.isEnrolledAsync();

            if (!hasHardware || !isEnrolled) {
                // Fallback: Allow if biometrics not available
                console.log('[ConsentClient] Biometrics not available, allowing consent');
                return true;
            }

            // Get supported authentication types
            const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
            const hasFaceId = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
            const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

            const authMethod = hasFaceId ? 'Face ID' : hasFingerprint ? 'Touch ID' : 'Biometrics';

            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: `Use ${authMethod} to approve access`,
                fallbackLabel: 'Use Passcode',
                cancelLabel: 'Cancel',
                disableDeviceFallback: false,
            });

            console.log(`[ConsentClient] Biometric result: ${result.success ? 'success' : 'failed/cancelled'}`);
            return result.success;
        } catch (error) {
            console.error('[ConsentClient] Biometric auth error:', error);
            // On error, still require confirmation - fail secure
            return false;
        }
    }

    /**
     * Registers a callback for incoming consent requests.
     * The UI should call this to display the consent modal.
     */
    onConsentRequest(callback: ConsentRequestHandler): () => void {
        this.onRequestCallbacks.add(callback);
        return () => {
            this.onRequestCallbacks.delete(callback);
        };
    }

    /**
     * Registers a callback for connection state changes.
     * Useful for showing connection status indicator in UI.
     */
    onStateChange(callback: (state: ConnectionState) => void): () => void {
        this.onStateChangeCallbacks.add(callback);
        return () => {
            this.onStateChangeCallbacks.delete(callback);
        };
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
