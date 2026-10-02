import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";

export default function HomeScreen() {
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Home" description="Your feeder and pond overview." />
      <EmptyState
        icon="waves"
        title="Pair a feeder to get started"
        description="Pairing lets you view dissolved oxygen, check feed inventory and see upcoming feeding."
      />
    </AppPage>
  );
}
