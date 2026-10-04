import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { useDeviceAccess } from "@/lib/device-access";

export default function ScheduleScreen() {
  const { selectedDevice } = useDeviceAccess();
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="Schedule"
        description="Plan feedings for the selected feeder."
      />
      <DevicePicker />
      <EmptyState
        icon="calendar-clock"
        title={
          selectedDevice
            ? "Schedule controls unavailable"
            : "No feeder selected"
        }
        description={
          selectedDevice
            ? "Schedule controls aren't available yet."
            : "Pair a feeder, then select it to view schedules."
        }
        action={selectedDevice ? "Manage devices" : "Pair a device"}
        href={selectedDevice ? "/device" : "/devices/add"}
      />
    </AppPage>
  );
}
