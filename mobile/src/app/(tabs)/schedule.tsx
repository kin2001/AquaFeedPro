import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { useDeviceAccess } from "@/lib/device-access";

export default function ScheduleScreen() {
  const { selectedDevice } = useDeviceAccess();
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="Schedule"
        description="Schedules belong to the selected feeder."
      />
      <DevicePicker />
      <EmptyState
        icon="calendar-clock"
        title={selectedDevice ? "Schedule controls unavailable" : "No selected feeder"}
        description={selectedDevice
          ? "This delivery selects and manages device access. Schedule changes are not available here."
          : "Pair a feeder, then select it before managing its schedules."}
        action={selectedDevice ? "Manage devices" : "Pair a device"}
        href={selectedDevice ? "/device" : "/devices/add"}
      />
    </AppPage>
  );
}
