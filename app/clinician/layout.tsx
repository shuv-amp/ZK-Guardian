//layout.tsx
import { Stack } from 'expo-router';

export default function ClinicianLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="dashboard" />
    </Stack>
  );
}