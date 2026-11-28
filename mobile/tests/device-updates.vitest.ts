// Task 8 cutover source gate. Behavioral timing and read budgets run separately.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );

const layout = read("mobile/src/app/_layout.tsx");
const updates = read("mobile/src/lib/device-updates.tsx");
const updateState = read("mobile/src/lib/device-update-state.ts");
const accessState = read("mobile/src/lib/device-access-state.ts");
const home = read("mobile/src/app/(tabs)/index.tsx");
const schedule = read("mobile/src/app/(tabs)/schedule.tsx");
const history = read("mobile/src/app/(tabs)/history.tsx");
const detail = read("mobile/src/app/devices/[deviceId].tsx");
const feedingDetail = read("mobile/src/app/history/[runId].tsx");
const confirm = read("mobile/src/app/feed/confirm.tsx");
const contact = read("mobile/src/app/(tabs)/device.tsx");
const alerts = read("mobile/src/app/notifications.tsx");
const notificationController = read(
  "mobile/src/lib/notification-controller.tsx",
);

const failures: string[] = [];
const check = (name: string, ok: boolean, hint: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${hint}`);
  if (!ok) failures.push(name);
};

const appSources = readdirSync(new URL("../src/", import.meta.url), {
  recursive: true,
  encoding: "utf8",
}).filter((file) => /\.tsx?$/.test(file));
check(
  "no-legacy-mobile-realtime",
  appSources.every(
    (file) =>
      !/subscribeDeviceChanges|postgres_changes/.test(
        readFileSync(
          new URL(`../src/${file.replaceAll("\\", "/")}`, import.meta.url),
          "utf8",
        ),
      ),
  ),
  "Mobile uses the selected-device Broadcast adapter",
);
check(
  "no-home-network-poll",
  !/home-monitoring-|15_000/.test(home),
  "Home has no legacy channel or 15-second network timer",
);

// Already-proven budgets stay green: they guard against regressions.
check(
  "5s-display-clock-kept",
  home.includes("5_000") || home.includes("5000"),
  "Home keeps the existing 5s display clock",
);
check(
  "45s-contact-expiry-kept",
  accessState.includes("CONTACT_FRESH_MS") && accessState.includes("45_000"),
  "45s contact expiry stays in device-access-state",
);
check(
  "100-hit-coalescing",
  updates.includes("schedule(slot, 250)") &&
    updates.includes("generation") &&
    updateState.includes("highest"),
  "250ms slot coalescing with per-resource highest revisions",
);
check(
  "scope-by-install-and-auth",
  updates.includes("installationId") &&
    updates.includes("deviceId") &&
    updates.includes("scopeRevision") &&
    updates.includes("active"),
  "provider scope carries install/device/revision/active",
);

check(
  "provider-wired-in-layout",
  layout.includes("DeviceUpdatesProvider") &&
    layout.includes("subscribeDeviceUpdates"),
  "Root layout mounts DeviceUpdatesProvider with the native transport",
);
check(
  "home-uses-provider",
  home.includes("useDeviceUpdates") &&
    home.includes("registerDeviceUpdateReader"),
  "Home invalidates through useDeviceUpdates, not direct channels",
);
check(
  "schedules-uses-provider",
  schedule.includes("useDeviceUpdates") &&
    schedule.includes("registerDeviceUpdateReader"),
  "Schedules invalidates through useDeviceUpdates, not direct channels",
);
check(
  "schedules-registers-configuration",
  schedule.includes('"configuration"') &&
    schedule.includes('focus: "schedules"'),
  "Schedules registers configuration reader with schedules focus",
);
check(
  "history-uses-provider",
  history.includes("useDeviceUpdates") &&
    history.includes("registerDeviceUpdateReader"),
  "History invalidates through useDeviceUpdates, not direct channels",
);
check(
  "history-registers-feeding",
  history.includes('["feeding"]') && history.includes('focus: "history"'),
  "History registers feeding reads with History focus",
);
check(
  "history-explicit-refresh",
  history.includes("readHistoryPage") && history.includes("onRefresh"),
  "History retains explicit refresh",
);
check(
  "device-detail-uses-shared-contact",
  detail.includes("useDeviceUpdates") && detail.includes("contactFreshness"),
  "Device Detail renders the shared contact state",
);
check(
  "device-detail-leaves-feeding-slot-free",
  !detail.includes("registerDeviceUpdateReader"),
  "Device Detail leaves the feeding detail slot available",
);
check(
  "feeding-detail-owns-slot",
  feedingDetail.includes("registerDeviceUpdateReader") &&
    feedingDetail.includes('["feeding"]'),
  "Feeding detail owns its scoped feeding reader",
);
check(
  "fleet-alert-fallback",
  notificationController.includes("60_000") &&
    notificationController.includes("refreshCurrentAlerts"),
  "Notification Controller keeps the foreground fleet fallback",
);
check(
  "detail-explicit-refresh",
  detail.includes("refreshDevices") &&
    detail.includes("Refresh device details"),
  "Device detail retains explicit refresh",
);
check(
  "command-uses-provider",
  confirm.includes("useDeviceUpdates") &&
    confirm.includes("registerDeviceUpdateReader"),
  "Command invalidates through useDeviceUpdates, not direct channels",
);
check(
  "command-registers-feeding",
  confirm.includes('"feeding"') && confirm.includes('focus: "command"'),
  "Command registers feeding reader with command focus",
);
check(
  "contact-uses-provider",
  contact.includes("useDeviceUpdates") &&
    contact.includes("registerDeviceUpdateReader"),
  "Contact settings invalidates through useDeviceUpdates, not direct reads",
);
check(
  "contact-uses-shared-provider",
  contact.includes("contactFreshness") && updates.includes('"access-contact"'),
  "Overview renders contact state from the shared access owner",
);
check(
  "contact-registers-configuration",
  contact.includes("registerDeviceUpdateReader") &&
    contact.includes('"configuration"') &&
    contact.includes("readConfiguration"),
  "Contact settings reads the applied configuration snapshot on hints",
);
check(
  "contact-explicit-refresh",
  contact.includes("refreshDevices") && contact.includes("readConfiguration"),
  "Device overview retains explicit refresh and protected settings reads",
);
check(
  "controller-owns-alert-provider",
  notificationController.includes("registerDeviceUpdateReader") &&
    !alerts.includes("registerDeviceUpdateReader"),
  "Controller owns selected alerts with the Notifications sheet closed",
);
check(
  "alerts-registers-alerts",
  notificationController.includes('["alerts"]') &&
    notificationController.includes("refreshSelectedAlerts"),
  "Controller registers selected-device alert read",
);
check(
  "alerts-focus-refresh",
  alerts.includes("refreshAlerts") && alerts.includes("refreshDevices"),
  "Alerts retain focus refresh and revoked-device recovery",
);
check(
  "reconnect-schedule",
  updates.includes("1_000") &&
    updates.includes("2_000") &&
    updates.includes("4_000") &&
    updates.includes("8_000") &&
    updates.includes("16_000") &&
    updates.includes("30_000") &&
    updates.includes("AppState"),
  "1/2/4/8/16/30s reconnect backoff with AppState blur handling in provider owner",
);
if (failures.length > 0) {
  console.log(
    `\nTask 8 cutover gate: ${failures.length} missing — ${failures.join(", ")}`,
  );
  process.exit(1);
}
console.log(
  "\nTask 8 cutover gate GREEN: selected-device provider replaces legacy mobile listeners and Home polling.",
);
