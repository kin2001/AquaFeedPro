import { Lucide } from "@react-native-vector-icons/lucide";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";

import {
  BentoCard,
  Button,
  ListRow,
  Notice,
  Sheet,
  StatusLabel,
  TextField,
} from "@/components/app-shell";
import { Colors, IconSize, Spacing } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import { useFeederSettings } from "@/lib/feeder-settings";

const titles: Record<string, string> = {
  timezone: "Time zone",
  oxygen: "Oxygen limits",
  feed: "Low-feed alert",
};

const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// shortcut: a fixed short list; add zones here when a feeder is deployed elsewhere.
const zones = [
  { zone: "Asia/Manila", label: "Philippines" },
  { zone: phoneZone, label: "This phone" },
  { zone: "UTC", label: "UTC" },
];

export default function FeederSettingScreen() {
  const { field: rawField } = useLocalSearchParams<{ field: string }>();
  const field = Array.isArray(rawField) ? rawField[0] : rawField;
  const { selectedDeviceId } = useDeviceAccess();
  const {
    activeSettings,
    disabled,
    updateSettingsField,
    requestSaveSettings,
    checkMonitoringSettings,
  } = useFeederSettings(selectedDeviceId ?? undefined);

  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/device");

  const title = titles[field];
  if (!title || !selectedDeviceId) {
    return (
      <Sheet visible title={title ?? "Settings"} onClose={close}>
        <Notice tone="info">Select a feeder in Settings first.</Notice>
      </Sheet>
    );
  }

  const applied = activeSettings?.configuration?.applied_snapshot;
  const zoneRows = zones.filter(
    (row, index) =>
      zones.findIndex((other) => other.zone === row.zone) === index,
  );
  if (applied && !zoneRows.some((row) => row.zone === applied.timezone))
    zoneRows.push({ zone: applied.timezone, label: "Current" });

  return (
    <Sheet
      visible
      title={title}
      onClose={close}
      footer={
        activeSettings && applied ? (
          <Button
            onPress={requestSaveSettings}
            loading={activeSettings.busy}
            disabled={disabled}
          >
            Save
          </Button>
        ) : undefined
      }
    >
      <View style={styles.body}>
        {activeSettings?.configuration
          ?.applied_snapshot ? null : activeSettings?.configuration ? (
          <Notice tone="info">
            No applied configuration is available to preserve yet. Add or apply
            a schedule first.
          </Notice>
        ) : activeSettings && !activeSettings.loading ? (
          <Notice tone="info">
            The current applied configuration could not be verified. Refresh
            status before editing.
          </Notice>
        ) : null}
        {activeSettings?.configuration?.current_state.last_attempt_status ===
        "pending" ? (
          <StatusLabel kind="pending">
            {"Revision " +
              String(
                activeSettings.configuration.current_state
                  .last_attempt_revision,
              ) +
              " is pending"}
          </StatusLabel>
        ) : null}
        {activeSettings?.configuration?.current_state.last_attempt_status ===
        "rejected" ? (
          <StatusLabel kind="warning">
            Latest revision rejected; the prior applied settings remain active
          </StatusLabel>
        ) : null}
        {activeSettings &&
        !activeSettings.loading &&
        activeSettings.recoveryStatus !== "resolved" ? (
          <Notice
            tone="warning"
            actions={
              <Button
                variant="secondary"
                onPress={() => void checkMonitoringSettings()}
                loading={activeSettings.busy}
                disabled={activeSettings.busy || activeSettings.loading}
              >
                {activeSettings.pendingLocal
                  ? "Check original request"
                  : "Refresh settings status"}
              </Button>
            }
          >
            {activeSettings.pendingLocal
              ? "The original settings request may be unresolved. Check its status before editing or submitting another revision."
              : activeSettings.recoveryStatus === "unverified"
                ? "Settings status is unverified. Refresh it before editing."
                : "The latest settings revision is pending. Refresh its status before editing."}
          </Notice>
        ) : null}
        {!activeSettings || activeSettings.loading ? (
          <Notice tone="info">Loading current applied settings…</Notice>
        ) : null}
        {activeSettings?.error ? (
          <Notice tone="error">{activeSettings.error}</Notice>
        ) : null}
        {activeSettings?.notice ? (
          <Notice tone="info">{activeSettings.notice}</Notice>
        ) : null}
        {activeSettings && applied ? (
          field === "timezone" ? (
            <BentoCard flush>
              {zoneRows.map(({ zone, label }, index) => {
                const selected = zone === activeSettings.timezone;
                return (
                  <ListRow
                    key={zone}
                    divider={index > 0}
                    title={label}
                    lines={[zone]}
                    trailing={
                      selected ? (
                        <Lucide
                          name="check"
                          size={IconSize.default}
                          color={Colors.light.ink}
                        />
                      ) : undefined
                    }
                    accessibilityLabel={
                      label + ", " + zone + (selected ? ", selected" : "")
                    }
                    disabled={disabled}
                    onPress={() => updateSettingsField("timezone", zone)}
                  />
                );
              })}
            </BentoCard>
          ) : field === "oxygen" ? (
            <>
              <TextField
                label="Oxygen low limit"
                suffix="mg/L"
                hint="Leave blank to turn off."
                value={activeSettings.doLow}
                onChangeText={(value) => updateSettingsField("doLow", value)}
                keyboardType="decimal-pad"
                disabled={disabled}
              />
              <TextField
                label="Oxygen high limit"
                suffix="mg/L"
                hint="Leave blank to turn off."
                value={activeSettings.doHigh}
                onChangeText={(value) => updateSettingsField("doHigh", value)}
                keyboardType="decimal-pad"
                disabled={disabled}
              />
            </>
          ) : (
            <TextField
              label="Low-feed alert"
              suffix="%"
              hint="0 to 100. Leave blank to turn off."
              value={activeSettings.feedLow}
              onChangeText={(value) => updateSettingsField("feedLow", value)}
              keyboardType="decimal-pad"
              disabled={disabled}
            />
          )
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three },
});
