// api/config.ts
import Constants from 'expo-constants';

// Get your computer's IP address automatically (when using Expo)
const getApiUrl = () => {
  // In development, use your local IP
  if (__DEV__) {
    // REPLACE THIS with your actual IP address from ipconfig
    return 'http://192.168.1.67:3000/api';
    
    // Alternative: Use Expo's manifest to get IP automatically
    // Uncomment below if your backend is on the same machine as Expo CLI
    // const { manifest } = Constants;
    // const api = manifest?.debuggerHost?.split(':').shift();
    // return `http://${api}:3000/api`;
  }
  
  // In production, use your production URL
  return 'https://your-production-api.com/api';
};

export const API_BASE_URL = getApiUrl();

export const API_ENDPOINTS = {
  AUTH: {
    SIGNUP: `${API_BASE_URL}/auth/signup`,
    LOGIN: `${API_BASE_URL}/auth/login`,
    ME: `${API_BASE_URL}/auth/me`,
  },
  HEALTH: `${API_BASE_URL.replace('/api', '')}/health`, // Health endpoint is usually at root
};