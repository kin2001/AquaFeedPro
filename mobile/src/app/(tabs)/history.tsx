import { AppPage, EmptyState, PageHeading } from "@/components/app-shell";

export default function HistoryScreen() {
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="History"
        description="Review recorded feeding activity."
      />
      <EmptyState
        icon="history"
        title="No feeding history yet"
        description="Pair a feeder to begin recording feeding activity. New records will appear here when available."
      />
    </AppPage>
  );
}
