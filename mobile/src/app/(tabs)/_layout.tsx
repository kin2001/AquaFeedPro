import { Lucide } from "@react-native-vector-icons/lucide";
import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, MaxContentWidth } from "@/constants/theme";

const icons = {
  home: "house",
  schedule: "calendar-clock",
  history: "history",
  device: "cpu",
} as const;

function TabIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof icons;
  color: ColorValue;
  focused: boolean;
}) {
  return (
    <View style={[styles.iconWell, focused && styles.iconWellSelected]}>
      <Lucide name={icons[name]} size={24} color={color} />
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.light.background },
        tabBarActiveTintColor: Colors.light.text,
        tabBarInactiveTintColor: Colors.light.textSecondary,
        tabBarLabelPosition: "below-icon",
        tabBarLabelStyle: styles.label,
        tabBarStyle: [
          styles.tabBar,
          { height: 72 + insets.bottom, paddingBottom: insets.bottom },
        ],
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: (props) => <TabIcon name="home" {...props} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Schedule",
          tabBarIcon: (props) => <TabIcon name="schedule" {...props} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: (props) => <TabIcon name="history" {...props} />,
        }}
      />
      <Tabs.Screen
        name="device"
        options={{
          title: "Device",
          tabBarIcon: (props) => <TabIcon name="device" {...props} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.light.backgroundElement,
    borderTopColor: Colors.light.border,
    paddingTop: 6,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  tabItem: { minHeight: 60 },
  label: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16 },
  iconWell: {
    width: 44,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  iconWellSelected: { backgroundColor: Colors.light.backgroundSelected },
});
