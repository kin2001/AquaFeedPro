import { router } from "expo-router";
import { Alert, Platform, Text } from "react-native";

import {
  BentoCard,
  Button,
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
  useAlerts,
} from "@/lib/alerts";

const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function timeLabel(at: string) {
  const date = new Date(at);
  const day = relativeDayLabel(date, phoneZone);
  return day === "Today"
    ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date)
    : day;
}

function confirmClear() {
  const title = "Delete all notifications?";
  const description = "This removes every notification from this phone.";
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
  const alerts = useAlerts();
  const unread = alerts.filter((entry) => !entry.read).length;
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
                icon={entry.read ? "bell" : "bell-dot"}
                title={title}
                meta={time}
                lines={[line]}
                trailing={
                  <IconButton
                    icon="trash-2"
                    accessibilityLabel="Delete notification"
                    onPress={() => remove(entry.id)}
                  />
                }
                onPress={() => markRead(entry.id)}
                accessibilityLabel={`${title}, ${line}, ${time}${entry.read ? "" : ", unread"}`}
              />
            );
          })}
        </BentoCard>
      ) : (
        <Text style={Typography.supporting}>No notifications yet.</Text>
      )}
    </Sheet>
  );
}
