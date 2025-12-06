import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  SafeAreaView,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

function App() {
  const [userType, setUserType] = useState<'patient' | 'clinician'>('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const handleLogin = () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    console.log('Login attempt:', { userType, email, rememberMe });
    Alert.alert(
      'Login Successful',
      `Logging in as ${userType === 'patient' ? 'Patient' : 'Clinician'}\nEmail: ${email}`,
      [{ text: 'OK' }]
    );
  };

  const handleForgotPassword = () => {
    Alert.alert('Forgot Password', 'Password reset link will be sent to your email');
  };

  const handleSignUp = () => {
    Alert.alert('Sign Up', 'Registration page will open');
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
              <Text style={styles.headerTitle}>HealthConnect</Text>
              <Text style={styles.headerSubtitle}>
                Secure Medical Data Management
              </Text>
            </View>

            {/* Login Form Card */}
            <View style={styles.formCard}>
              {/* User Type Selection */}
              <View style={styles.userTypeContainer}>
                <TouchableOpacity
                  style={[
                    styles.userTypeButton,
                    userType === 'patient' && styles.userTypeButtonActive,
                  ]}
                  onPress={() => setUserType('patient')}
                  activeOpacity={0.7}
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
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputIcon}>✉️</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Enter your email"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                  />
                </View>
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputIcon}>🔒</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter your password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                  />
                </View>
              </View>

              {/* Remember Me & Forgot Password */}
              <View style={styles.optionsContainer}>
                <TouchableOpacity
                  style={styles.rememberMeContainer}
                  onPress={() => setRememberMe(!rememberMe)}
                  activeOpacity={0.7}
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
                >
                  <Text style={styles.forgotPasswordText}>
                    Forgot password?
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Login Button */}
              <TouchableOpacity
                style={styles.loginButton}
                onPress={handleLogin}
                activeOpacity={0.8}
              >
                <Text style={styles.loginButtonText}>
                  Login as {userType === 'patient' ? 'Patient' : 'Clinician'}
                </Text>
              </TouchableOpacity>

              {/* Sign Up Link */}
              <View style={styles.signUpContainer}>
                <Text style={styles.signUpText}>Don't have an account? </Text>
                <TouchableOpacity 
                  onPress={handleSignUp}
                  activeOpacity={0.7}
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

export default App;