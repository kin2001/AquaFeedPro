import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { AppPage, Button, PageHeading } from "@/components/app-shell";
import { Colors } from "@/constants/theme";
import { DeviceAccessProvider, useDeviceAccess } from "@/lib/device-access";

void SplashScreen.preventAutoHideAsync();

export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <DeviceAccessProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </DeviceAccessProvider>
  );
}

function RootNavigator() {
  const { phase, bootstrapError, retryBootstrap } = useDeviceAccess();
  if (phase === "loading") {
    return (
      <AppPage>
        <PageHeading
          title="Starting AquaFeed Pro"
          description="Restoring this installation securely."
        />
      </AppPage>
    );
  }
  if (phase === "error") {
    return (
      <AppPage>
        <PageHeading
          title="Installation unavailable"
          description={
            bootstrapError ?? "Secure installation access is unavailable."
          }
        />
        <Button onPress={retryBootstrap} icon="rotate-ccw">
          Retry installation
        </Button>
      </AppPage>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.light.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="dev/components" />
      <Stack.Screen name="devices/add" />
      <Stack.Screen name="devices/[deviceId]" />
      <Stack.Screen name="schedules/new" />
      <Stack.Screen name="schedules/[scheduleId]" />
      <Stack.Screen name="history/[runId]" />
      <Stack.Screen name="feed/confirm" options={{ presentation: "modal" }} />
    </Stack>
  );
}
