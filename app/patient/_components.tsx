// app/patient/_components.tsx
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { getStoredUser } from "../../api/authService";
import { router, usePathname } from "expo-router";

type HeaderProps = {
  activeConsentsCount: number;
  pendingCount: number;
  totalAccess: number;
};

type User = {
  id: number;
  firstName: string;
  lastName: string;
  patientId?: string;
};

type TabType = 'consent' | 'history' | 'manage' | 'records';

export function Header({
  activeConsentsCount,
  pendingCount,
  totalAccess,
}: HeaderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const userData = await getStoredUser();
      setUser(userData);
    } catch (error) {
      console.error("Error loading user:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPatientId = () => {
    if (user?.patientId) return user.patientId;
    if (user?.id) return `PAT-${user.id.toString().padStart(5, '0')}`;
    return "PAT-00000";
  };

  return (
    <LinearGradient
      colors={["#4f46e5", "#6366f1"]}
      style={styles.header}
    >
      {/* MAIN HEADER */}
      <View style={styles.headerMain}>
        {/* LEFT - User Info */}
        <View style={styles.headerLeft}>
          <View style={styles.avatar}>
            <Feather name="user" size={22} color="#2563eb" />
          </View>

          <View style={styles.userInfo}>
            <Text style={styles.headerWelcome}>Welcome back,</Text>

            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : (
              <>
                <Text style={styles.headerName}>
                  {user
                    ? `${user.firstName} ${user.lastName}`
                    : "User"}
                </Text>
                <Text style={styles.headerId}>
                  Patient ID: {getPatientId()}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* RIGHT - Action Icons */}
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn}>
            <Feather name="bell" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.iconBtn}
            onPress={() => router.push('/settings/dashboard')}
          >
            <Feather name="settings" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* SUMMARY CARDS */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>
            Active Consents
          </Text>
          <Text style={styles.summaryValue}>
            {activeConsentsCount}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Pending</Text>
          <Text
            style={[
              styles.summaryValue,
              { color: "#F97316" },
            ]}
          >
            {pendingCount}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>
            Total Access
          </Text>
          <Text
            style={[
              styles.summaryValue,
              { color: "#10B981" },
            ]}
          >
            {totalAccess}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

// New TabNavigation Component
export function TabNavigation() {
  const pathname = usePathname();

  const getActiveTab = (): TabType => {
    if (pathname.includes('/history')) return 'history';
    if (pathname.includes('/manage')) return 'manage';
    if (pathname.includes('/records')) return 'records';
    return 'consent';
  };

  const activeTab = getActiveTab();

  const handleTabPress = (tab: TabType) => {
    switch(tab) {
      case 'consent':
        router.push('/patient/dashboard');
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

  return (
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
  );
}

const styles = StyleSheet.create({
  header: {
    padding: 16,
    paddingTop: 48,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },

  headerMain: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },

  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  userInfo: {
    flex: 1,
  },

  headerWelcome: {
    color: "#E0E7FF",
    fontSize: 12,
  },

  headerName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 2,
  },

  headerId: {
    color: "#C7D2FE",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "500",
  },

  loadingContainer: {
    paddingVertical: 8,
  },

  headerRight: {
    flexDirection: "row",
    gap: 12,
    marginLeft: 12,
  },

  iconBtn: {
    padding: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 20,
  },

  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },

  summaryCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
  },

  summaryLabel: {
    color: "#E0E7FF",
    fontSize: 11,
  },

  summaryValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 4,
  },

  // Tab Navigation Styles
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
});