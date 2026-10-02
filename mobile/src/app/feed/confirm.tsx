import {
  AppPage,
  BackAction,
  BentoCard,
  DisabledButton,
  PageHeading,
} from "@/components/app-shell";
import { Text } from "react-native";

import { Typography } from "@/constants/theme";

export default function FeedConfirmationScreen() {
  return (
    <AppPage edges={["top", "left", "right", "bottom"]}>
      <BackAction label="Cancel" fallback="/" />
      <PageHeading title="Feed now?" />
      <BentoCard>
        <Text style={Typography.body}>
          A paired feeder is required before feeding can be confirmed.
        </Text>
      </BentoCard>
      <DisabledButton icon="utensils">Confirm feed</DisabledButton>
    </AppPage>
  );
}
