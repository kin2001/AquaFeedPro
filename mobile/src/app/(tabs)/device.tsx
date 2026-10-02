import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";

export default function DeviceScreen() {
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Device" description="Manage your paired feeders." />
      <EmptyState
        icon="cpu"
        title="No devices yet"
        description="Add a feeder to see its details and manage it here."
      />
    </AppPage>
  );
}
