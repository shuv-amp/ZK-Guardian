// app/patient/manage.tsx
import { Entypo, Feather, MaterialIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { Header, TabNavigation } from "./_components"; // Make sure TabNavigation is imported

export default function ManageScreen() {
  const [settings, setSettings] = useState({
    labResults: true,
    medicalHistory: true,
    imaging: true,
    prescriptions: true,
    geneticInfo: false,
  });

  const toggle = (k: keyof typeof settings) => setSettings((s) => ({ ...s, [k]: !s[k] }));

  const list: { key: keyof typeof settings; label: string; icon: React.ReactNode }[] = [
    { key: "labResults", label: "Lab Results", icon: <MaterialIcons name="science" size={18} color="#2563eb" /> },
    { key: "medicalHistory", label: "Medical History", icon: <Feather name="file" size={18} color="#2563eb" /> },
    { key: "imaging", label: "Imaging (X-ray, MRI)", icon: <Entypo name="camera" size={18} color="#2563eb" /> },
    { key: "prescriptions", label: "Prescriptions", icon: <Feather name="clipboard" size={18} color="#2563eb" /> },
    { key: "geneticInfo", label: "Genetic Information", icon: <MaterialIcons name="biotech" size={18} color="#2563eb" /> },
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
          <Text style={styles.pageTitle}>Privacy Settings</Text>
          <Text style={styles.pageSubtitle}>
            Control which types of data can be requested by healthcare providers
          </Text>

          {list.map((s) => (
            <View key={s.key} style={styles.settingRow}>
              <View style={styles.settingLeft}>
                {s.icon}
                <Text style={styles.settingLabel}>{s.label}</Text>
              </View>
              <TouchableOpacity 
                onPress={() => toggle(s.key)} 
                style={[
                  styles.switchBase, 
                  settings[s.key] ? styles.switchOn : styles.switchOff
                ]}
              >
                <View style={[
                  styles.switchThumb, 
                  settings[s.key] ? styles.switchThumbRight : styles.switchThumbLeft
                ]} />
              </TouchableOpacity>
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
    marginBottom: 8 
  },
  pageSubtitle: { 
    fontSize: 13, 
    color: "#6B7280", 
    marginBottom: 20 
  },
  settingRow: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    backgroundColor: "#fff", 
    padding: 16, 
    borderRadius: 12, 
    marginBottom: 8, 
    shadowColor: "#000", 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 4, 
    elevation: 2 
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingLabel: { 
    fontSize: 14, 
    fontWeight: "500", 
    color: "#1F2937" 
  },
  switchBase: { 
    width: 48, 
    height: 28, 
    borderRadius: 14, 
    padding: 2, 
    justifyContent: "center" 
  },
  switchOn: { 
    backgroundColor: "#4f46e5" 
  },
  switchOff: { 
    backgroundColor: "#D1D5DB" 
  },
  switchThumb: { 
    width: 24, 
    height: 24, 
    borderRadius: 12, 
    backgroundColor: "#fff" 
  },
  switchThumbRight: {
    alignSelf: "flex-end",
  },
  switchThumbLeft: {
    alignSelf: "flex-start",
  },
});