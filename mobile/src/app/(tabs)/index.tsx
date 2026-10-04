import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { useDeviceAccess } from "@/lib/device-access";

export default function HomeScreen() {
  const { selectedDevice } = useDeviceAccess();
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Home" />
      <DevicePicker />
      {selectedDevice ? (
        <EmptyState
          icon="waves"
          title={selectedDevice.alias ?? selectedDevice.model}
          description="Live readings and feeding controls aren't available yet."
          action="Manage devices"
          href="/device"
        />
      ) : (
        <EmptyState
          icon="waves"
          title="Pair a feeder to get started"
          description="Add a feeder from Device to connect it to this app."
        />
      )}
    </AppPage>
  );
}
