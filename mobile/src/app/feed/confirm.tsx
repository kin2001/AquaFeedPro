import {
  AppPage,
  BackAction,
  DisabledButton,
  PageHeading,
} from "@/components/app-shell";
import { StyleSheet, Text, View } from "react-native";

import { Colors } from "@/constants/theme";

export default function FeedConfirmationScreen() {
  return (
    <AppPage edges={["top", "left", "right", "bottom"]}>
      <BackAction label="Cancel" fallback="/" />
      <PageHeading title="Feed now?" />
      <View style={styles.notice}>
        <Text style={styles.message}>
          A paired feeder is required before feeding can be confirmed.
        </Text>
      </View>
      <DisabledButton icon="utensils">Confirm feed</DisabledButton>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: Colors.light.backgroundElement,
    borderColor: Colors.light.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  message: {
    color: Colors.light.text,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 24,
  },
});
