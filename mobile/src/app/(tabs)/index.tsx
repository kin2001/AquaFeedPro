import {
  AppPage,
  EmptyState,
  PageHeading,
  Button,
  BentoCard,
} from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { useDeviceAccess } from "@/lib/device-access";
import { router } from "expo-router";
import { Text } from "react-native";
import { Typography } from "@/constants/theme";

export default function HomeScreen() {
  const { selectedDevice } = useDeviceAccess();
  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Home" />
      <DevicePicker />
      {selectedDevice ? (
        <>
          <BentoCard>
            <Text style={Typography.cardTitle}>
              {selectedDevice.alias || selectedDevice.model}
            </Text>
            <Text style={Typography.supporting}>
              {selectedDevice.isSimulated ? "Simulator" : "Paired feeder"} ·{" "}
              {selectedDevice.contactFreshness === "fresh"
                ? "Contact recent"
                : "Contact not recent"}
            </Text>
            <Button
              icon="utensils"
              onPress={() => router.push("/feed/confirm")}
            >
              Feed now
            </Button>
          </BentoCard>
          <EmptyState
            icon="waves"
            title="Readings unavailable"
            description="Live sensor readings aren't available yet."
          />
        </>
      ) : (
        <EmptyState
          icon="waves"
          title="Pair a feeder to get started"
          description="Add a feeder from Device to connect it to this app."
        />
      )}
    </AppPage>
  );
}
