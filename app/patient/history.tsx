// app/patient/history.tsx
import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { SafeAreaView, ScrollView, Text, View, StyleSheet } from "react-native";
import { Header, TabNavigation } from "./_components";

const SmallBadge = ({ label, color }: { label: string; color: string }) => (
  <View style={[styles.badge, { backgroundColor: color }]}>
    <Text style={styles.badgeText}>{label}</Text>
  </View>
);

export default function HistoryScreen() {
  const history = [
    { id: 1, doctor: "Dr. Sarah Johnson", action: "Accessed Medical History", timestamp: "2024-11-28 14:30", hash: "0x7a8f..." },
    { id: 2, doctor: "Dr. Michael Chen", action: "Access Revoked", timestamp: "2024-11-25 09:15", hash: "0x3d4e..." },
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Header 
          activeConsentsCount={2}
          pendingCount={2}
          totalAccess={3}
        />
        
        <TabNavigation />
        
        <View style={styles.content}>
          <Text style={styles.pageTitle}>Access History</Text>
          {history.map((h) => (
            <View key={h.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>{h.doctor}</Text>
                  <Text style={styles.cardSub}>{h.action}</Text>
                </View>
                <SmallBadge 
                  label={h.action.includes("Revoked") ? "Revoked" : "Granted"} 
                  color={h.action.includes("Revoked") ? "#fecaca" : "#bbf7d0"} 
                />
              </View>

              <Text style={styles.cardTiny}>{h.timestamp}</Text>

              <View style={styles.hashRow}>
                <MaterialIcons name="storage" size={14} color="#2563eb" />
                <Text style={styles.mono}>{h.hash}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: "#F3F4F6" 
  },
  content: {
    padding: 16,
  },
  pageTitle: { 
    fontSize: 20, 
    fontWeight: "700", 
    color: "#1F2937", 
    marginBottom: 16 
  },
  card: { 
    backgroundColor: "#fff", 
    borderRadius: 12, 
    padding: 16, 
    marginBottom: 12, 
    shadowColor: "#000", 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 4, 
    elevation: 2 
  },
  cardHeader: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "flex-start", 
    marginBottom: 8 
  },
  cardTitle: { 
    fontSize: 15, 
    fontWeight: "600", 
    color: "#1F2937" 
  },
  cardSub: { 
    fontSize: 13, 
    color: "#6B7280", 
    marginTop: 2 
  },
  cardTiny: { 
    fontSize: 11, 
    color: "#9CA3AF", 
    marginTop: 4 
  },
  badge: { 
    paddingHorizontal: 8, 
    paddingVertical: 4, 
    borderRadius: 8 
  },
  badgeText: { 
    fontSize: 10, 
    fontWeight: "600", 
    color: "#065F46" 
  },
  hashRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  mono: { 
    fontFamily: "monospace", 
    fontSize: 12, 
    color: "#2563eb",
    marginLeft: 8,
  },
});