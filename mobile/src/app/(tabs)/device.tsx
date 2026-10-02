import {
  AppPage,
  BentoCard,
  EmptyState,
  LinkButton,
  PageHeading,
} from "@/components/app-shell";
import { Text } from "react-native";

import { Colors, Typography } from "@/constants/theme";

export default function DeviceScreen() {
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Device" description="Manage your paired feeders." />
      <EmptyState
        icon="cpu"
        title="No devices yet"
        description="Add a feeder to see its details and manage it here."
      />
      {__DEV__ ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>
            Component previews (development only)
          </Text>
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            Exercise the shared kit with local preview state. No network or
            feeder actions are connected.
          </Text>
          <LinkButton href="/dev/components" variant="secondary">
            Open component previews
          </LinkButton>
        </BentoCard>
      ) : null}
    </AppPage>
  );
}
