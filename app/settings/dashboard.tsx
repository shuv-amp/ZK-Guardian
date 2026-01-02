// app/settings/dashboard.tsx
import { router } from 'expo-router';
import React, { useState, useEffect } from 'react';
import {
    SafeAreaView,
    ScrollView,
    StatusBar,
    Switch,
    Text,
    TouchableOpacity,
    View,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { styles } from './styles';
import { 
  getStoredUser, 
  logout, 
  authenticatedFetch,
  User 
} from '../../api/authService';

interface UserSettings {
  notificationsEnabled: boolean;
  biometricsEnabled: boolean;
  autoBackup: boolean;
}

function SettingsScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({
    notificationsEnabled: true,
    biometricsEnabled: false,
    autoBackup: true,
  });

  useEffect(() => {
    loadUserAndSettings();
  }, []);

  const loadUserAndSettings = async () => {
    try {
      setLoading(true);
      
      // Load user data
      const userData = await getStoredUser();
      setUser(userData);

      // Load user settings from backend
      try {
        const response = await authenticatedFetch('/user/settings');
        if (response.ok) {
          const data = await response.json();
          if (data.settings) {
            setSettings(data.settings);
          }
        }
      } catch (error) {
        console.log('Using default settings');
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      Alert.alert('Error', 'Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: keyof UserSettings, value: boolean) => {
    // Optimistically update UI
    setSettings(prev => ({ ...prev, [key]: value }));

    try {
      setSaving(true);
      const response = await authenticatedFetch('/user/settings', {
        method: 'PUT',
        body: JSON.stringify({ [key]: value }),
      });

      if (!response.ok) {
        // Revert on failure
        setSettings(prev => ({ ...prev, [key]: !value }));
        Alert.alert('Error', 'Failed to update setting');
      }
    } catch (error) {
      console.error('Error updating setting:', error);
      // Revert on error
      setSettings(prev => ({ ...prev, [key]: !value }));
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
              router.replace('/');
            } catch (error) {
              console.error('Logout error:', error);
              Alert.alert('Error', 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This action is permanent and cannot be undone. All your data will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await authenticatedFetch('/user/account', {
                method: 'DELETE',
              });

              if (response.ok) {
                await logout();
                router.replace('/');
              } else {
                Alert.alert('Error', 'Failed to delete account');
              }
            } catch (error) {
              console.error('Delete account error:', error);
              Alert.alert('Error', 'Network error. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleExportData = async () => {
    try {
      setSaving(true);
      const response = await authenticatedFetch('/user/export-data');
      
      if (response.ok) {
        const data = await response.json();
        Alert.alert(
          'Export Complete',
          'Your data has been prepared. Check your email for the download link.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', 'Failed to export data');
      }
    } catch (error) {
      console.error('Export data error:', error);
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getBackRoute = () => {
    if (user?.role === 'clinician') {
      return '/clinician/dashboard';
    } else if (user?.role === 'patient') {
      return '/patient/dashboard';
    }
    return '/';
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text style={{ marginTop: 12, color: '#6B7280' }}>Loading settings...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#7C3AED" />
        
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.replace(getBackRoute())}
          >
            <Feather name="arrow-left" size={20} color="#fff" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Settings</Text>
            {user && (
              <Text style={styles.headerSubtitle}>
                {user.firstName} {user.lastName}
              </Text>
            )}
          </View>
          <View style={styles.placeholder} />
        </View>

        {/* Content */}
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Profile Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile</Text>
            
            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/account-info')}
            >
              <View style={styles.settingLeft}>
                <Feather name="user" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Account Information</Text>
                  <Text style={styles.settingDescription}>
                    {user?.email || 'View and edit your profile'}
                  </Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/change-password')}
            >
              <View style={styles.settingLeft}>
                <Feather name="lock" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Change Password</Text>
                  <Text style={styles.settingDescription}>Update your password</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* Privacy & Security */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Privacy & Security</Text>
            
            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Feather name="bell" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Notifications</Text>
                  <Text style={styles.settingDescription}>Push notifications</Text>
                </View>
              </View>
              <Switch
                value={settings.notificationsEnabled}
                onValueChange={(value) => updateSetting('notificationsEnabled', value)}
                trackColor={{ false: '#D1D5DB', true: '#A78BFA' }}
                thumbColor={settings.notificationsEnabled ? '#7C3AED' : '#F3F4F6'}
                disabled={saving}
              />
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Feather name="smartphone" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Biometric Login</Text>
                  <Text style={styles.settingDescription}>Use fingerprint or face ID</Text>
                </View>
              </View>
              <Switch
                value={settings.biometricsEnabled}
                onValueChange={(value) => updateSetting('biometricsEnabled', value)}
                trackColor={{ false: '#D1D5DB', true: '#A78BFA' }}
                thumbColor={settings.biometricsEnabled ? '#7C3AED' : '#F3F4F6'}
                disabled={saving}
              />
            </View>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/privacy')}
            >
              <View style={styles.settingLeft}>
                <Feather name="shield" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Privacy Settings</Text>
                  <Text style={styles.settingDescription}>Manage data sharing</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* Data Management */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Data Management</Text>
            
            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Feather name="database" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Auto Backup</Text>
                  <Text style={styles.settingDescription}>Backup data automatically</Text>
                </View>
              </View>
              <Switch
                value={settings.autoBackup}
                onValueChange={(value) => updateSetting('autoBackup', value)}
                trackColor={{ false: '#D1D5DB', true: '#A78BFA' }}
                thumbColor={settings.autoBackup ? '#7C3AED' : '#F3F4F6'}
                disabled={saving}
              />
            </View>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={handleExportData}
              disabled={saving}
            >
              <View style={styles.settingLeft}>
                <Feather name="download" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Export Data</Text>
                  <Text style={styles.settingDescription}>Download your health records</Text>
                </View>
              </View>
              {saving ? (
                <ActivityIndicator size="small" color="#7C3AED" />
              ) : (
                <Feather name="chevron-right" size={20} color="#9CA3AF" />
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={handleDeleteAccount}
            >
              <View style={styles.settingLeft}>
                <Feather name="trash-2" size={20} color="#DC2626" style={styles.settingIcon} />
                <View>
                  <Text style={[styles.settingLabel, { color: '#DC2626' }]}>Delete Account</Text>
                  <Text style={styles.settingDescription}>Permanently remove data</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* Blockchain */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Blockchain</Text>
            
            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/wallet')}
            >
              <View style={styles.settingLeft}>
                <Feather name="link" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Wallet Connection</Text>
                  <Text style={styles.settingDescription}>Manage blockchain wallet</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/transactions')}
            >
              <View style={styles.settingLeft}>
                <Feather name="file-text" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Transaction History</Text>
                  <Text style={styles.settingDescription}>View blockchain transactions</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* Support */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Support</Text>
            
            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/help')}
            >
              <View style={styles.settingLeft}>
                <Feather name="help-circle" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Help Center</Text>
                  <Text style={styles.settingDescription}>FAQs and guides</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/contact')}
            >
              <View style={styles.settingLeft}>
                <Feather name="mail" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Contact Support</Text>
                  <Text style={styles.settingDescription}>Get help from our team</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => router.push('/settings/terms')}
            >
              <View style={styles.settingLeft}>
                <Feather name="file" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>Terms & Conditions</Text>
                  <Text style={styles.settingDescription}>Legal information</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* About */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            
            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Feather name="info" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>App Version</Text>
                  <Text style={styles.settingDescription}>v1.0.0</Text>
                </View>
              </View>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Feather name="at-sign" size={20} color="#7C3AED" style={styles.settingIcon} />
                <View>
                  <Text style={styles.settingLabel}>User ID</Text>
                  <Text style={styles.settingDescription}>
                    {user?.role === 'patient' 
                      ? user?.patientId || `PAT-${user?.id}` 
                      : user?.clinicianId || `DOC-${user?.id}`}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Logout Button */}
          <TouchableOpacity 
            style={styles.logoutButton}
            onPress={handleLogout}
          >
            <Feather name="log-out" size={18} color="#DC2626" style={{ marginRight: 8 }} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default SettingsScreen;