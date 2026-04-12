import { smartAuth } from './SMARTAuthService';
import { secureFetch } from '../utils/secureFetch';

/**
 * Custom error class for API issues
 */
export class APIError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'APIError';
    }
}

/**
 * Standard API fetching with auto-auth injection and refresh logic.
 * Handles 401 retries automatically.
 */
export async function authorizedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    // 1. Get current token (auto-refreshes if close to expiring)
    let token = await smartAuth.getAccessToken();

    if (!token) {
        // Try one last ditch restore just in case
        const restored = await smartAuth.initialize();
        if (restored) {
             token = await smartAuth.getAccessToken();
        }
    }

    if (!token) {
        throw new APIError(401, 'No session active');
    }

    // Prepare headers
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    
    // Ensure we send JSON by default if body is present and no type set
    if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    // 2. Initial attempt
    let response = await secureFetch(url, {
        ...options,
        headers,
    });

    // 3. Handle 401 - Try explicit refresh once
    if (response.status === 401) {
        console.warn('[API] 401 received, attempting explicit refresh...');
        
        // Force a refresh even if the service thinks we are valid
        const refreshed = await smartAuth.refreshToken();
        
        if (refreshed) {
            const newToken = await smartAuth.getAccessToken();
            if (newToken) {
                console.log('[API] Token refreshed, retrying request...');
                headers.set('Authorization', `Bearer ${newToken}`);
                response = await secureFetch(url, {
                    ...options,
                    headers,
                });
            }
        } else {
            console.error('[API] Refresh failed after 401. Session is dead.');
            throw new APIError(401, 'Session expired');
        }
    }

    if (response.status === 401) {
        throw new APIError(401, 'Session expired');
    }

    return response;
}
