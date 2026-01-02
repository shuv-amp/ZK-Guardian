// login.tsx - With inline error display
import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Dimensions,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { login } from '../api/authService';

const { width } = Dimensions.get('window');

function LoginScreen() {
  const router = useRouter();
  const [userType, setUserType] = useState<'patient' | 'clinician'>('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Error states
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const clearErrors = () => {
    setEmailError('');
    setPasswordError('');
    setGeneralError('');
  };

  const handleLogin = async () => {
    clearErrors();

    // Validation
    if (!email || !password) {
      setGeneralError('Please fill in all fields');
      return;
    }

    if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setLoading(true);

    try {
      const result = await login({
        email: email.toLowerCase(),
        password: password,
        userType: userType,
      });

      console.log('✅ Login successful:', result);

      // Navigate based on user type
      if (result.user.userType === 'patient') {
        router.replace('/patient/dashboard');
      } else {
        router.replace('/clinician/dashboard');
      }
    } catch (error: any) {
      console.error('❌ Login error:', error);
      
      const errorMessage = error.message || 'Unable to login. Please try again.';
      
      // Check if it's a password error
      if (errorMessage.toLowerCase().includes('password')) {
        setPasswordError(errorMessage);
      } 
      // Check if it's an email error
      else if (errorMessage.toLowerCase().includes('email') || errorMessage.toLowerCase().includes('account')) {
        setEmailError(errorMessage);
      } 
      // Otherwise show as general error
      else {
        setGeneralError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    clearErrors();
    
    switch (field) {
      case 'email':
        setEmail(value);
        break;
      case 'password':
        setPassword(value);
        break;
    }
  };

  const handleForgotPassword = () => {
    router.push('/auth/forgetpassword');
  };

  const handleSignUp = () => {
    router.push('/auth/signup');
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar 
          barStyle="light-content" 
          backgroundColor="#5B68DF"
          translucent={false}
        />
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            {/* Header Card */}
            <View style={styles.headerCard}>
              <View style={styles.iconContainer}>
                <Text style={styles.iconText}>🩺</Text>
              </View>
              <Text style={styles.headerTitle}>ZK Guardian</Text>
              <Text style={styles.headerSubtitle}>
                Secure Medical Data Management
              </Text>
            </View>

            {/* Login Form Card */}
            <View style={styles.formCard}>
              {/* General Error Message */}
              {generalError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerIcon}>⚠️</Text>
                  <Text style={styles.errorBannerText}>{generalError}</Text>
                </View>
              ) : null}

              {/* User Type Selection */}
              <View style={styles.userTypeContainer}>
                <TouchableOpacity
                  style={[
                    styles.userTypeButton,
                    userType === 'patient' && styles.userTypeButtonActive,
                  ]}
                  onPress={() => {
                    setUserType('patient');
                    clearErrors();
                  }}
                  activeOpacity={0.7}
                  disabled={loading}
                >
                  <Text style={styles.userTypeIcon}>👤</Text>
                  <Text
                    style={[
                      styles.userTypeText,
                      userType === 'patient' && styles.userTypeTextActive,
                    ]}
                  >
                    Patient
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.userTypeButton,
                    userType === 'clinician' && styles.userTypeButtonActive,
                  ]}
                  onPress={() => {
                    setUserType('clinician');
                    clearErrors();
                  }}
                  activeOpacity={0.7}
                  disabled={loading}
                >
                  <Text style={styles.userTypeIcon}>🩺</Text>
                  <Text
                    style={[
                      styles.userTypeText,
                      userType === 'clinician' && styles.userTypeTextActive,
                    ]}
                  >
                    Clinician
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Email Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Email</Text>
                <View style={[
                  styles.inputWrapper,
                  emailError ? styles.inputWrapperError : null
                ]}>
                  <Text style={styles.inputIcon}>✉️</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(value) => handleFieldChange('email', value)}
                    placeholder="your.email@example.com"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    editable={!loading}
                  />
                </View>
                {emailError ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorIcon}>❌</Text>
                    <Text style={styles.errorText}>{emailError}</Text>
                  </View>
                ) : null}
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Password</Text>
                <View style={[
                  styles.inputWrapper,
                  passwordError ? styles.inputWrapperError : null
                ]}>
                  <Text style={styles.inputIcon}>🔒</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={(value) => handleFieldChange('password', value)}
                    placeholder="Enter your password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    editable={!loading}
                  />
                </View>
                {passwordError ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorIcon}>❌</Text>
                    <Text style={styles.errorText}>{passwordError}</Text>
                  </View>
                ) : null}
              </View>

              {/* Remember Me & Forgot Password */}
              <View style={styles.optionsContainer}>
                <TouchableOpacity
                  style={styles.rememberMeContainer}
                  onPress={() => setRememberMe(!rememberMe)}
                  activeOpacity={0.7}
                  disabled={loading}
                >
                  <View
                    style={[
                      styles.checkbox,
                      rememberMe && styles.checkboxChecked,
                    ]}
                  >
                    {rememberMe && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={styles.rememberMeText}>Remember me</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={handleForgotPassword}
                  activeOpacity={0.7}
                  disabled={loading}
                >
                  <Text style={styles.forgotPasswordText}>
                    Forgot password?
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Login Button */}
              <TouchableOpacity
                style={[styles.loginButton, loading && styles.loginButtonDisabled]}
                onPress={handleLogin}
                activeOpacity={0.8}
                disabled={loading}
              >
                {loading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={styles.loginButtonText}>  Logging in...</Text>
                  </View>
                ) : (
                  <Text style={styles.loginButtonText}>
                    Login as {userType === 'patient' ? 'Patient' : 'Clinician'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Sign Up Link */}
              <View style={styles.signUpContainer}>
                <Text style={styles.signUpText}>Don't have an account? </Text>
                <TouchableOpacity 
                  onPress={handleSignUp}
                  activeOpacity={0.7}
                  disabled={loading}
                >
                  <Text style={styles.signUpLink}>Sign up</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Footer */}
            <Text style={styles.footer}>
              Secure • Private • HIPAA Compliant
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#EEF2FF',
  },
  scrollContainer: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  container: {
    flex: 1,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: width * 0.05,
    paddingTop: 30,
  },
  headerCard: {
    backgroundColor: '#5B68DF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 40,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  iconContainer: {
    width: 80,
    height: 80,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#DBEAFE',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 32,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  errorBannerIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#991B1B',
    fontWeight: '500',
  },
  userTypeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  userTypeButton: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 6,
  },
  userTypeButtonActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  userTypeIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  userTypeText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  userTypeTextActive: {
    color: '#2563EB',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FAFAFA',
    height: 52,
  },
  inputWrapperError: {
    borderColor: '#EF4444',
    borderWidth: 2,
    backgroundColor: '#FEF2F2',
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
    paddingVertical: 0,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginLeft: 4,
  },
  errorIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '500',
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 4,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 4,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  rememberMeText: {
    fontSize: 13,
    color: '#374151',
  },
  forgotPasswordText: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '500',
  },
  loginButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    ...Platform.select({
      ios: {
        shadowColor: '#2563EB',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  loginButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  signUpText: {
    fontSize: 13,
    color: '#6B7280',
  },
  signUpLink: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600',
  },
  footer: {
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 16,
    fontSize: 11,
    color: '#6B7280',
  },
});

export default LoginScreen;