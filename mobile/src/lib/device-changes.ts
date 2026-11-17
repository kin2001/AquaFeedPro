import { AppState } from "react-native";

import { parseDeviceUpdateHint } from "./device-update-state";
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

/** Private native Broadcast adapter; deliberately unwired until owner integration. */
export function subscribeDeviceUpdates(
  _name: string,
  deviceId: string,
  onHint: (hint: unknown) => void,
  onConnection: (status: "joined" | "degraded") => void,
): () => void {
  let active = true;
  const channel = supabase.channel(`device:${deviceId}:updates`, {
    config: { private: true },
  });
  channel
    .on("broadcast", { event: "resource_update" }, (value: unknown) => {
      if (
        !active ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      )
        return;
      const message = value as Record<string, unknown>;
      const payload = message.payload;
      if (
        message.type !== "broadcast" ||
        message.event !== "resource_update" ||
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload)
      )
        return;
      const envelope = payload as Record<string, unknown>;
      if (
        Object.keys(envelope).length !== 4 ||
        !["id", "device_id", "resources", "revisions"].every((key) =>
          Object.hasOwn(envelope, key),
        ) ||
        typeof envelope.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          envelope.id,
        )
      )
        return;
      const hint = parseDeviceUpdateHint(
        {
          device_id: envelope.device_id,
          resources: envelope.resources,
          revisions: envelope.revisions,
        },
        deviceId,
      );
      if (hint) onHint(hint);
    })
    .subscribe((status) => {
      if (!active) return;
      if (status === "SUBSCRIBED") onConnection("joined");
      else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      )
        onConnection("degraded");
    });

  return () => {
    if (!active) return;
    active = false;
    void supabase.removeChannel(channel);
  };
}
