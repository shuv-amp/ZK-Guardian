// app/clinician/zkproof.tsx
import React, { useState } from 'react';
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

const ZKProofScreen = () => {
  const [activeTab, setActiveTab] = useState('zk-proofs');
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    // TODO: Implement search logic
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scrollView}>
        {/* Reusable Header */}
        <ClinicianHeader
          showSearch={true}
          onSearchChange={handleSearchChange}
          searchPlaceholder="Search patients by name or MRN..."
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
            onPress={() => setActiveTab('zk-proofs')}
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

        {/* ZK Proofs Content */}
        <View style={styles.content}>
          {/* Proof Card 1 */}
          <View style={styles.proofCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.proofTitle}>Access Verification Proof</Text>
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedIcon}>✓</Text>
                <Text style={styles.verifiedText}>verified</Text>
              </View>
            </View>

            <View style={styles.proofDetails}>
              <Text style={styles.proofLabel}>Proof Hash</Text>
              <Text style={styles.proofHash}>0x7f5a...3b2d</Text>
            </View>

            <View style={styles.proofDetails}>
              <Text style={styles.proofLabel}>Blockchain TX</Text>
              <Text style={styles.proofHash}>0xacf1b...8c3e</Text>
            </View>

            <Text style={styles.proofDate}>Generated: 2024-11-28 14:32</Text>

            <View style={styles.proofActions}>
              <TouchableOpacity style={styles.viewDetailsButton}>
                <Text style={styles.viewDetailsIcon}>📄</Text>
                <Text style={styles.viewDetailsText}>View Details</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.exportButton}>
                <Text style={styles.exportIcon}>↓</Text>
                <Text style={styles.exportText}>Export</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Proof Card 2 */}
          <View style={styles.proofCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.proofTitle}>Michael Brown</Text>
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedIcon}>✓</Text>
                <Text style={styles.verifiedText}>verified</Text>
              </View>
            </View>

            <View style={styles.proofDetails}>
              <Text style={styles.proofLabel}>Proof Type</Text>
              <Text style={styles.proofValue}>Data Transfer Proof</Text>
            </View>

            <View style={styles.proofDetails}>
              <Text style={styles.proofLabel}>Proof Hash</Text>
              <Text style={styles.proofHash}>0x6c2b...7a1f</Text>
            </View>

            <View style={styles.proofDetails}>
              <Text style={styles.proofLabel}>Blockchain TX</Text>
              <Text style={styles.proofHash}>0xbd6e2...c405a</Text>
            </View>

            <Text style={styles.proofDate}>Generated: 2024-11-26 10:15</Text>

            <View style={styles.proofActions}>
              <TouchableOpacity style={styles.viewDetailsButton}>
                <Text style={styles.viewDetailsIcon}>📄</Text>
                <Text style={styles.viewDetailsText}>View Details</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.exportButton}>
                <Text style={styles.exportIcon}>↓</Text>
                <Text style={styles.exportText}>Export</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Info Box */}
          <View style={styles.zkInfoBox}>
            <Text style={styles.zkInfoIcon}>ℹ️</Text>
            <View style={styles.zkInfoContent}>
              <Text style={styles.zkInfoTitle}>About Zero-Knowledge Proofs</Text>
              <Text style={styles.zkInfoText}>
                ZK proofs provide cryptographic verification of data access without
                exposing patient information. All proofs are recorded on the
                blockchain for transparency and audit purposes.
              </Text>
            </View>
          </View>
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
  proofCard: {
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
  proofTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  verifiedIcon: {
    fontSize: 12,
    marginRight: 4,
    color: '#059669',
  },
  verifiedText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '500',
  },
  proofDetails: {
    marginTop: 12,
  },
  proofLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  proofValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  proofHash: {
    fontSize: 13,
    color: '#7C3AED',
    fontFamily: 'monospace',
  },
  proofDate: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 12,
  },
  proofActions: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  viewDetailsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    paddingVertical: 10,
    borderRadius: 8,
  },
  viewDetailsIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  viewDetailsText: {
    color: '#7C3AED',
    fontSize: 13,
    fontWeight: '600',
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    borderRadius: 8,
  },
  exportIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  exportText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  zkInfoBox: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  zkInfoIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  zkInfoContent: {
    flex: 1,
  },
  zkInfoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E40AF',
    marginBottom: 4,
  },
  zkInfoText: {
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 20,
  },
});

export default ZKProofScreen;