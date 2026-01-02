// app/clinician/dashboard.tsx
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

// Mock data for pending requests
const mockRequests = [
  {
    id: 1,
    patientName: 'John Doe',
    mrn: 'PAT-12345',
    reason: 'Follow-up consultation',
    requestedData: ['Lab Results', 'Medical History', 'Prescriptions'],
    requestedDate: '2024-11-30',
    status: 'pending',
  },
  {
    id: 2,
    patientName: 'Robert Johnson',
    mrn: 'PAT-34321',
    reason: 'Neurological assessment',
    requestedData: ['Lab Results', 'Medical History', 'Imaging Reports'],
    requestedDate: '2024-11-29',
    status: 'pending',
  },
];

const ClinicianDashboard = () => {
  const [activeTab, setActiveTab] = useState('request-access');
  const [pendingRequests, setPendingRequests] = useState(mockRequests);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadPendingRequests();
  }, []);

  const loadPendingRequests = async () => {
    try {
      // TODO: Replace with actual API call
      // const token = await AsyncStorage.getItem('token');
      // const response = await fetch(API_ENDPOINTS.REQUESTS.PENDING, {
      //   headers: { Authorization: `Bearer ${token}` }
      // });
      // const data = await response.json();
      // setPendingRequests(data.requests);
    } catch (error) {
      console.error('Error loading requests:', error);
    }
  };

  const handleRequestAccess = () => {
    // TODO: Navigate to request form
    console.log('Opening request form...');
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    // TODO: Implement search logic
  };

  return (
    <SafeAreaView style={styles.container}>
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
            style={[
              styles.tab,
              activeTab === 'request-access' && styles.activeTab,
            ]}
            onPress={() => setActiveTab('request-access')}
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
            onPress={() => router.push('/clinician/view')}
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
          {/* Request Access Button */}
          <TouchableOpacity
            style={styles.requestButton}
            onPress={handleRequestAccess}
          >
            <Text style={styles.requestButtonText}>
              + Request Access to Patient Data
            </Text>
          </TouchableOpacity>

          {/* Pending Requests Section */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>🕐</Text>
            <Text style={styles.sectionTitle}>
              Pending Requests ({pendingRequests.length})
            </Text>
          </View>

          {/* Request Cards */}
          {pendingRequests.map((request) => (
            <View key={request.id} style={styles.requestCard}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.patientName}>{request.patientName}</Text>
                  <Text style={styles.mrn}>{request.mrn}</Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>⏱ pending</Text>
                </View>
              </View>

              <View style={styles.cardSection}>
                <Text style={styles.label}>Reason:</Text>
                <Text style={styles.value}>{request.reason}</Text>
              </View>

              <View style={styles.cardSection}>
                <Text style={styles.label}>Requested data:</Text>
                <View style={styles.tagsContainer}>
                  {request.requestedData.map((data, idx) => (
                    <View key={idx} style={styles.tag}>
                      <Text style={styles.tagText}>{data}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.dateText}>
                  Requested: {request.requestedDate}
                </Text>
              </View>

              <View style={styles.infoBox}>
                <Text style={styles.infoIcon}>ℹ️</Text>
                <Text style={styles.infoText}>
                  Waiting for patient approval. You'll be notified once access
                  is granted.
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
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
  requestButton: {
    backgroundColor: '#9333ea',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  requestButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionIcon: {
    fontSize: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#fed7aa',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
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
  mrn: {
    fontSize: 13,
    color: '#6b7280',
  },
  statusBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    color: '#92400e',
    fontWeight: '500',
  },
  cardSection: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    color: '#111827',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  tag: {
    backgroundColor: '#ede9fe',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 11,
    color: '#6b21a8',
    fontWeight: '500',
  },
  dateText: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
  },
  infoBox: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    gap: 8,
  },
  infoIcon: {
    fontSize: 14,
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: '#1e40af',
  },
});

export default ClinicianDashboard;