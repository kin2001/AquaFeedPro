import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { useDeviceAccess } from "@/lib/device-access";

export default function HomeScreen() {
  const { selectedDevice } = useDeviceAccess();
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Home" description="Your selected feeder." />
      <DevicePicker />
      {selectedDevice ? (
        <EmptyState
          icon="waves"
          title={selectedDevice.alias ?? selectedDevice.model}
          description={`Protocol 2 device access is ready. Live readings and feeder controls are not available in this delivery.`}
          action="Manage devices"
          href="/device"
        />
      ) : (
        <EmptyState
          icon="waves"
          title="Pair a feeder to get started"
          description="Pairing gives this installation access to a device profile."
        />
      )}
    </AppPage>
  );
}
