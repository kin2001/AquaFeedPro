import { Lucide } from "@react-native-vector-icons/lucide";
import { Tabs } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Colors,
  IconSize,
  InterFamilies,
  MaxContentWidth,
} from "@/constants/theme";
import {
  addAlerts,
  alertLine,
  alertTitle,
  detectAlerts,
  readAlertState,
  writeAlertState,
  type AlertEntry,
} from "@/lib/alerts";
import { useDeviceAccess } from "@/lib/device-access";
import { sameDeviceRequestScope } from "@/lib/device-access-state";
import { readMonitoringSnapshot } from "@/lib/monitoring";
import { readConfiguration } from "@/lib/schedules";

const CHANNEL_ID = "feeder-alerts";
let notificationsReady: Promise<
  typeof import("expo-notifications") | null
> | null = null;

/** Loaded lazily and asked once per session: any failure or refusal leaves only the in-app list. */
function systemNotifications() {
  notificationsReady ??= (async () => {
    const Notifications = await import("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    // Android 13 shows the permission prompt only after a channel exists.
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Feeder alerts",
      importance: Notifications.AndroidImportance.HIGH,
    });
    const current = await Notifications.getPermissionsAsync();
    const granted =
      current.granted ||
      (await Notifications.requestPermissionsAsync()).granted;
    return granted ? Notifications : null;
  })().catch(() => null);
  return notificationsReady;
}

async function presentAlerts(entries: AlertEntry[]) {
  if (Platform.OS === "web") return;
  const Notifications = await systemNotifications();
  for (const entry of entries)
    await Notifications?.scheduleNotificationAsync({
      content: { title: alertTitle(entry.kind), body: alertLine(entry) },
      trigger: { channelId: CHANNEL_ID },
    }).catch(() => undefined);
}

/** Reads the selected feeder every 30 s while the app is open and records limit crossings. Read-only. */
function AlertWatcher() {
  const access = useDeviceAccess();
  const { installationId, scopeRevision, selectedDeviceId: deviceId } = access;
  const deviceName =
    access.selectedDevice?.alias?.trim() || access.selectedDevice?.model;
  const deviceSimulated = access.selectedDevice?.isSimulated === true;
  const scope = useMemo(
    () => ({
      installationId,
      revision: scopeRevision,
      selectedDeviceId: deviceId,
    }),
    [installationId, scopeRevision, deviceId],
  );
  const scopeRef = useRef(scope);
  useLayoutEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    if (!installationId || !deviceId || !deviceName) return;
    const requestScope = { ...scope };
    let active = true;
    let loading = false;
    const check = async () => {
      if (loading || AppState.currentState !== "active") return;
      loading = true;
      try {
        const [snapshot, configuration] = await Promise.all([
          readMonitoringSnapshot(installationId, deviceId),
          readConfiguration(installationId, deviceId),
        ]);
        if (!active || !sameDeviceRequestScope(requestScope, scopeRef.current))
          return;
        const sample = snapshot.latest_sample;
        const reading = {
          doMgL:
            sample?.do_quality === "valid" && sample.do_freshness === "fresh"
              ? sample.do_mg_l
              : null,
          feedPercent:
            sample?.feed_quality === "valid" &&
            sample.feed_freshness === "fresh"
              ? sample.feed_percent
              : null,
        };
        const applied = configuration.applied_snapshot;
        const limits = {
          doLow: applied?.monitoring_limits.do_low_mg_l ?? null,
          doHigh: applied?.monitoring_limits.do_high_mg_l ?? null,
          feedLow: applied?.low_feed_threshold_pct ?? null,
        };
        const { state, raised } = detectAlerts(
          reading,
          limits,
          readAlertState(deviceId),
        );
        writeAlertState(deviceId, state);
        if (!raised.length) return;
        const at = new Date().toISOString();
        const simulated = deviceSimulated || snapshot.profile.is_simulated;
        const measured = {
          do_low: [reading.doMgL, limits.doLow],
          do_high: [reading.doMgL, limits.doHigh],
          feed_low: [reading.feedPercent, limits.feedLow],
        } as const;
        const added = addAlerts(
          raised.flatMap((kind) => {
            const [value, limit] = measured[kind];
            return value === null || limit === null
              ? []
              : [{ deviceId, deviceName, kind, value, limit, simulated, at }];
          }),
        );
        void presentAlerts(added);
      } catch {
        // A failed read changes nothing: no alert, no state change, nothing on screen.
      } finally {
        loading = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [scope, installationId, deviceId, deviceName, deviceSimulated]);

  return null;
}

const icons = {
  home: "house",
  schedule: "calendar-clock",
  history: "history",
  settings: "settings",
} as const;

function TabIcon({
  name,
  focused,
}: {
  name: keyof typeof icons;
  focused: boolean;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.iconWell}
    >
      <Lucide
        name={icons[name]}
        size={IconSize.nav}
        color={focused ? Colors.light.ink : Colors.light.textTertiary}
      />
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <>
      <AlertWatcher />
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: Colors.light.background },
          tabBarLabelPosition: "below-icon",
          tabBarLabel: ({ focused, children }) => (
            <Text style={[styles.label, focused && styles.labelSelected]}>
              {children}
            </Text>
          ),
          tabBarStyle: [
            styles.tabBar,
            { height: 64 + insets.bottom, paddingBottom: insets.bottom },
          ],
          tabBarItemStyle: styles.tabItem,
          tabBarIconStyle: styles.tabIcon,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ focused }) => (
              <TabIcon name="home" focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: "Schedule",
            tabBarIcon: ({ focused }) => (
              <TabIcon name="schedule" focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
            tabBarIcon: ({ focused }) => (
              <TabIcon name="history" focused={focused} />
            ),
          }}
        />
        {/* shortcut: the route stays /device so existing links and back fallbacks keep working; rename it if a second settings route ever appears. */}
        <Tabs.Screen
          name="device"
          options={{
            title: "Settings",
            tabBarIcon: ({ focused }) => (
              <TabIcon name="settings" focused={focused} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.light.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingTop: 0,
    elevation: 0,
    shadowOpacity: 0,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  tabItem: { height: 64, justifyContent: "center", alignItems: "center" },
  tabIcon: { width: 56, height: 32 },
  label: {
    fontFamily: InterFamilies.medium,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    color: Colors.light.textTertiary,
  },
  labelSelected: {
    fontFamily: InterFamilies.semibold,
    color: Colors.light.ink,
  },
  iconWell: {
    width: 56,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
