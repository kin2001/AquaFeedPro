import { parseDeviceUpdateHint } from "./device-update-state";
import { supabase } from "@/lib/supabase";

const leavingDeviceChannels = new Map<string, Promise<unknown>>();

/** Private Broadcast adapter. The SDK reuses a topic until its old channel leaves. */
export function subscribeDeviceUpdates(
  _name: string,
  deviceId: string,
  onHint: (hint: unknown) => void,
  onConnection: (status: "joined" | "degraded") => void,
): () => void {
  let active = true;
  let channel: ReturnType<typeof supabase.channel> | undefined;
  const join = () => {
    if (!active) return;
    channel = supabase.channel(`device:${deviceId}:updates`, {
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
  };
  const leaving = leavingDeviceChannels.get(deviceId);
  if (leaving) void leaving.then(join);
  else join();

  return () => {
    if (!active) return;
    active = false;
    if (!channel) return;
    const removal = supabase.removeChannel(channel).catch(() => {});
    leavingDeviceChannels.set(deviceId, removal);
    void removal.then(() => {
      if (leavingDeviceChannels.get(deviceId) === removal)
        leavingDeviceChannels.delete(deviceId);
    });
  };
}
