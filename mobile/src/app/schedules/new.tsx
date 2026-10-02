import {
  AppPage,
  BackAction,
  EmptyState,
  PageHeading,
} from "@/components/app-shell";

export default function NewScheduleScreen() {
  return (
    <AppPage>
      <BackAction label="Back" fallback="/schedule" />
      <PageHeading title="Add schedule" />
      <EmptyState
        icon="calendar-clock"
        title="A paired feeder is required"
        description="Pair a feeder before adding automatic feeding times."
      />
    </AppPage>
  );
}
