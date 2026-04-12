import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../utils/SecureStorage';
import { config, isBackendConfigured } from '../config/env';
import { secureFetch } from '../utils/secureFetch';

// Required for Expo AuthSession
WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'zk_guardian_tokens';

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    patient?: string; // SMART launch context
    practitioner?: string;
    token_type: string;
}

interface StoredTokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    patientId?: string;
    practitionerId?: string;
}

export type AuthRole = 'patient' | 'clinician';

/**
 * SMART Auth Service
 * 
 * The heavy lifter for OAuth2 logic.
 * Handles the redirect dance and keeps tokens safe in SecureStore.
 */
export class SMARTAuthService {
    private discoveryDocument: AuthSession.DiscoveryDocument | null = null;
    private tokens: StoredTokens | null = null;

    private randomString(length = 64): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }

    private async createPkceChallenge(codeVerifier: string): Promise<string> {
        const digest = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            codeVerifier,
            { encoding: Crypto.CryptoEncoding.BASE64 }
        );
        return digest.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }

    private async directDevLogin(role: AuthRole): Promise<boolean> {
        if (!config.ENABLE_DEV_DIRECT_LOGIN || !__DEV__) {
            return false;
        }

        const redirectUri = AuthSession.makeRedirectUri({
            scheme: 'zkguardian',
            path: 'auth',
        });
        const state = this.randomString(24);
        const codeVerifier = this.randomString(72);
        const codeChallenge = await this.createPkceChallenge(codeVerifier);
        const patientId = 'patient-riley';
        const clinicianId = 'practitioner-rajesh';

        const body = new URLSearchParams({
            client_id: 'zk-guardian-mobile',
            redirect_uri: redirectUri,
            state,
            scope: role === 'patient'
                ? 'openid fhirUser offline_access patient/*.read launch/patient'
                : 'openid fhirUser offline_access user/*.read launch',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            role,
            role_hint: role,
            patient_id: role === 'patient' ? patientId : '',
            clinician_id: role === 'clinician' ? clinicianId : '',
        });

        const authResponse = await secureFetch(`${config.GATEWAY_URL}/oauth/authorize-submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Dev-Direct': 'true',
            },
            body: body.toString(),
        });

        if (!authResponse.ok) {
            const text = await authResponse.text();
            console.warn('[SMARTAuth] Dev direct authorize failed:', authResponse.status, text);
            return false;
        }

        const authData = await authResponse.json() as { code?: string };
        if (!authData.code) {
            console.warn('[SMARTAuth] Dev direct authorize missing code');
            return false;
        }

        return this.exchangeCodeForTokens(authData.code, redirectUri, codeVerifier);
    }

    private async ensureDiscoveryDocument(): Promise<boolean> {
        if (this.discoveryDocument) {
            return true;
        }

        const smartConfig = await this.fetchSmartConfiguration();
        if (!smartConfig) {
            return false;
        }

        this.discoveryDocument = {
            authorizationEndpoint: smartConfig.authorization_endpoint,
            tokenEndpoint: smartConfig.token_endpoint,
        };

        return true;
    }

    /**
     * Boot up.
     * Checks if we have valid tokens stashed away.
     */
    async initialize(): Promise<boolean> {
        try {
            const stored = await SecureStore.getItemAsync(TOKEN_KEY);
            if (stored) {
                this.tokens = JSON.parse(stored);

                await this.ensureDiscoveryDocument();

                // Check if token is expired
                if (this.tokens && this.tokens.expiresAt < Date.now()) {
                    console.log('[SMARTAuth] Token expired, attempting refresh...');
                    return this.refreshToken();
                }

                return !!this.tokens;
            }
        } catch (error) {
            console.error('[SMARTAuth] Failed to load tokens:', error);
        }
        return false;
    }

    /**
     * Start the login flow.
     * Pops open the system browser for the user to sign in.
     */
    async login(role: AuthRole = 'patient'): Promise<boolean> {
        if (!isBackendConfigured()) {
            console.error('[SMARTAuth] Backend not configured');
            return false;
        }

        try {
            const hasDiscovery = await this.ensureDiscoveryDocument();
            if (!hasDiscovery) {
                throw new Error('Failed to fetch SMART configuration');
            }

            if (config.ENABLE_DEV_DIRECT_LOGIN && __DEV__) {
                const directSuccess = await this.directDevLogin(role);
                if (directSuccess) {
                    return true;
                }
                console.warn('[SMARTAuth] Dev direct login failed, falling back to browser flow');
            }

            // Build auth request
            const redirectUri = AuthSession.makeRedirectUri({
                scheme: 'zkguardian',
                path: 'auth',
            });

            const request = new AuthSession.AuthRequest({
                clientId: 'zk-guardian-mobile',
                scopes: [
                    'openid',
                    'fhirUser',
                    'offline_access',
                    role === 'patient' ? 'patient/*.read' : 'user/*.read',
                    role === 'patient' ? 'launch/patient' : 'launch',
                ],
                responseType: AuthSession.ResponseType.Code,
                redirectUri,
                usePKCE: true,
                extraParams: {
                    role_hint: role,
                },
            });

            // Prompt user
            const result = await request.promptAsync(this.discoveryDocument);

            if (result.type === 'success' && result.params.code) {
                // Exchange code for tokens
                return this.exchangeCodeForTokens(result.params.code, redirectUri, request.codeVerifier!);
            }

            console.log('[SMARTAuth] Auth flow cancelled or failed:', result.type);
            return false;
        } catch (error) {
            console.error('[SMARTAuth] Login failed:', error);
            return false;
        }
    }

    private async fetchSmartConfiguration(): Promise<any> {
        try {
            // The Gateway should expose a .well-known/smart-configuration endpoint
            const configUrl = `${config.GATEWAY_URL}/.well-known/smart-configuration`;
            console.log(`[SMARTAuth] Fetching config from: ${configUrl}`);

            const response = await secureFetch(configUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} fetching ${configUrl}`);
            }

            const json = await response.json();

            // FIX: If running on Android Emulator, Gateway might return 'localhost'
            // which refers to the emulator itself. We must rewrite to 10.0.2.2.
            if (Platform.OS === 'android') {
                const rewrite = (url: string) => url.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
                json.authorization_endpoint = rewrite(json.authorization_endpoint);
                json.token_endpoint = rewrite(json.token_endpoint);
                json.introspection_endpoint = rewrite(json.introspection_endpoint);
                json.revocation_endpoint = rewrite(json.revocation_endpoint);
                json.jwks_uri = rewrite(json.jwks_uri);
                console.log('[SMARTAuth] Rewrote config URLs for Android Emulator');
            }

            return json;
        } catch (error) {
            console.error('[SMARTAuth] Failed to fetch SMART config:', error);
            return null;
        }
    }

    private async exchangeCodeForTokens(
        code: string,
        redirectUri: string,
        codeVerifier: string
    ): Promise<boolean> {
        try {
            // Use manual fetch instead of AuthSession.exchangeCodeAsync
            // to capture custom SMART-on-FHIR fields (patient, practitioner)
            const tokenUrl = this.discoveryDocument!.tokenEndpoint!;

            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: 'zk-guardian-mobile',
                code_verifier: codeVerifier,
            });

            console.log('[SMARTAuth] Exchanging code for tokens at:', tokenUrl);

            const response = await secureFetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body.toString(),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[SMARTAuth] Token exchange failed:', response.status, errorText);
                return false;
            }

            const tokenResponse = await response.json();
            console.log('[SMARTAuth] Token response received:', {
                hasAccessToken: !!tokenResponse.access_token,
                patient: tokenResponse.patient,
                practitioner: tokenResponse.practitioner,
            });

            return this.storeTokens(tokenResponse as TokenResponse);
        } catch (error) {
            console.error('[SMARTAuth] Token exchange failed:', error);
            return false;
        }
    }

    private async storeTokens(response: TokenResponse): Promise<boolean> {
        try {
            this.tokens = {
                accessToken: response.access_token,
                refreshToken: response.refresh_token,
                expiresAt: Date.now() + (response.expires_in * 1000),
                patientId: response.patient,
                practitionerId: response.practitioner,
            };

            await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(this.tokens));
            console.log('[SMARTAuth] Tokens stored successfully');
            return true;
        } catch (error) {
            console.error('[SMARTAuth] Failed to store tokens:', error);
            return false;
        }
    }

    /**
     * Refreshes the access token using the refresh token.
     */
    async refreshToken(): Promise<boolean> {
        if (!this.tokens?.refreshToken) {
            console.log('[SMARTAuth] No refresh token available');
            return false;
        }

        if (!this.discoveryDocument) {
            const hasDiscovery = await this.ensureDiscoveryDocument();
            if (!hasDiscovery) {
                console.log('[SMARTAuth] Missing SMART discovery for refresh');
                return false;
            }
        }

        try {
            const tokenUrl = this.discoveryDocument!.tokenEndpoint!;
            const body = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: this.tokens.refreshToken,
                client_id: 'zk-guardian-mobile',
            });

            const response = await secureFetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body.toString(),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[SMARTAuth] Refresh token request failed:', response.status, errorText);
                return false;
            }

            const tokenResponse = await response.json();
            return this.storeTokens(tokenResponse as TokenResponse);
        } catch (error) {
            console.error('[SMARTAuth] Token refresh failed:', error);
            // Do NOT auto-logout here. Fails can be network related.
            // Let the caller verify if access token is actually expired.
            return false;
        }
    }

    /**
     * Logs out the user by clearing stored tokens.
     */
    async logout(): Promise<void> {
        try {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            this.tokens = null;
            console.log('[SMARTAuth] Logged out');
        } catch (error) {
            console.error('[SMARTAuth] Logout failed:', error);
        }
    }

    /**
     * Returns the current access token, refreshing if needed.
     */
    async getAccessToken(): Promise<string | null> {
        if (!this.tokens) {
            const restored = await this.initialize();
            if (!restored || !this.tokens) {
                return null;
            }
        }

        // Refresh if expiring in next 5 minutes and refresh token is available
        if (this.tokens.expiresAt < Date.now() + 300000) {
            if (this.tokens.refreshToken) {
                const refreshed = await this.refreshToken();
                if (!refreshed) {
                    // Refresh failed. If strictly expired, we must logout.
                    // If simply 'soon to expire', we return the current token to keep app alive.
                    if (this.tokens.expiresAt <= Date.now()) {
                        console.log('[SMARTAuth] Token expired and refresh failed. Logging out.');
                        await this.logout();
                        return null;
                    }

                    console.warn('[SMARTAuth] Refresh failed but token still valid. Continuing.');
                }
            } else if (this.tokens.expiresAt <= Date.now()) {
                await this.logout();
                return null;
            }
        }

        return this.tokens.accessToken;
    }

    /**
     * Returns the patient ID from the SMART launch context.
     */
    getPatientId(): string | null {
        return this.tokens?.patientId || null;
    }

    /**
     * Returns the practitioner ID (for clinician app mode).
     */
    getPractitionerId(): string | null {
        return this.tokens?.practitionerId || null;
    }

    /**
     * Checks if user is currently authenticated.
     */
    isAuthenticated(): boolean {
        return !!this.tokens && this.tokens.expiresAt > Date.now();
    }
}

// Singleton instance
export const smartAuth = new SMARTAuthService();
