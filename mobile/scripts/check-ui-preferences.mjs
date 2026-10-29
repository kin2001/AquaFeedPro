import assert from "node:assert/strict";

import {
  loadUiPreferences,
  resolveColorScheme,
  saveUiPreference,
  shouldReduceMotion,
} from "../src/lib/ui-preferences.ts";

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

assert.equal(shouldReduceMotion("on", false, true), false);
assert.equal(shouldReduceMotion("off", false, true), true);
assert.equal(shouldReduceMotion("on", true, true), true);
assert.equal(shouldReduceMotion("on", false, false), true);

console.log("UI preference checks passed.");
