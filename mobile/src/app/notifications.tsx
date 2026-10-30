import { router, useFocusEffect } from "expo-router";
import { Alert, Platform, useWindowDimensions } from "react-native";
import { ThemedText as Text } from "@/components/theme-provider";
import { useCallback } from "react";

import {
  BentoCard,
  Button,
  EmptyState,
  IconButton,
  ListRow,
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
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeStyle: "short",
  }).format(date);
  return `${day} · ${time}`;
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
  const { width, fontScale } = useWindowDimensions();
  const alerts = useAlerts();
  const unread = useUnreadCount();
  const { installationId, devices, refreshDevices, selectDevice } =
    useDeviceAccess();
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
      visible
      title="Notifications"
      onClose={close}
      footer={
        alerts.length ? (
          <>
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
      <Text style={Typography.supporting}>
        Event times in {phoneZone} · phone time
      </Text>
      {alerts.length ? (
        <BentoCard flush>
          {alerts.map((entry, index) => {
            const title = alertTitle(entry.kind);
            const line = alertLine(entry);
            const time = timeLabel(entry.at);
            return (
              <ListRow
                key={entry.id}
                divider={index > 0}
                icon={
                  entry.kind === "feeding_unknown"
                    ? "circle-help"
                    : "triangle-alert"
                }
                title={title}
                meta={time}
                stackMeta={width < 480 || fontScale > 1.3}
                lines={[line]}
                footer={
                  <Text style={Typography.pill}>
                    {entry.read ? "Read" : "Unread"}
                  </Text>
                }
                trailingAction={
                  <IconButton
                    icon="trash-2"
                    accessibilityLabel={`Delete ${title}, ${entry.deviceName}`}
                    onPress={() => remove(entry.id)}
                  />
                }
                onPress={() => {
                  markRead(entry.id);
                  // A feeding outcome opens its history run for that feeder.
                  const runId = entry.sequenceId;
                  if (runId)
                    void selectDevice(entry.deviceId)
                      .then(() =>
                        router.push({
                          pathname: "/history/[runId]",
                          params: { runId, device_id: entry.deviceId },
                        }),
                      )
                      .catch(() => undefined);
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
        <EmptyState
          icon="bell"
          title="No notifications yet"
          description="Saved feeder alerts will appear here."
        />
      )}
    </Sheet>
  );
}
