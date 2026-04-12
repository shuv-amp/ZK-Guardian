import { Platform } from 'react-native';

/**
 * Platform-aware secure storage abstraction
 * 
 * Uses expo-secure-store on native (iOS/Android)
 * Falls back to localStorage on web (for development only)
 */

let SecureStoreNative: any = null;

// Dynamically import SecureStore only on native platforms
if (Platform.OS !== 'web') {
    try {
        SecureStoreNative = require('expo-secure-store');
    } catch {
        console.warn('[SecureStorage] expo-secure-store not available');
    }
}

/**
 * Get item from secure storage
 */
export async function getItemAsync(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
        if (!__DEV__) {
            console.error('[SecureStorage] Web storage is disabled outside development');
            return null;
        }
        // Web fallback - localStorage (NOT secure, development only)
        try {
            return localStorage.getItem(key);
        } catch {
            console.warn('[SecureStorage] localStorage not available');
            return null;
        }
    }

    // Native - use expo-secure-store
    if (SecureStoreNative) {
        return SecureStoreNative.getItemAsync(key);
    }
    return null;
}

/**
 * Set item in secure storage
 */
export async function setItemAsync(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
        if (!__DEV__) {
            throw new Error('Web storage is disabled outside development');
        }
        // Web fallback - localStorage (NOT secure, development only)
        try {
            localStorage.setItem(key, value);
        } catch {
            console.warn('[SecureStorage] localStorage not available');
        }
        return;
    }

    // Native - use expo-secure-store
    if (SecureStoreNative) {
        await SecureStoreNative.setItemAsync(key, value);
    }
}

/**
 * Delete item from secure storage
 */
export async function deleteItemAsync(key: string): Promise<void> {
    if (Platform.OS === 'web') {
        if (!__DEV__) {
            return;
        }
        // Web fallback
        try {
            localStorage.removeItem(key);
        } catch {
            console.warn('[SecureStorage] localStorage not available');
        }
        return;
    }

    // Native - use expo-secure-store
    if (SecureStoreNative) {
        await SecureStoreNative.deleteItemAsync(key);
    }
}

// Export as default object for drop-in replacement
export default {
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
};
