import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { useDeviceAccess } from "@/lib/device-access";

export default function HistoryScreen() {
  const { selectedDevice } = useDeviceAccess();
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="History"
        description="History belongs to the selected feeder."
      />
      <DevicePicker />
      <EmptyState
        icon="history"
        title={selectedDevice ? "History unavailable" : "No selected feeder"}
        description={
          selectedDevice
            ? "History reads are not available in this delivery."
            : "Pair a feeder, then select it before viewing its activity."
        }
        action={selectedDevice ? "Manage devices" : "Pair a device"}
        href={selectedDevice ? "/device" : "/devices/add"}
      />
    </AppPage>
  );
}
