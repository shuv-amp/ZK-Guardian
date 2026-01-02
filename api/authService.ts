// api/authService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_ENDPOINTS } from './config';

interface SignupData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  userType: 'patient' | 'clinician';
}

interface LoginData {
  email: string;
  password: string;
  userType: 'patient' | 'clinician';
}

interface AuthResponse {
  success: boolean;
  token: string;
  user: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    userType: string;
  };
  message?: string;
}

// User type export
export interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: 'patient' | 'clinician';
  userType?: string;
  patientId?: string;
  clinicianId?: string;
}

// Authenticated fetch wrapper
export const authenticatedFetch = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  try {
    const token = await AsyncStorage.getItem('token');

    if (!token) {
      throw new Error('No authentication token found');
    }

    // Get base URL from config
    const BASE_URL = 'http://192.168.1.67:3000';
    
    // Construct full URL if endpoint is relative
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${BASE_URL}${endpoint}`;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // If unauthorized, clear storage and redirect to login
    if (response.status === 401) {
      await logout();
      throw new Error('Session expired. Please login again.');
    }

    return response;
  } catch (error: any) {
    console.error('❌ Authenticated fetch error:', error);
    throw error;
  }
};

// Signup
export const signup = async (data: SignupData): Promise<AuthResponse> => {
  try {
    console.log('📤 Signup request to:', API_ENDPOINTS.AUTH.SIGNUP);
    
    const response = await fetch(API_ENDPOINTS.AUTH.SIGNUP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    console.log('📥 Signup response:', result);

    if (!response.ok) {
      throw new Error(result.error || 'Signup failed');
    }

    // Store token in AsyncStorage
    if (result.token) {
      await AsyncStorage.setItem('token', result.token);
      await AsyncStorage.setItem('user', JSON.stringify(result.user));
    }

    return result;
  } catch (error: any) {
    console.error('❌ Signup error:', error);
    throw error;
  }
};

// Login
export const login = async (data: LoginData): Promise<AuthResponse> => {
  try {
    console.log('📤 Login request to:', API_ENDPOINTS.AUTH.LOGIN);
    
    const response = await fetch(API_ENDPOINTS.AUTH.LOGIN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    console.log('📥 Login response:', result);

    if (!response.ok) {
      throw new Error(result.error || 'Login failed');
    }

    // Store token in AsyncStorage
    if (result.token) {
      await AsyncStorage.setItem('token', result.token);
      await AsyncStorage.setItem('user', JSON.stringify(result.user));
    }

    return result;
  } catch (error: any) {
    console.error('❌ Login error:', error);
    throw error;
  }
};

// Get current user from backend
export const getCurrentUser = async (): Promise<User> => {
  try {
    const token = await AsyncStorage.getItem('token');

    if (!token) {
      throw new Error('No token found');
    }

    const response = await fetch(API_ENDPOINTS.AUTH.ME, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to get user');
    }

    // Update AsyncStorage with fresh user data
    if (result.user) {
      await AsyncStorage.setItem('user', JSON.stringify(result.user));
    }

    // Return just the user object
    return result.user;
  } catch (error: any) {
    console.error('❌ Get user error:', error);
    throw error;
  }
};

// Logout
export const logout = async () => {
  await AsyncStorage.removeItem('token');
  await AsyncStorage.removeItem('user');
};

// Check authentication
export const isAuthenticated = async (): Promise<boolean> => {
  const token = await AsyncStorage.getItem('token');
  return !!token;
};

// Get token
export const getToken = async (): Promise<string | null> => {
  return await AsyncStorage.getItem('token');
};

// Get stored user from AsyncStorage (fast, no network call)
export const getStoredUser = async (): Promise<User | null> => {
  try {
    const userStr = await AsyncStorage.getItem('user');
    if (!userStr) return null;
    
    const user = JSON.parse(userStr);
    
    // Normalize the role property (handle both 'role' and 'userType')
    return {
      ...user,
      role: user.role || user.userType,
    };
  } catch (error) {
    console.error('Error getting stored user:', error);
    return null;
  }
};

// Test connection
export const testConnection = async () => {
  try {
    console.log('🔍 Testing connection to:', API_ENDPOINTS.HEALTH);
    const response = await fetch(API_ENDPOINTS.HEALTH);
    const result = await response.json();
    console.log('✅ Backend connection successful:', result);
    return result;
  } catch (error) {
    console.error('❌ Backend connection failed:', error);
    throw error;
  }
};

// Export as default for backward compatibility
export default {
  signup,
  login,
  getCurrentUser,
  getStoredUser,
  logout,
  isAuthenticated,
  getToken,
  testConnection,
  authenticatedFetch,
};