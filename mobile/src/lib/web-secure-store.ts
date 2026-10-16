// Browser preview stand-in for expo-secure-store; metro.config.js aliases it on web only.
// shortcut: development builds keep values in localStorage, which is not secure storage.
// Outside development it reports unavailable, so the app stays blocked on web.
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = undefined;

function store() {
  // The static page render runs in Node, where there is nothing to read or keep.
  if (typeof localStorage === "undefined") return null;
  if (!__DEV__) throw new Error("Secure storage is unavailable on web.");
  return localStorage;
}

export async function isAvailableAsync() {
  return __DEV__;
}

export async function getItemAsync(key: string) {
  return store()?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string) {
  store()?.setItem(key, value);
}

export async function deleteItemAsync(key: string) {
  store()?.removeItem(key);
}
