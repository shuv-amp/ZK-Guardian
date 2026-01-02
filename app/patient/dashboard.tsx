// app/patient/dashboard.tsx
import React, { useState, useEffect } from "react";
import { 
  ScrollView, 
  StyleSheet, 
  Text, 
  TouchableOpacity, 
  View, 
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { getStoredUser } from "../../api/authService";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {Header, TabNavigation} from "./_components";

interface User {
  id: number;
  firstName: string;
  lastName: string;
  patientId?: string;
}

type TabType = 'consent' | 'history' | 'manage' | 'records';

export default function PatientDashboard() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('consent');

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const userData = await getStoredUser();
      if (userData) {
        setUser(userData);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTabPress = (tab: TabType) => {
    setActiveTab(tab);
    
    // Navigate to respective pages
    switch(tab) {
      case 'consent':
        // Stay on current page
        break;
      case 'history':
        router.push('/patient/history');
        break;
      case 'manage':
        router.push('/patient/manage');
        break;
      case 'records':
        router.push('/patient/records');
        break;
    }
  };

  const pendingRequests = [
    {
      id: 1,
      doctor: "Dr. James Wilson",
      specialty: "Neurologist",
      hospital: "St. Mary's Hospital",
      reason: "Neurological assessment for chronic headaches",
      requestedAccess: ["MRI Scans", "Medical History", "Lab Results"],
      requested: "2024-11-30",
      duration: "3 months",
      status: "Pending"
    },
    {
      id: 2,
      doctor: "Dr. Lisa Anderson",
      specialty: "Endocrinologist",
      hospital: "University Medical Center",
      reason: "Diabetes management and treatment plan",
      requestedAccess: ["Lab Results", "Prescription History"],
      requested: "2024-11-28",
      duration: "6 months",
      status: "Pending"
    },
  ];

  const activeConsents = [
    {
      id: 1,
      doctor: "Dr. Sarah Johnson",
      specialty: "Cardiologist",
      hospital: "City General Hospital",
      accessTo: ["Lab Results", "Medical History", "Prescriptions"],
      granted: "2024-11-28",
      expires: "2025-05-28",
      timesAccessed: "12",
      lastAccess: "2024-12-10",
    },
  ];

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Reusable Patient Header */}
        <Header 
          activeConsentsCount={activeConsents.length}
          pendingCount={pendingRequests.length}
          totalAccess={activeConsents.length + pendingRequests.length}
        />

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'consent' && styles.tabActive]}
            onPress={() => handleTabPress('consent')}
          >
            <Feather 
              name="file-text" 
              size={18} 
              color={activeTab === 'consent' ? '#6366F1' : '#9CA3AF'} 
            />
            <Text style={[styles.tabText, activeTab === 'consent' && styles.tabTextActive]}>
              Consent
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.tab, activeTab === 'history' && styles.tabActive]}
            onPress={() => handleTabPress('history')}
          >
            <Feather 
              name="clock" 
              size={18} 
              color={activeTab === 'history' ? '#6366F1' : '#9CA3AF'} 
            />
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
              History
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.tab, activeTab === 'manage' && styles.tabActive]}
            onPress={() => handleTabPress('manage')}
          >
            <Feather 
              name="sliders" 
              size={18} 
              color={activeTab === 'manage' ? '#6366F1' : '#9CA3AF'} 
            />
            <Text style={[styles.tabText, activeTab === 'manage' && styles.tabTextActive]}>
              Manage
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.tab, activeTab === 'records' && styles.tabActive]}
            onPress={() => handleTabPress('records')}
          >
            <Feather 
              name="activity" 
              size={18} 
              color={activeTab === 'records' ? '#6366F1' : '#9CA3AF'} 
            />
            <Text style={[styles.tabText, activeTab === 'records' && styles.tabTextActive]}>
              My Records
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Pending Requests Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-circle" size={20} color="#F59E0B" />
              <Text style={styles.sectionTitle}>Pending Requests ({pendingRequests.length})</Text>
            </View>

            {pendingRequests.map((request) => (
              <View key={request.id} style={styles.requestCard}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.doctorName}>{request.doctor}</Text>
                    <Text style={styles.specialty}>{request.specialty}</Text>
                    <Text style={styles.hospital}>{request.hospital}</Text>
                  </View>
                  <View style={styles.statusBadgePending}>
                    <Text style={styles.statusText}>Pending</Text>
                  </View>
                </View>

                <View style={styles.cardContent}>
                  <Text style={styles.fieldLabel}>Reason for Access:</Text>
                  <Text style={styles.fieldValue}>{request.reason}</Text>

                  <Text style={styles.fieldLabel}>Requested access to:</Text>
                  <View style={styles.tagContainer}>
                    {request.requestedAccess.map((item, index) => (
                      <View key={index} style={styles.tag}>
                        <Text style={styles.tagText}>{item}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaText}>Requested: {request.requested}</Text>
                    <Text style={styles.metaText}>Duration: {request.duration}</Text>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.grantButton}>
                    <Feather name="check-circle" size={16} color="#fff" />
                    <Text style={styles.grantButtonText}>Grant Access</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.denyButton}>
                    <Feather name="x-circle" size={16} color="#6B7280" />
                    <Text style={styles.denyButtonText}>Deny</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>

          {/* Active Consents Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name="check-circle" size={20} color="#10B981" />
              <Text style={styles.sectionTitle}>Active Consents ({activeConsents.length})</Text>
            </View>

            {activeConsents.map((consent) => (
              <View key={consent.id} style={styles.requestCard}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.doctorName}>{consent.doctor}</Text>
                    <Text style={styles.specialty}>{consent.specialty}</Text>
                    <Text style={styles.hospital}>{consent.hospital}</Text>
                  </View>
                  <View style={styles.statusBadgeActive}>
                    <Text style={styles.statusTextActive}>Active</Text>
                  </View>
                </View>

                <View style={styles.cardContent}>
                  <Text style={styles.fieldLabel}>Has access to:</Text>
                  <View style={styles.tagContainer}>
                    {consent.accessTo.map((item, index) => (
                      <View key={index} style={styles.tag}>
                        <Text style={styles.tagText}>{item}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.consentInfo}>
                    <View style={styles.consentInfoRow}>
                      <Text style={styles.infoLabel}>Granted:</Text>
                      <Text style={styles.infoValue}>{consent.granted}</Text>
                    </View>
                    <View style={styles.consentInfoRow}>
                      <Text style={styles.infoLabel}>Expires:</Text>
                      <Text style={styles.infoValue}>{consent.expires}</Text>
                    </View>
                    <View style={styles.consentInfoRow}>
                      <Text style={styles.infoLabel}>Times Accessed:</Text>
                      <Text style={styles.infoValue}>{consent.timesAccessed}</Text>
                    </View>
                    <View style={styles.consentInfoRow}>
                      <Text style={styles.infoLabel}>Last Access:</Text>
                      <Text style={styles.infoValue}>{consent.lastAccess}</Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity style={styles.revokeButton}>
                  <Feather name="trash-2" size={16} color="#DC2626" />
                  <Text style={styles.revokeButtonText}>Revoke Access</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={{ height: 30 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  scrollView: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6B7280",
  },

  // Tab Navigation
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabActive: {
    backgroundColor: "#EEF2FF",
  },
  tabText: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: "500",
  },
  tabTextActive: {
    color: "#6366F1",
    fontWeight: "600",
  },

  // Content
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2937",
  },

  // Request Card
  requestCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  doctorName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2937",
  },
  specialty: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 2,
  },
  hospital: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 1,
  },
  statusBadgePending: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusBadgeActive: {
    backgroundColor: "#D1FAE5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#92400E",
  },
  statusTextActive: {
    fontSize: 11,
    fontWeight: "600",
    color: "#065F46",
  },

  // Card Content
  cardContent: {
    gap: 12,
  },
  fieldLabel: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "500",
  },
  fieldValue: {
    fontSize: 13,
    color: "#1F2937",
    lineHeight: 20,
  },
  tagContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tag: {
    backgroundColor: "#EEF2FF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 11,
    color: "#4F46E5",
    fontWeight: "500",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  metaText: {
    fontSize: 11,
    color: "#9CA3AF",
  },

  // Consent Info
  consentInfo: {
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  consentInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: {
    fontSize: 12,
    color: "#6B7280",
  },
  infoValue: {
    fontSize: 12,
    color: "#1F2937",
    fontWeight: "600",
  },

  // Action Buttons
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  grantButton: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  grantButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  denyButton: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  denyButtonText: {
    color: "#6B7280",
    fontSize: 13,
    fontWeight: "600",
  },
  revokeButton: {
    flexDirection: "row",
    backgroundColor: "#FEF2F2",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#FEE2E2",
  },
  revokeButtonText: {
    color: "#DC2626",
    fontSize: 13,
    fontWeight: "600",
  },
});