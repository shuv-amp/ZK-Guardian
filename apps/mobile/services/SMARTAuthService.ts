import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { config, isBackendConfigured } from '../config/env';

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

/**
 * SMARTAuthService
 * 
 * Handles SMART on FHIR OAuth2 authentication flow.
 * Stores tokens securely and provides refresh capability.
 */
export class SMARTAuthService {
    private discoveryDocument: AuthSession.DiscoveryDocument | null = null;
    private tokens: StoredTokens | null = null;

    /**
     * Initializes the service by loading cached tokens.
     * Call this at app startup.
     */
    async initialize(): Promise<boolean> {
        try {
            const stored = await SecureStore.getItemAsync(TOKEN_KEY);
            if (stored) {
                this.tokens = JSON.parse(stored);

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
     * Starts the SMART on FHIR OAuth2 login flow.
     * Opens a browser for user authentication.
     */
    async login(): Promise<boolean> {
        if (!isBackendConfigured()) {
            console.error('[SMARTAuth] Backend not configured');
            return false;
        }

        try {
            // Fetch SMART configuration from Gateway
            const smartConfig = await this.fetchSmartConfiguration();
            if (!smartConfig) {
                throw new Error('Failed to fetch SMART configuration');
            }

            this.discoveryDocument = {
                authorizationEndpoint: smartConfig.authorization_endpoint,
                tokenEndpoint: smartConfig.token_endpoint,
            };

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
                    'patient/*.read',
                    'launch/patient',
                ],
                responseType: AuthSession.ResponseType.Code,
                redirectUri,
                usePKCE: true,
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

            const response = await fetch(configUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} fetching ${configUrl}`);
            }
            return response.json();
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

            const response = await fetch(tokenUrl, {
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
        if (!this.tokens?.refreshToken || !this.discoveryDocument) {
            console.log('[SMARTAuth] No refresh token available');
            return false;
        }

        try {
            const response = await AuthSession.refreshAsync(
                {
                    clientId: 'zk-guardian-mobile',
                    refreshToken: this.tokens.refreshToken,
                },
                this.discoveryDocument
            );

            return this.storeTokens(response as unknown as TokenResponse);
        } catch (error) {
            console.error('[SMARTAuth] Token refresh failed:', error);
            await this.logout();
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
            return null;
        }

        // Refresh if expiring in next 5 minutes
        if (this.tokens.expiresAt < Date.now() + 300000) {
            const refreshed = await this.refreshToken();
            if (!refreshed) {
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
