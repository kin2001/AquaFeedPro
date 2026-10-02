import {
  AppPage,
  BackAction,
  EmptyState,
  PageHeading,
} from "@/components/app-shell";

export default function FeedingDetailsScreen() {
  return (
    <AppPage>
      <BackAction label="Back" fallback="/history" />
      <PageHeading title="Feeding details" />
      <EmptyState
        icon="history"
        title="Feeding record unavailable"
        description="There are no paired feeders or feeding records to show for this link."
        action="Go to History"
        href="/history"
      />
    </AppPage>
  );
}
