import {
  AppPage,
  BackAction,
  EmptyState,
  PageHeading,
} from "@/components/app-shell";

export default function DeviceDetailsScreen() {
  return (
    <AppPage>
      <BackAction label="Back" fallback="/device" />
      <PageHeading title="Device details" />
      <EmptyState
        icon="cpu"
        title="Device unavailable"
        description="There are no paired feeders to show for this link."
        action="Go to Device"
        href="/device"
      />
    </AppPage>
  );
}
