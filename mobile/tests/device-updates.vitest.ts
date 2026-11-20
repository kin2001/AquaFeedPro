// Task 8 Task 4 pilot: provider plus Home + Schedules + History + Detail +
// Command + Contact + Alerts pilot (parent ruling).
// Static pilot gate — no new deps, runs with plain node.
// Parent ruling: legacy stays running alongside, no removal this slice;
// zero-legacy is the final slice exit gate, not this slice.
// Keeps: 5s display clock, 45s contact expiry, legacy helper + dashboard poll.
// Requires this slice: provider wired in layout, Home pilot registers via
// useDeviceUpdates, provider-level 1/2/4/8/16/30s reconnect with
// remove-before-replace plus stop-timers-on-blur, 100-hit coalescing,
// scope by install and auth.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );

const layout = read("mobile/src/app/_layout.tsx");
const updates = read("mobile/src/lib/device-updates.tsx");
const updateState = read("mobile/src/lib/device-update-state.ts");
const changes = read("mobile/src/lib/device-changes.ts");
const accessState = read("mobile/src/lib/device-access-state.ts");
const home = read("mobile/src/app/(tabs)/index.tsx");
const schedule = read("mobile/src/app/(tabs)/schedule.tsx");
const history = read("mobile/src/app/(tabs)/history.tsx");
const detail = read("mobile/src/app/devices/[deviceId].tsx");
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

// Pilot cutover: provider wired, Home pilot invalidates through it,
// legacy stays alongside (final slice removes it).
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
  "home-legacy-alongside",
  home.includes("home-monitoring-") &&
    home.includes("device_telemetry") &&
    home.includes("}, 15_000)"),
  "Home pilot keeps legacy channel+poll alongside provider (phased removal)",
);
check(
  "schedule-legacy-alongside",
  schedule.includes("subscribeDeviceChanges") &&
    schedule.includes("schedule-configuration-"),
  "Schedule legacy stays alongside provider (phased removal)",
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
  "Schedules pilot registers configuration reader with schedules focus",
);
check(
  "history-uses-provider",
  history.includes("useDeviceUpdates") &&
    history.includes("registerDeviceUpdateReader"),
  "History invalidates through useDeviceUpdates, not direct channels",
);
check(
  "history-registers-history",
  history.includes('"history"') && history.includes('focus: "history"'),
  "History pilot registers history reader with history focus",
);
check(
  "history-legacy-alongside",
  history.includes("readHistoryPage") && history.includes("onRefresh"),
  "History legacy read+refresh stays alongside provider (phased removal)",
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
  "detail-legacy-alongside",
  detail.includes("refreshDevices") &&
    detail.includes("Refresh device details"),
  "Detail legacy refresh stays alongside provider (phased removal)",
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
  "Command pilot registers feeding reader with command focus",
);
check(
  "command-legacy-alongside",
  confirm.includes("subscribeDeviceChanges") &&
    confirm.includes("feed-progress-") &&
    confirm.includes("feed_sequences"),
  "Command legacy channel stays alongside provider (phased removal)",
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
  "Contact pilot re-reads the applied configuration snapshot on hints",
);
check(
  "contact-legacy-alongside",
  contact.includes("refreshDevices") && contact.includes("readConfiguration"),
  "Contact legacy focus refresh + applied-config read stay alongside provider (phased removal)",
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
  "alerts-legacy-alongside",
  alerts.includes("refreshAlerts") && alerts.includes("refreshDevices"),
  "Alerts legacy refresh + revoked-device refresh stay alongside provider (phased removal)",
);
check(
  "legacy-helper-kept-this-slice",
  changes.includes("export function subscribeDeviceChanges"),
  "Legacy helper stays this slice; final slice retires it",
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
    `\nPILOT gate: ${failures.length} missing — ${failures.join(", ")}`,
  );
  process.exit(1);
}
console.log(
  "\nPILOT gate GREEN: provider plus Home + Schedules + History + Detail + Command + Contact + Alerts pilot hold.",
);
