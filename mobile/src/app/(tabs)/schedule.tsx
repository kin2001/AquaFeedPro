import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";

export default function ScheduleScreen() {
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="Schedule"
        description="Set and review automatic feeding times."
      />
      <EmptyState
        icon="calendar-clock"
        title="No feeding schedules"
        description="Pair a feeder before setting up its automatic feeding times."
      />
    </AppPage>
  );
}
