import { AppState } from "react-native";

import { supabase } from "@/lib/supabase";

/** Refetch hints for table changes, rejoin/resume, and failed-Realtime fallback; never trusts row payloads. */
export function subscribeDeviceChanges(
  name: string,
  deviceId: string,
  tables: readonly string[],
  onChange: () => void,
): () => void {
  let active = true;
  let subscribed = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!active || AppState.currentState !== "active") return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      if (active && AppState.currentState === "active") onChange();
    }, 250);
  };
  const channel = tables
    .reduce(
      (current, table) =>
        current.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: "device_id=eq." + deviceId,
          },
          schedule,
        ),
      supabase.channel(name + "-" + deviceId),
    )
    .subscribe((status) => {
      subscribed = status === "SUBSCRIBED";
      // Realtime does not replay rows missed while disconnected.
      if (subscribed) schedule();
    });
  const poll = setInterval(() => {
    if (!subscribed) schedule();
  }, 15_000);
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") schedule();
  });

  return () => {
    active = false;
    if (debounce) clearTimeout(debounce);
    clearInterval(poll);
    appState.remove();
    void supabase.removeChannel(channel);
  };
}
