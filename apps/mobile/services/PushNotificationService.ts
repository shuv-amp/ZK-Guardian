import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { secureFetch } from '../utils/secureFetch';

export interface PushNotificationConfig {
    experienceId?: string;
}

export class PushNotificationService {
    private static STORAGE_KEY = 'push_token';

    /**
     * Configure notification behavior
     */
    static async configure() {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            }),
        });
    }

    /**
     * Register for push notifications and return the token
     */
    static async registerForPushNotificationsAsync(): Promise<string | undefined> {
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
            });
        }

        if (!Device.isDevice) {
            console.log('Must use physical device for Push Notifications');
            return undefined;
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }

        if (finalStatus !== 'granted') {
            console.log('Failed to get push token for push notification!');
            return undefined;
        }

        try {
            const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;

            const tokenData = await Notifications.getExpoPushTokenAsync({
                projectId,
            });

            const token = tokenData.data;
            console.log('Push token:', token);

            // Cache token
            await SecureStore.setItemAsync(this.STORAGE_KEY, token);

            return token;
        } catch (error) {
            console.error('Error fetching push token:', error);
            return undefined;
        }
    }

    /**
     * Get cached token
     */
    static async getStoredToken(): Promise<string | null> {
        return await SecureStore.getItemAsync(this.STORAGE_KEY);
    }

    /**
     * Add listener for received notifications (foreground)
     */
    static addNotificationReceivedListener(callback: (notification: Notifications.Notification) => void) {
        return Notifications.addNotificationReceivedListener(callback);
    }

    /**
     * Add listener for notification responses (user tapped notification)
     */
    static addNotificationResponseReceivedListener(callback: (response: Notifications.NotificationResponse) => void) {
        return Notifications.addNotificationResponseReceivedListener(callback);
    }

    /**
     * Sync push token with backend
     */
    static async syncTokenWithBackend(accessToken: string, gatewayUrl: string): Promise<void> {
        try {
            const token = await this.getStoredToken();
            if (!token) return;

            const response = await secureFetch(`${gatewayUrl}/api/patient/notifications/device-token`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token,
                    platform: Platform.OS === 'ios' ? 'ios' : 'android'
                })
            });

            if (!response.ok) {
                console.warn('Failed to sync push token with backend');
            }
        } catch (error) {
            console.error('Error syncing push token:', error);
        }
    }
}
