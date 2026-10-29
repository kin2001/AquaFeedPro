import { Lucide } from "@react-native-vector-icons/lucide";
import { Tabs } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { Animated, Keyboard, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MotionPressable, useMotionValue } from "@/components/motion";
import { useAppTheme } from "@/components/theme-provider";
import { IconSize, InterFamilies, Spacing } from "@/constants/theme";

const icons = {
  index: "house",
  schedule: "calendar-clock",
  history: "history",
  device: "settings",
} as const;

const dockHeight = 84;
const dockPadding = 6;
const itemGap = 4;
type FloatingTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];
type DockItemProps = Pick<
  FloatingTabBarProps,
  "state" | "descriptors" | "emitter" | "navigateToTab"
> & {
  route: FloatingTabBarProps["state"]["routes"][number];
  index: number;
};

function DockItem({
  route,
  index,
  state,
  descriptors,
  emitter,
  navigateToTab,
}: DockItemProps) {
  const focused = state.index === index;
  const { colors, scheme } = useAppTheme();
  const options = descriptors[route.key].options;
  const label =
    typeof options.tabBarLabel === "string"
      ? options.tabBarLabel
      : (options.title ?? route.name);
  const color = focused ? colors.navSelected : colors.navText;
  const icon = options.tabBarIcon?.({ focused, color, size: IconSize.nav });
  const ripple =
    scheme === "dark" ? "rgba(32, 39, 42, 0.12)" : colors.rippleOnInk;
  const feedback = scheme === "dark" ? ripple : colors.onInk;

  return (
    <MotionPressable
      accessibilityRole="tab"
      accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
      accessibilityState={{ selected: focused }}
      testID={options.tabBarButtonTestID}
      onPress={() => {
        const event = emitter.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
        if (!focused && !event.defaultPrevented) {
          navigateToTab(route.key);
        }
      }}
      onLongPress={() =>
        emitter.emit({ type: "tabLongPress", target: route.key })
      }
      android_ripple={{ color: ripple }}
      feedbackColor={feedback}
      style={styles.item}
    >
      <View
        style={styles.itemContent}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {icon ?? (
          <Lucide
            name={icons[route.name as keyof typeof icons]}
            size={IconSize.nav}
            color={color}
          />
        )}
        <Text style={[styles.label, { color }]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </MotionPressable>
  );
}

function FloatingTabBar(props: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [dockWidth, setDockWidth] = useState(0);
  const selectedIndex = useMotionValue(props.state.index, 180);
  const routeCount = props.state.routes.length;
  const itemWidth =
    routeCount > 0
      ? Math.max(
          0,
          (dockWidth - dockPadding * 2 - itemGap * (routeCount - 1)) /
            routeCount,
        )
      : 0;
  const indicatorOffset = selectedIndex.interpolate({
    inputRange: props.state.routes.map((_, index) => index),
    outputRange: props.state.routes.map(
      (_, index) => index * (itemWidth + itemGap),
    ),
  });
  const bottomGap = Math.max(insets.bottom, 8) + 8;

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.barLayer,
        { bottom: bottomGap, display: keyboardVisible ? "none" : "flex" },
      ]}
    >
      <View
        accessibilityRole="tablist"
        onLayout={(event) => setDockWidth(event.nativeEvent.layout.width)}
        style={[styles.dock, { backgroundColor: colors.navDock }]}
      >
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.selectedPill,
            {
              width: itemWidth,
              backgroundColor: colors.navSelectedBackground,
              transform: [{ translateX: indicatorOffset }],
            },
          ]}
        />
        {props.state.routes.map((route, index) => (
          <DockItem
            key={route.key}
            route={route}
            index={index}
            state={props.state}
            descriptors={props.descriptors}
            emitter={props.emitter}
            navigateToTab={props.navigateToTab}
          />
        ))}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const bottomGap = Math.max(insets.bottom, 8) + 8;

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        sceneStyle: {
          backgroundColor: colors.background,
          paddingBottom: dockHeight + bottomGap + Spacing.two,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused, color, size }) => (
            <Lucide
              name={icons.index}
              size={size}
              color={focused ? colors.navSelected : color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Schedule",
          tabBarIcon: ({ color, size }) => (
            <Lucide name={icons.schedule} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color, size }) => (
            <Lucide name={icons.history} size={size} color={color} />
          ),
        }}
      />
      {/* Preserve /device so links and back fallbacks continue to resolve. */}
      <Tabs.Screen
        name="device"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Lucide name={icons.device} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: Spacing.page,
    pointerEvents: "box-none",
  },
  dock: {
    width: "100%",
    maxWidth: 480,
    height: dockHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: itemGap,
    padding: dockPadding,
    borderRadius: 28,
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  item: {
    flex: 1,
    minWidth: 48,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  selectedPill: {
    position: "absolute",
    left: dockPadding,
    top: dockPadding,
    bottom: dockPadding,
    borderRadius: 22,
  },
  itemContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: {
    width: "100%",
    fontFamily: InterFamilies.medium,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
});
