// components/ClinicianHeader.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getStoredUser } from '../api/authService';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ClinicianHeaderProps {
  showSearch?: boolean;
  onSearchChange?: (text: string) => void;
  searchPlaceholder?: string;
}

type Clinician = {
  id: number;
  firstName: string;
  lastName: string;
  specialty?: string;
  clinicianId?: string;
  role?: string;
};

const ClinicianHeader: React.FC<ClinicianHeaderProps> = ({
  showSearch = true,
  onSearchChange,
  searchPlaceholder = 'Search patients by name or MRN...',
}) => {
  const [clinician, setClinician] = useState<Clinician | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadClinicianData();
  }, []);

  const loadClinicianData = async () => {
    try {
      const userData = await getStoredUser();
      if (userData) {
        setClinician(userData as Clinician);
      }
    } catch (error) {
      console.error('Error loading clinician data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
      router.replace('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (onSearchChange) {
      onSearchChange(text);
    }
  };

  const getClinicianId = () => {
    if (clinician?.clinicianId) return clinician.clinicianId;
    if (clinician?.id) return `DOC-${clinician.id.toString().padStart(3, '0')}`;
    return "DOC-000";
  };

  const getInitials = () => {
    if (!clinician) return "DR";
    const firstInitial = clinician.firstName?.charAt(0) || '';
    const lastInitial = clinician.lastName?.charAt(0) || '';
    return `${firstInitial}${lastInitial}`.toUpperCase();
  };

  return (
    <>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#4a15e9ff', '#6648ebff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.avatarText}>{getInitials()}</Text>
              )}
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.headerSubtitle}>Clinician Portal</Text>
              
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              ) : (
                <>
                  <Text style={styles.headerTitle}>
                    {clinician 
                      ? `Dr. ${clinician.firstName} ${clinician.lastName}`
                      : 'Doctor'}
                  </Text>
                  <Text style={styles.headerInfo}>
                    {clinician?.specialty || 'Physician'} • ID: {getClinicianId()}
                  </Text>
                </>
              )}
            </View>
          </View>
          
          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.iconButton}>
              <Feather name="bell" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.iconButton}
              onPress={() => router.push('/settings/dashboard')}
            >
              <Feather name="settings" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.iconButton} 
              onPress={handleLogout}
            >
              <Feather name="log-out" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {showSearch && (
          <View style={styles.searchContainer}>
            <Feather 
              name="search" 
              size={16} 
              color="rgba(255,255,255,0.7)" 
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder={searchPlaceholder}
              placeholderTextColor="rgba(255,255,255,0.7)"
              value={searchQuery}
              onChangeText={handleSearchChange}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity 
                onPress={() => handleSearchChange('')}
                style={styles.clearButton}
              >
                <Feather name="x" size={16} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </LinearGradient>
    </>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 24,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  headerInfo: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  loadingContainer: {
    paddingVertical: 8,
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 12,
    marginLeft: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
  },
  clearButton: {
    padding: 4,
    marginLeft: 8,
  },
});

export default ClinicianHeader;