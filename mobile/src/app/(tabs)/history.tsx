import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { useDeviceAccess } from "@/lib/device-access";

export default function HistoryScreen() {
  const { selectedDevice } = useDeviceAccess();
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="History"
        description="Feeding activity for the selected feeder."
      />
      <DevicePicker />
      <EmptyState
        icon="history"
        title={selectedDevice ? "History unavailable" : "No feeder selected"}
        description={
          selectedDevice
            ? "Feeding history isn't available yet."
            : "Pair a feeder, then select it to view activity."
        }
        action={selectedDevice ? "Manage devices" : "Pair a device"}
        href={selectedDevice ? "/device" : "/devices/add"}
      />
    </AppPage>
  );
}
