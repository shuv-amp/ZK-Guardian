// app/patient/_layout.tsx
import { Stack } from 'expo-router';
import React from 'react';

export default function PatientLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: '#F8F9FB',
        },
      }}
    >
      <Stack.Screen 
        name="dashboard" 
        options={{
          title: 'Patient Dashboard',
        }}
      />
      <Stack.Screen 
        name="_components" 
        options={{
          title: 'Components',
        }}
      />
      <Stack.Screen 
        name="consent" 
        options={{
          title: 'Consent Management',
        }}
      />
      <Stack.Screen 
        name="history" 
        options={{
          title: 'Access History',
        }}
      />
      <Stack.Screen 
        name="manage" 
        options={{
          title: 'Manage Access',
        }}
      />
      <Stack.Screen 
        name="records" 
        options={{
          title: 'Medical Records',
        }}
      />
    </Stack>
  );
}