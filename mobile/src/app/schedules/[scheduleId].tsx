import {
  AppPage,
  BackAction,
  EmptyState,
  PageHeading,
} from "@/components/app-shell";

export default function ScheduleDetailsScreen() {
  return (
    <AppPage>
      <BackAction label="Back" fallback="/schedule" />
      <PageHeading title="Schedule details" />
      <EmptyState
        icon="calendar-clock"
        title="Schedule unavailable"
        description="There are no paired feeders or schedules to show for this link."
        action="Go to Schedule"
        href="/schedule"
      />
    </AppPage>
  );
}
