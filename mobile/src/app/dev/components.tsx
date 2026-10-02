import { Redirect } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  PageHeading,
  StatusLabel,
  TextField,
} from "@/components/app-shell";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function ComponentPreviewRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return <ComponentPreviewScreen />;
}

function ComponentPreviewScreen() {
  const [actionCount, setActionCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [deviceName, setDeviceName] = useState("Preview feeder");
  const [amount, setAmount] = useState("");

  const countAction = () => setActionCount((count) => count + 1);

  return (
    <AppPage>
      <PageHeading
        title="Graphite Bento preview"
        description="Development-only component previews. Actions update local state; nothing contacts the network or a feeder."
      />

      <BentoCard>
        <Text style={Typography.cardTitle}>Buttons</Text>
        <Button onPress={countAction}>Primary action</Button>
        <Button variant="secondary" onPress={countAction}>
          Secondary action with a deliberately long label that wraps on a narrow
          phone screen
        </Button>
        <Button variant="text" onPress={countAction}>
          Text action
        </Button>
        <Button disabled>Disabled action</Button>
        <Button loading onPress={countAction}>
          Saving preview
        </Button>
        <Text style={[Typography.quantity, styles.localCount]}>
          Local button presses: {actionCount}
        </Text>
      </BentoCard>

      <BentoCard compact>
        <Text style={Typography.cardTitle}>Inputs</Text>
        <TextField
          label="Preview device name"
          value={deviceName}
          onChangeText={setDeviceName}
          hint="The label remains visible while the field is focused."
          autoCapitalize="words"
        />
        <TextField
          label="Example amount (g)"
          value={amount}
          onChangeText={setAmount}
          error="Enter a whole-number amount for this preview."
          hint="This field only stores text on this screen."
          keyboardType="number-pad"
        />
        <TextField
          label="Disabled example field"
          value="This value cannot be edited"
          disabled
        />
        <Button variant="secondary" onPress={countAction}>
          Action below the fields
        </Button>
      </BentoCard>

      <BentoCard>
        <Text style={Typography.cardTitle}>Status labels</Text>
        <View style={styles.statusList}>
          <StatusLabel kind="online">Connected</StatusLabel>
          <StatusLabel kind="completed">Completed</StatusLabel>
          <StatusLabel kind="pending">Pending</StatusLabel>
          <StatusLabel kind="warning">Low feed</StatusLabel>
          <StatusLabel kind="failed">Failed</StatusLabel>
          <StatusLabel kind="offline">Offline</StatusLabel>
          <StatusLabel kind="outdated">
            Outdated status with a deliberately long label that wraps on a
            narrow phone screen
          </StatusLabel>
        </View>
        <Text style={[Typography.supporting, styles.secondaryText]}>
          This status description is intentionally long to confirm that
          supporting text wraps without clipping at larger text sizes.
        </Text>
      </BentoCard>

      <EmptyState
        icon="waves"
        title="Empty state preview"
        description="This example has no paired feeder data. The action returns to the existing Device screen."
        action="Return to Device"
        href="/device"
      />

      <ErrorState
        title="Error state preview"
        description="A local error example. Retry only updates the counter shown below."
        retryLabel="Retry local example"
        onRetry={() => setRetryCount((count) => count + 1)}
      />
      <Text style={[Typography.quantity, styles.localCount]}>
        Local retry presses: {retryCount}
      </Text>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  statusList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  localCount: {
    color: Colors.light.text,
  },
  secondaryText: {
    color: Colors.light.textSecondary,
  },
});
