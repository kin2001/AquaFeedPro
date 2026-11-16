import { Lucide } from "@react-native-vector-icons/lucide";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import {
  BentoCard,
  Button,
  ListRow,
  Notice,
  Sheet,
  StatusLabel,
  TextField,
} from "@/components/app-shell";
import { zoneOffsetLabel } from "@/components/feed-status";
import { Colors, IconSize, Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import { useFeederSettings } from "@/lib/feeder-settings";
import { emptyReportingBaseline } from "@/lib/schedules";
import { oxygenReportIntervals } from "@/lib/monitoring";

const titles: Record<string, string> = {
  timezone: "Time zone",
  oxygen: "Oxygen limits",
  feed: "Low-feed alert",
  reporting: "Oxygen reporting",
};

export default function FeederSettingScreen() {
  const { field: rawField } = useLocalSearchParams<{ field: string }>();
  const field = Array.isArray(rawField) ? rawField[0] : rawField;
  const { selectedDeviceId, selectedDevice } = useDeviceAccess();
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
      <Sheet route visible title={title ?? "Settings"} onClose={close}>
        <Notice tone="info">Choose a feeder in Settings first.</Notice>
      </Sheet>
    );
  }

  const applied = activeSettings?.configuration?.applied_snapshot;
  const capable = selectedDevice?.capabilities.independentTelemetry === true;
  const baseline =
    field === "reporting" && capable
      ? emptyReportingBaseline(
          activeSettings?.configuration ?? null,
          activeSettings?.pendingLocal ?? true,
        )
      : null;
  const intervalText = (value: number | null | undefined) =>
    value == null
      ? "Not configured"
      : value < 3600
        ? `${value} seconds`
        : `${value / 3600} ${value === 3600 ? "hour" : "hours"}`;
  const fieldDisabled = disabled || (field === "reporting" && !capable);

  return (
    <Sheet
      route
      visible
      title={title}
      onClose={close}
      footer={
        activeSettings && (applied || baseline) ? (
          <Button
            onPress={() => requestSaveSettings(field)}
            loading={activeSettings.busy}
            disabled={fieldDisabled}
          >
            Save
          </Button>
        ) : undefined
      }
    >
      <View style={styles.body}>
        {selectedDevice ? (
          <Text style={Typography.cardTitle}>
            {selectedDevice.alias?.trim() || selectedDevice.model}
          </Text>
        ) : null}
        <Text style={Typography.supporting}>
          {field === "reporting"
            ? "Routine oxygen uploads only. This does not slow commands, results or device contact, or make old readings fresh."
            : field === "timezone"
              ? "New schedule edits use Philippine time. Existing timers keep their applied time zone until the feeder acknowledges a migration."
              : field === "oxygen"
                ? "Alerts use these limits when a fresh oxygen reading is available. Leave a limit blank to turn it off."
                : "Alert when remaining feed falls below this percentage. Leave blank to turn it off."}
        </Text>
        {field === "reporting" && !capable ? (
          <Notice tone="info">
            Unsupported by this feeder’s verified profile.
          </Notice>
        ) : null}
        {selectedDevice?.contactFreshness !== "fresh" ? (
          <Notice tone="warning">
            Feeder offline or contact unverified. Changes are disabled; an
            already recorded request remains pending until acknowledged.
          </Notice>
        ) : null}
        {field === "reporting" ? (
          <BentoCard>
            <Text
              style={Typography.supporting}
            >{`Device-applied: ${intervalText(applied?.oxygen_report_interval_seconds)}`}</Text>
            <Text
              style={Typography.supporting}
            >{`Requested: ${intervalText(activeSettings?.configuration?.desired_snapshot?.oxygen_report_interval_seconds)}`}</Text>
          </BentoCard>
        ) : null}
        {activeSettings?.configuration?.applied_snapshot ||
        baseline ? null : activeSettings?.configuration ? (
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
        {activeSettings && (applied || baseline) ? (
          field === "reporting" ? (
            <BentoCard flush>
              {oxygenReportIntervals.map((seconds, index) => (
                <ListRow
                  key={seconds}
                  divider={index > 0}
                  title={intervalText(seconds)}
                  accessibilityLabel={
                    intervalText(seconds) +
                    (activeSettings.reporting === String(seconds)
                      ? ", selected"
                      : "")
                  }
                  disabled={fieldDisabled}
                  trailing={
                    activeSettings.reporting === String(seconds) ? (
                      <Lucide
                        name="check"
                        size={IconSize.default}
                        color={Colors.light.ink}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        aria-hidden
                      />
                    ) : undefined
                  }
                  onPress={() =>
                    updateSettingsField("reporting", String(seconds))
                  }
                />
              ))}
            </BentoCard>
          ) : field === "timezone" ? (
            <>
              <Text
                style={Typography.supporting}
              >{`Applied time zone: ${applied?.timezone ?? "Not configured"}`}</Text>
              {applied?.timezone !== "Asia/Manila" ? (
                <Notice tone="warning">
                  Migration required for new schedule edits. Existing timers may
                  still run. Migrating preserves their clock times, but UTC
                  execution instants may change. No change is applied until the
                  feeder acknowledges the revision.
                </Notice>
              ) : null}
              <BentoCard flush>
                {[{ zone: "Asia/Manila", label: "Philippines" }].map(
                  ({ zone, label }, index) => {
                    const selected = zone === activeSettings.timezone;
                    const offset = zoneOffsetLabel(zone);
                    const active = zone === applied?.timezone;
                    return (
                      <ListRow
                        key={zone}
                        revealKey={selectedDeviceId + ":zone:" + zone}
                        divider={index > 0}
                        title={label}
                        meta={active ? "Active" : undefined}
                        lines={[offset ? zone + " · " + offset : zone]}
                        trailing={
                          selected ? (
                            <Lucide
                              accessibilityElementsHidden
                              importantForAccessibility="no-hide-descendants"
                              aria-hidden
                              name="check"
                              size={IconSize.default}
                              color={Colors.light.ink}
                            />
                          ) : undefined
                        }
                        accessibilityLabel={
                          label +
                          ", " +
                          zone +
                          (offset ? ", " + offset : "") +
                          (active ? ", active" : "") +
                          (selected ? ", selected" : "")
                        }
                        disabled={disabled}
                        onPress={() => updateSettingsField("timezone", zone)}
                      />
                    );
                  },
                )}
              </BentoCard>
            </>
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
