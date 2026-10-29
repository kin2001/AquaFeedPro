export type AppearancePreference = "system" | "light" | "dark";
export type MotionPreference = "on" | "off";
export type ColorScheme = "light" | "dark";
export type UiPreferenceKey = "appearance" | "motion";

export type UiPreferences = {
  appearance: AppearancePreference;
  motion: MotionPreference;
};

export type UiPreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  appearance: "system",
  motion: "on",
};

const STORAGE_KEYS: Record<UiPreferenceKey, string> = {
  appearance: "aquafeedpro.ui.appearance",
  motion: "aquafeedpro.ui.motion",
};

function readPreference<T extends string>(
  storage: UiPreferenceStorage | undefined,
  key: UiPreferenceKey,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const value = storage?.getItem(STORAGE_KEYS[key]);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadUiPreferences(
  storage?: UiPreferenceStorage,
): UiPreferences {
  return {
    appearance: readPreference(
      storage,
      "appearance",
      ["system", "light", "dark"],
      DEFAULT_UI_PREFERENCES.appearance,
    ),
    motion: readPreference(
      storage,
      "motion",
      ["on", "off"],
      DEFAULT_UI_PREFERENCES.motion,
    ),
  };
}

export function saveUiPreference<K extends UiPreferenceKey>(
  storage: UiPreferenceStorage | undefined,
  key: K,
  value: UiPreferences[K],
): boolean {
  try {
    storage?.setItem(STORAGE_KEYS[key], value);
    return storage !== undefined;
  } catch {
    return false;
  }
}

export function resolveColorScheme(
  preference: AppearancePreference,
  systemScheme: ColorScheme | null | undefined,
): ColorScheme {
  return preference === "system" ? (systemScheme ?? "light") : preference;
}

export function shouldReduceMotion(
  preference: MotionPreference,
  systemReducedMotion: boolean,
  appActive: boolean,
): boolean {
  return preference === "off" || systemReducedMotion || !appActive;
}
