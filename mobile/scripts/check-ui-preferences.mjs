import assert from "node:assert/strict";

import {
  loadUiPreferences,
  resolveColorScheme,
  saveUiPreference,
  shouldReduceMotion,
} from "../src/lib/ui-preferences.ts";
import { colorsForScheme } from "../src/constants/theme.ts";

function luminance(color) {
  const channels = color
    .match(/[\da-f]{2}/gi)
    .map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function memoryStorage(values = {}) {
  return {
    values: new Map(Object.entries(values)),
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, value);
    },
  };
}

const storage = memoryStorage();
assert.deepEqual(loadUiPreferences(storage), {
  appearance: "system",
  motion: "on",
});

saveUiPreference(storage, "appearance", "dark");
saveUiPreference(storage, "motion", "off");
assert.deepEqual(loadUiPreferences(storage), {
  appearance: "dark",
  motion: "off",
});

const corrupt = memoryStorage({
  "aquafeedpro.ui.appearance": "sepia",
  "aquafeedpro.ui.motion": "sometimes",
});
assert.deepEqual(loadUiPreferences(corrupt), {
  appearance: "system",
  motion: "on",
});

assert.deepEqual(loadUiPreferences(), {
  appearance: "system",
  motion: "on",
});
const unavailableStorage = {
  getItem() {
    throw new Error("storage unavailable");
  },
  setItem() {
    throw new Error("storage unavailable");
  },
};
assert.equal(saveUiPreference(unavailableStorage, "motion", "off"), false);
assert.deepEqual(loadUiPreferences(unavailableStorage), {
  appearance: "system",
  motion: "on",
});

assert.equal(resolveColorScheme("system", "dark"), "dark");
assert.equal(resolveColorScheme("system", null), "light");
assert.equal(resolveColorScheme("light", "dark"), "light");
assert.equal(resolveColorScheme("dark", "light"), "dark");

const lightColors = colorsForScheme(resolveColorScheme("light", "dark"));
const darkColors = colorsForScheme(resolveColorScheme("system", "dark"));
assert.equal(lightColors.switchTrackOn, "#22292C");
assert.equal(lightColors.switchThumbOn, "#FFFFFF");
assert.equal(darkColors.switchTrackOn, "#F4F6F7");
assert.equal(darkColors.switchThumbOn, "#22292C");
for (const [scheme, colors] of Object.entries({
  light: lightColors,
  dark: darkColors,
})) {
  assert.ok(
    contrastRatio(colors.switchTrackOn, colors.switchThumbOn) >= 3,
    `${scheme} enabled switch thumb and track need 3:1 contrast`,
  );
  assert.ok(
    contrastRatio(colors.switchTrackOn, colors.surface) >= 3,
    `${scheme} enabled switch track needs 3:1 contrast against its card`,
  );
  assert.ok(
    contrastRatio(colors.navSelected, colors.navSelectedBackground) >= 3,
    `${scheme} selected dock item needs 3:1 contrast`,
  );
  assert.ok(
    contrastRatio(colors.navText, colors.navDock) >= 4.5,
    `${scheme} unselected dock labels need 4.5:1 contrast`,
  );
}
assert.equal(darkColors.navDock, "#F4F6F7");
assert.equal(darkColors.navSelectedBackground, "#22292C");
assert.equal(darkColors.navSelected, "#F4F6F7");

assert.equal(shouldReduceMotion("on", false, true), false);
assert.equal(shouldReduceMotion("off", false, true), true);
assert.equal(shouldReduceMotion("on", true, true), true);
assert.equal(shouldReduceMotion("on", false, false), true);

console.log("UI preference checks passed.");
