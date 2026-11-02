import { Lucide } from "@react-native-vector-icons/lucide";
import { Tabs } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { Animated, Keyboard, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingDockClearance } from "@/components/app-shell";
import { Motion, MotionPressable, useMotionValue } from "@/components/motion";
import { Colors, InterFamilies, MaxContentWidth } from "@/constants/theme";

function DockForeground({
  selected,
  icon,
  label,
}: {
  selected: boolean;
  icon: (typeof icons)[keyof typeof icons];
  label: string;
}) {
  const opacity = useMotionValue(selected ? 1 : 0, 180);
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.foreground}
    >
      <Lucide name={icon} size={21} color={Colors.light.textTertiary} />
      <Text style={styles.label}>{label}</Text>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.foreground, { opacity }]}
      >
        <Lucide name={icon} size={21} color={Colors.light.onInk} />
        <Text style={[styles.label, { color: Colors.light.onInk }]}>
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

type DockProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];
const icons = {
  index: "house",
  schedule: "calendar-clock",
  history: "history",
  device: "settings",
} as const;

export function FloatingDock({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  onHeight,
}: DockProps & { onHeight: (height: number) => void }) {
  const [width, setWidth] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  const travel = useMotionValue(state.index * (width / 4), Motion.transition);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboard(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboard(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboard) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.position, { bottom: insets.bottom + 12 }]}
    >
      <View
        style={styles.dock}
        onLayout={(event) =>
          onHeight(event.nativeEvent.layout.height + insets.bottom + 12)
        }
      >
        <View
          accessibilityRole="tablist"
          accessibilityLabel="App navigation"
          style={styles.track}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          {width > 0 ? (
            <Animated.View
              pointerEvents="none"
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.selection,
                { width: width / 4, transform: [{ translateX: travel }] },
              ]}
            />
          ) : null}
          {state.routes.map((route, index) => {
            const selected = state.index === index;
            const options = descriptors[route.key].options;
            return (
              <MotionPressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={options.title ?? route.name}
                accessibilityState={{ selected }}
                onPress={() => {
                  const event = emitter.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!selected && !event.defaultPrevented)
                    navigateToTab(route.key);
                }}
                onLongPress={() =>
                  emitter.emit({ type: "tabLongPress", target: route.key })
                }
                style={styles.item}
              >
                <DockForeground
                  selected={selected}
                  icon={icons[route.name as keyof typeof icons]}
                  label={options.title ?? route.name}
                />
              </MotionPressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [clearance, setClearance] = useState(73 + insets.bottom + 12);
  return (
    <FloatingDockClearance.Provider value={clearance}>
      <Tabs
        backBehavior="history"
        tabBar={(props) => <FloatingDock {...props} onHeight={setClearance} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: Colors.light.background },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="schedule" options={{ title: "Schedule" }} />
        <Tabs.Screen name="history" options={{ title: "History" }} />
        <Tabs.Screen name="device" options={{ title: "Settings" }} />
      </Tabs>
    </FloatingDockClearance.Provider>
  );
}

const styles = StyleSheet.create({
  position: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  dock: {
    width: "100%",
    maxWidth: MaxContentWidth,
    padding: 7,
    borderRadius: 27,
    backgroundColor: Colors.light.surface,
    boxShadow: "0px 9px 30px rgba(24,24,27,0.11)",
  },
  track: { flexDirection: "row" },
  selection: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 20,
    backgroundColor: Colors.light.ink,
  },
  item: {
    flex: 1,
    minHeight: 59,
    minWidth: 48,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 20,
  },
  foreground: { alignItems: "center", justifyContent: "center", gap: 3 },
  label: {
    fontFamily: InterFamilies.semibold,
    fontSize: 10,
    lineHeight: 14,
    color: Colors.light.textTertiary,
  },
});
