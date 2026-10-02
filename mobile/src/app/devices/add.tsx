import {
  AppPage,
  BackAction,
  EmptyState,
  PageHeading,
} from "@/components/app-shell";

export default function AddDeviceScreen() {
  return (
    <AppPage>
      <BackAction label="Back" fallback="/device" />
      <PageHeading title="Add device" />
      <EmptyState
        icon="cpu"
        title="Pairing isn’t available yet"
        description="You can return to Device and come back when feeder pairing is ready."
        action="Back to Device"
        href="/device"
      />
    </AppPage>
  );
}
