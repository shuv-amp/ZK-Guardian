// app/clinician/view.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import ClinicianHeader from '../../components/ClinicianHeader';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock data for approved patients
const mockApprovedPatients = [
  {
    id: 1,
    name: 'Jane Smith',
    mrn: 'PAT-67890',
    age: 45,
    sex: 'F',
    bloodType: 'A+',
    condition: 'Hypertension',
    allergies: 'Penicillin',
    lastVisit: '2024-11-25',
    accessExpires: '2025-02-28',
  },
  {
    id: 2,
    name: 'Michael Brown',
    mrn: 'PAT-11223',
    age: 52,
    sex: 'M',
    bloodType: 'O+',
    condition: 'Diabetes Type 2',
    allergies: 'None',
    lastVisit: '2024-11-20',
    accessExpires: '2025-01-26',
  },
];

const ViewDataScreen = () => {
  const [activeTab, setActiveTab] = useState('view-data');
  const [approvedPatients, setApprovedPatients] = useState(mockApprovedPatients);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadApprovedPatients();
  }, []);

  const loadApprovedPatients = async () => {
    try {
      // TODO: Replace with actual API call
      // const token = await AsyncStorage.getItem('token');
      // const response = await fetch(API_ENDPOINTS.PATIENTS.APPROVED, {
      //   headers: { Authorization: `Bearer ${token}` }
      // });
      // const data = await response.json();
      // setApprovedPatients(data.patients);
    } catch (error) {
      console.error('Error loading approved patients:', error);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    // TODO: Implement search/filter logic
  };

  const handleViewRecords = (patientId: number) => {
    // TODO: Navigate to patient records detail screen
    console.log('View records for patient:', patientId);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scrollView}>
        {/* Reusable Header */}
        <ClinicianHeader
          showSearch={true}
          onSearchChange={handleSearchChange}
          searchPlaceholder="Search patients by name or PAT..."
        />

        {/* Navigation Tabs */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'request-access' && styles.activeTab]}
            onPress={() => router.push('/clinician/dashboard')}
          >
            <Text style={styles.tabIcon}>🕐</Text>
            <Text
              style={[
                styles.tabText,
                activeTab === 'request-access' && styles.activeTabText,
              ]}
            >
              Request Access
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'view-data' && styles.activeTab]}
            onPress={() => setActiveTab('view-data')}
          >
            <Text style={styles.tabIcon}>📄</Text>
            <Text
              style={[
                styles.tabText,
                activeTab === 'view-data' && styles.activeTabText,
              ]}
            >
              View Data
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'zk-proofs' && styles.activeTab]}
            onPress={() => router.push('/clinician/zkproof')}
          >
            <Text style={styles.tabIcon}>📊</Text>
            <Text
              style={[
                styles.tabText,
                activeTab === 'zk-proofs' && styles.activeTabText,
              ]}
            >
              ZK Proofs
            </Text>
          </TouchableOpacity>
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          {/* Section Header */}
          <View style={styles.sectionHeader}>
            <Text style={styles.approvedIcon}>✓</Text>
            <Text style={styles.sectionTitle}>
              Approved Access ({approvedPatients.length})
            </Text>
          </View>

          {/* Patient Cards */}
          {approvedPatients.map((patient) => (
            <View key={patient.id} style={styles.patientCard}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.patientName}>{patient.name}</Text>
                  <Text style={styles.patientMRN}>{patient.mrn}</Text>
                </View>
                <View style={styles.approvedBadge}>
                  <Text style={styles.approvedBadgeIcon}>✓</Text>
                  <Text style={styles.approvedBadgeText}>Approved</Text>
                </View>
              </View>

              <View style={styles.patientDetails}>
                <View style={styles.detailRow}>
                  <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Age</Text>
                    <Text style={styles.detailValue}>{patient.age} years</Text>
                  </View>
                  <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Blood Type</Text>
                    <Text style={styles.detailValue}>{patient.bloodType}</Text>
                  </View>
                </View>

                <View style={styles.detailRow}>
                  <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Condition</Text>
                    <Text style={styles.detailValue}>{patient.condition}</Text>
                  </View>
                  <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Last Visit</Text>
                    <Text style={styles.detailValue}>{patient.lastVisit}</Text>
                  </View>
                </View>

                <View style={styles.detailFullRow}>
                  <Text style={styles.detailLabel}>Allergies</Text>
                  <Text style={styles.detailValue}>{patient.allergies}</Text>
                </View>
              </View>

              <Text style={styles.expiryText}>
                Access expires: {patient.accessExpires}
              </Text>

              <TouchableOpacity
                style={styles.viewRecordsButton}
                onPress={() => handleViewRecords(patient.id)}
              >
                <Text style={styles.viewRecordsIcon}>📄</Text>
                <Text style={styles.viewRecordsText}>View Complete Records</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollView: {
    flex: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 4,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    flex: 1,
    justifyContent: 'center',
  },
  activeTab: {
    borderBottomColor: '#9333ea',
  },
  tabIcon: {
    fontSize: 16,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  activeTabText: {
    color: '#9333ea',
  },
  tabBadge: {
    backgroundColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  content: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  approvedIcon: {
    fontSize: 20,
    marginRight: 8,
    color: '#059669',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
  },
  patientCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  patientName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  patientMRN: {
    fontSize: 13,
    color: '#6B7280',
  },
  approvedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  approvedBadgeIcon: {
    fontSize: 12,
    marginRight: 4,
    color: '#059669',
  },
  approvedBadgeText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '500',
  },
  patientDetails: {
    marginTop: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailColumn: {
    flex: 1,
  },
  detailFullRow: {
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  expiryText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 8,
    marginBottom: 16,
  },
  viewRecordsButton: {
    backgroundColor: '#7C3AED',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  viewRecordsIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  viewRecordsText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default ViewDataScreen;