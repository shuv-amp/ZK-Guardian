import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
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
import { signup } from '../../api/authService'; // Import your auth service

const { width } = Dimensions.get('window');

function SignUpScreen() {
  const router = useRouter();
  const [userType, setUserType] = useState<'patient' | 'clinician'>('patient');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Error states
  const [errors, setErrors] = useState({
    firstName: false,
    lastName: false,
    email: false,
    password: false,
    confirmPassword: false,
  });
  
  // Error messages
  const [errorMessages, setErrorMessages] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const validateFields = () => {
    const newErrors = {
      firstName: !firstName.trim(),
      lastName: !lastName.trim(),
      email: !email.trim(),
      password: !password.trim(),
      confirmPassword: !confirmPassword.trim(),
    };
    
    setErrors(newErrors);
    
    // Check if any field is empty
    if (Object.values(newErrors).some(error => error)) {
      Alert.alert('Error', 'Please fill in all fields');
      return false;
    }
    
    // Validate email format (must be @gmail.com)
    if (!email.toLowerCase().endsWith('@gmail.com')) {
      setErrors(prev => ({ ...prev, email: true }));
      setErrorMessages(prev => ({ ...prev, email: 'Must be a Gmail address (@gmail.com)' }));
      return false;
    }
    
    // Validate password length
    if (password.length < 6) {
      setErrors(prev => ({ ...prev, password: true }));
      setErrorMessages(prev => ({ ...prev, password: 'Password must be at least 6 characters' }));
      return false;
    }
    
    return true;
  };

  const handleSignUp = async () => {
    // Check terms agreement
    if (!agreeToTerms) {
      Alert.alert('Error', 'Please agree to the Terms of Service and Privacy Policy');
      return;
    }
    
    // Validate all fields
    if (!validateFields()) {
      return;
    }
    
    // Validate passwords match
    if (password !== confirmPassword) {
      setErrors(prev => ({ ...prev, confirmPassword: true }));
      setErrorMessages(prev => ({ ...prev, confirmPassword: 'Passwords do not match' }));
      return;
    }
    
    // Clear any errors
    setErrors({
      firstName: false,
      lastName: false,
      email: false,
      password: false,
      confirmPassword: false,
    });
    setErrorMessages({
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
    });
    
    // Start loading
    setIsLoading(true);
    
    try {
      console.log('🔄 Starting signup process...');
      
      // Call backend API
      const response = await signup({
        firstName,
        lastName,
        email,
        password,
        userType,
      });

      console.log('✅ Signup successful:', response);

      // Show success message
      Alert.alert(
        'Success! 🎉',
        'Your account has been created successfully.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate based on user type
              if (userType === 'patient') {
                router.replace('/patient/dashboard');
              } else {
                router.replace('/clinician/dashboard');
              }
            },
          },
        ]
      );
    } catch (error: any) {
      console.error('❌ Signup error:', error);
      
      // Handle specific error messages
      if (error.message) {
        if (error.message.includes('already exists') || error.message.includes('already registered')) {
          // Show inline error for email already exists
          setErrors(prev => ({ ...prev, email: true }));
          setErrorMessages(prev => ({ ...prev, email: 'This email is already registered. Please login instead.' }));
          Alert.alert('Email Already Registered', 'An account with this email already exists. Please try logging in instead.');
        } else if (error.message.includes('Gmail')) {
          setErrors(prev => ({ ...prev, email: true }));
          setErrorMessages(prev => ({ ...prev, email: 'Please use a valid Gmail address' }));
        } else if (error.message.includes('network') || error.message.includes('Failed to fetch')) {
          Alert.alert('Network Error', 'Please check your internet connection and try again.');
        } else {
          Alert.alert('Sign Up Failed', error.message);
        }
      } else {
        Alert.alert('Sign Up Failed', 'Unable to create account. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    // Clear error when user starts typing
    setErrors(prev => ({ ...prev, [field]: false }));
    setErrorMessages(prev => ({ ...prev, [field]: '' }));
    
    switch (field) {
      case 'firstName':
        setFirstName(value);
        break;
      case 'lastName':
        setLastName(value);
        break;
      case 'email':
        setEmail(value);
        break;
      case 'password':
        setPassword(value);
        break;
      case 'confirmPassword':
        setConfirmPassword(value);
        break;
    }
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
                Create Your Secure Account
              </Text>
            </View>

            {/* Sign Up Form Card */}
            <View style={styles.formCard}>
              {/* User Type Selection */}
              <Text style={styles.sectionLabel}>I am a:</Text>
              <View style={styles.userTypeContainer}>
                <TouchableOpacity
                  style={[
                    styles.userTypeButton,
                    userType === 'patient' && styles.userTypeButtonActive,
                  ]}
                  onPress={() => setUserType('patient')}
                  activeOpacity={0.7}
                  disabled={isLoading}
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
                  onPress={() => setUserType('clinician')}
                  activeOpacity={0.7}
                  disabled={isLoading}
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

              {/* Name Inputs Row */}
              <View style={styles.nameRow}>
                <View style={[styles.inputContainer, styles.nameInput]}>
                  <Text style={styles.label}>
                    First Name
                    {errors.firstName && <Text style={styles.required}> *</Text>}
                  </Text>
                  <View style={[
                    styles.inputWrapper,
                    errors.firstName && styles.inputWrapperError
                  ]}>
                    <Text style={styles.inputIcon}>👤</Text>
                    <TextInput
                      style={styles.input}
                      value={firstName}
                      onChangeText={(value) => handleFieldChange('firstName', value)}
                      placeholder="John"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={!isLoading}
                    />
                  </View>
                </View>

                <View style={[styles.inputContainer, styles.nameInput]}>
                  <Text style={styles.label}>
                    Last Name
                    {errors.lastName && <Text style={styles.required}> *</Text>}
                  </Text>
                  <View style={[
                    styles.inputWrapper,
                    errors.lastName && styles.inputWrapperError
                  ]}>
                    <Text style={styles.inputIcon}>👤</Text>
                    <TextInput
                      style={styles.input}
                      value={lastName}
                      onChangeText={(value) => handleFieldChange('lastName', value)}
                      placeholder="Doe"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={!isLoading}
                    />
                  </View>
                </View>
              </View>

              {/* Email Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>
                  Email Address
                  {errors.email && <Text style={styles.required}> *</Text>}
                </Text>
                <View style={[
                  styles.inputWrapper,
                  errors.email && styles.inputWrapperError
                ]}>
                  <Text style={styles.inputIcon}>✉️</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(value) => handleFieldChange('email', value)}
                    placeholder="yourname@gmail.com"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    editable={!isLoading}
                  />
                </View>
                {errorMessages.email ? (
                  <Text style={styles.errorText}>{errorMessages.email}</Text>
                ) : (
                  <Text style={styles.helperText}>Must be a Gmail address (@gmail.com)</Text>
                )}
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>
                  Password
                  {errors.password && <Text style={styles.required}> *</Text>}
                </Text>
                <View style={[
                  styles.inputWrapper,
                  errors.password && styles.inputWrapperError
                ]}>
                  <Text style={styles.inputIcon}>🔒</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={(value) => handleFieldChange('password', value)}
                    placeholder="Create a password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password-new"
                    editable={!isLoading}
                  />
                </View>
                {errorMessages.password ? (
                  <Text style={styles.errorText}>{errorMessages.password}</Text>
                ) : (
                  <Text style={styles.helperText}>Minimum 6 characters</Text>
                )}
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>
                  Confirm Password
                  {errors.confirmPassword && <Text style={styles.required}> *</Text>}
                </Text>
                <View style={[
                  styles.inputWrapper,
                  errors.confirmPassword && styles.inputWrapperError
                ]}>
                  <Text style={styles.inputIcon}>🔒</Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={(value) => handleFieldChange('confirmPassword', value)}
                    placeholder="Re-enter your password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password-new"
                    editable={!isLoading}
                  />
                </View>
                {errorMessages.confirmPassword && (
                  <Text style={styles.errorText}>{errorMessages.confirmPassword}</Text>
                )}
              </View>

              {/* Terms Checkbox */}
              <TouchableOpacity
                style={styles.termsContainer}
                onPress={() => setAgreeToTerms(!agreeToTerms)}
                activeOpacity={0.7}
                disabled={isLoading}
              >
                <View
                  style={[
                    styles.checkbox,
                    agreeToTerms && styles.checkboxChecked,
                  ]}
                >
                  {agreeToTerms && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.termsText}>
                  I agree to the{' '}
                  <Text style={styles.termsLink}>Terms of Service</Text>
                  {' '}and{' '}
                  <Text style={styles.termsLink}>Privacy Policy</Text>
                </Text>
              </TouchableOpacity>

              {/* Sign Up Button */}
              <TouchableOpacity
                style={[
                  styles.signUpButton,
                  (!agreeToTerms || isLoading) && styles.signUpButtonDisabled
                ]}
                onPress={handleSignUp}
                activeOpacity={0.8}
                disabled={!agreeToTerms || isLoading}
              >
                {isLoading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={styles.signUpButtonText}>  Creating Account...</Text>
                  </View>
                ) : (
                  <Text style={[
                    styles.signUpButtonText,
                    !agreeToTerms && styles.signUpButtonTextDisabled
                  ]}>
                    Create {userType === 'patient' ? 'Patient' : 'Clinician'} Account
                  </Text>
                )}
              </TouchableOpacity>

              {/* Sign In Link */}
              <View style={styles.signInContainer}>
                <Text style={styles.signInText}>Already have an account? </Text>
                <TouchableOpacity activeOpacity={0.7} disabled={isLoading}>
                  <Text style={styles.signInLink}>
                    <Link href="/">Sign in</Link>
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footerContainer}>
              <View style={styles.securityBadges}>
                <Text style={styles.badge}>🔐 Blockchain-Secured</Text>
                <Text style={styles.badge}>• Zero-Knowledge-Proofs</Text>
                <Text style={styles.badge}>• HIPAA Compliant</Text>
              </View>
            </View>
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 12,
    textAlign: 'center',
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
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  nameInput: {
    flex: 1,
    marginHorizontal: 4,
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
  required: {
    color: '#DC2626',
    fontWeight: 'bold',
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
    borderColor: '#DC2626',
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
  helperText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    marginLeft: 4,
  },
  errorText: {
    fontSize: 11,
    color: '#DC2626',
    marginTop: 4,
    marginLeft: 4,
    fontWeight: '500',
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
    marginTop: 4,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 4,
    marginRight: 10,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
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
  termsText: {
    fontSize: 13,
    color: '#374151',
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    color: '#2563EB',
    fontWeight: '500',
  },
  signUpButton: {
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
  signUpButtonDisabled: {
    backgroundColor: '#9CA3AF',
    ...Platform.select({
      ios: {
        shadowColor: '#9CA3AF',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signUpButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  signUpButtonTextDisabled: {
    color: '#E5E7EB',
  },
  signInContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  signInText: {
    fontSize: 13,
    color: '#6B7280',
  },
  signInLink: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600',
  },
  footerContainer: {
    marginTop: 24,
    marginBottom: 16,
  },
  securityBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    fontSize: 11,
    color: '#6B7280',
    marginHorizontal: 4,
    textAlign: 'center',
  },
});

export default SignUpScreen;