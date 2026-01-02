// app/patient/records.tsx
import React from "react";
import { SafeAreaView, ScrollView, Text, View, StyleSheet } from "react-native";
import { Header, TabNavigation } from "./_components";

export default function RecordsScreen() {
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
          <Text style={styles.pageTitle}>My Records</Text>

          <View style={styles.gridRow}>
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Current Vitals</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Blood Pressure</Text>
                <Text style={styles.infoVal}>120/80 mmHg</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Heart Rate</Text>
                <Text style={styles.infoVal}>72 bpm</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Temperature</Text>
                <Text style={styles.infoVal}>98.6°F</Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Recent Lab Results</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Blood Glucose</Text>
                <Text style={styles.infoVal}>95 mg/dL</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Cholesterol</Text>
                <Text style={styles.infoVal}>180 mg/dL</Text>
              </View>
              <Text style={styles.cardTiny}>Last updated: Nov 20, 2024</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.infoTitle}>Active Medications</Text>
            <View style={{ height: 8 }} />
            <View style={styles.medRow}>
              <View>
                <Text style={styles.cardBold}>Lisinopril 10mg</Text>
                <Text style={styles.cardSub}>Once daily - Blood Pressure</Text>
              </View>
              <Text style={styles.cardTiny}>Refills: 2</Text>
            </View>
            <View style={{ height: 8 }} />
            <View style={styles.medRow}>
              <View>
                <Text style={styles.cardBold}>Metformin 500mg</Text>
                <Text style={styles.cardSub}>Twice daily - Diabetes</Text>
              </View>
              <Text style={styles.cardTiny}>Refills: 1</Text>
            </View>
          </View>

          <View style={{ height: 30 }} />
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
  gridRow: { 
    flexDirection: "row", 
    gap: 12, 
    marginBottom: 12 
  },
  infoCard: { 
    flex: 1, 
    backgroundColor: "#fff", 
    borderRadius: 12, 
    padding: 16, 
    shadowColor: "#000", 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 4, 
    elevation: 2 
  },
  infoTitle: { 
    fontSize: 14, 
    fontWeight: "600", 
    color: "#1F2937", 
    marginBottom: 12 
  },
  infoRow: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    marginBottom: 8 
  },
  infoKey: { 
    fontSize: 12, 
    color: "#6B7280" 
  },
  infoVal: { 
    fontSize: 12, 
    fontWeight: "600", 
    color: "#1F2937" 
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
  medRow: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center" 
  },
  cardBold: { 
    fontSize: 14, 
    fontWeight: "600", 
    color: "#1F2937" 
  },
  cardSub: { 
    fontSize: 12, 
    color: "#6B7280", 
    marginTop: 2 
  },
  cardTiny: { 
    fontSize: 11, 
    color: "#9CA3AF" 
  },
});