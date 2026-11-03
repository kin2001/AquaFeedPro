import { router, useFocusEffect } from "expo-router";
import { Alert, Platform, Text, View, useWindowDimensions } from "react-native";
import { useCallback, useRef, useState } from "react";

import {
  BentoCard,
  Button,
  IconButton,
  ListRow,
  Notice,
  Sheet,
} from "@/components/app-shell";
import { relativeDayLabel } from "@/components/feed-status";
import { Typography } from "@/constants/theme";
import {
  alertLine,
  alertTitle,
  clear,
  markAllRead,
  markRead,
  remove,
  refreshAlerts,
  useAlerts,
  useUnreadCount,
} from "@/lib/alerts";
import { useDeviceAccess } from "@/lib/device-access";

const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Use phone time consistently so opening the sheet never changes its date layout. */
function timeLabel(at: string) {
  const date = new Date(at);
  const timeZone = phoneZone;
  const day = relativeDayLabel(date, timeZone);
  const label =
    day === "Today"
      ? new Intl.DateTimeFormat(undefined, {
          timeZone,
          timeStyle: "short",
        }).format(date)
      : day;
  return label;
}

function confirmClear() {
  const title = "Delete all notifications?";
  const description = "This hides notifications for this installation.";
  if (Platform.OS === "web") {
    if (globalThis.confirm(`${title} ${description}`)) clear();
    return;
  }
  Alert.alert(title, description, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete all", style: "destructive", onPress: clear },
  ]);
}

export default function NotificationsScreen() {
  const { width } = useWindowDimensions();
  const alerts = useAlerts();
  const unread = useUnreadCount();
  const { installationId, devices, refreshDevices, selectDevice } =
    useDeviceAccess();
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const navigation = useRef({ generation: 0, active: false, busy: false });
  useFocusEffect(
    useCallback(() => {
      const state = navigation.current;
      state.generation += 1;
      state.active = Boolean(installationId && devices.length);
      state.busy = false;
      setNavigationError(null);
      return () => {
        state.active = false;
        state.generation += 1;
      };
    }, [installationId, devices]),
  );
  const openFeeding = async (deviceId: string, runId: string) => {
    const state = navigation.current;
    if (!state.active || state.busy) return;
    const generation = state.generation;
    state.busy = true;
    setNavigationError(null);
    try {
      await selectDevice(deviceId);
      if (!state.active || state.generation !== generation) return;
      router.push({
        pathname: "/history/[runId]",
        params: { runId, device_id: deviceId },
      });
    } catch {
      if (state.active && state.generation === generation)
        setNavigationError("Feeding details could not be opened. Try again.");
    } finally {
      if (state.generation === generation) state.busy = false;
    }
  };
  useFocusEffect(
    useCallback(() => {
      if (!installationId) return;
      let active = true;
      void refreshAlerts(installationId, devices).then((revoked) => {
        if (active && revoked.length) void refreshDevices().catch(() => []);
      });
      return () => {
        active = false;
      };
    }, [installationId, devices, refreshDevices]),
  );
  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/");

  return (
    <Sheet
      route
      visible
      title="Notifications"
      onClose={close}
      footer={
        alerts.length ? (
          <>
            {navigationError ? (
              <Notice tone="error">{navigationError}</Notice>
            ) : null}
            <Button
              variant="secondary"
              onPress={markAllRead}
              disabled={unread === 0}
            >
              Mark all as read
            </Button>
            <Button variant="text" onPress={confirmClear}>
              Delete all
            </Button>
          </>
        ) : undefined
      }
    >
      {alerts.length ? (
        <BentoCard flush>
          {alerts.map((entry, index) => {
            const title = alertTitle(entry.kind);
            const line = alertLine(entry);
            const time = timeLabel(entry.at);
            return (
              <ListRow
                key={entry.id}
                revealKey={
                  installationId + ":" + entry.deviceId + ":" + entry.id
                }
                divider={index > 0}
                icon={entry.read ? "bell" : "bell-dot"}
                title={title}
                meta={time}
                stackMeta={width < 480}
                lines={[line]}
                trailingAction={
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {!entry.read ? (
                      <IconButton
                        icon="check"
                        accessibilityLabel="Mark notification as read"
                        onPress={() => void markRead(entry.id)}
                      />
                    ) : null}
                    <IconButton
                      icon="trash-2"
                      accessibilityLabel="Delete notification"
                      onPress={() => void remove(entry.id)}
                    />
                  </View>
                }
                onPress={() => {
                  void markRead(entry.id);
                  // A feeding outcome opens its history run for that feeder.
                  const runId = entry.sequenceId;
                  if (runId) void openFeeding(entry.deviceId, runId);
                }}
                accessibilityLabel={`${title}, ${line}, ${time} · phone time${entry.read ? "" : ", unread"}`}
                accessibilityHint={
                  entry.sequenceId ? "Opens the feeding details" : undefined
                }
              />
            );
          })}
        </BentoCard>
      ) : (
        <Text style={Typography.supporting}>You’re all caught up.</Text>
      )}
    </Sheet>
  );
}
