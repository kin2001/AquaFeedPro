import { Lucide } from "@react-native-vector-icons/lucide";
import {
  createStandardRouterNavigator,
  TabRouter,
  usePathname,
  type NavigatorContentProps,
} from "expo-router";
import { createJSTabsProps } from "expo-router/js-tabs";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Reanimated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  declaredTabs,
  releaseTab,
  scrubPosition,
  TabScene,
  TabScrubContext,
} from "@/components/tab-presentation";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type KeyDownEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingDockClearance } from "@/components/app-shell";
import {
  Motion,
  MotionPressable,
  TabEntryContext,
  useReducedMotion,
} from "@/components/motion";
import { Colors, InterFamilies, MaxContentWidth } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";

function DockForeground({
  selected,
  icon,
  label,
  index,
}: {
  index: number;
  selected: boolean;
  icon: (typeof icons)[keyof typeof icons];
  label: string;
}) {
  const scrub = useContext(TabScrubContext);
  const foregroundStyle = useAnimatedStyle(
    () => ({
      opacity: Math.max(
        0,
        1 -
          Math.abs(
            (scrub?.position.value ?? (selected ? index : -999)) - index,
          ),
      ),
    }),
    [scrub, index, selected],
  );
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.foreground}
    >
      <Lucide name={icon} size={21} color={Colors.light.textTertiary} />
      <Text style={styles.label}>{label}</Text>
      <Reanimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.foreground, foregroundStyle]}
      >
        <Lucide name={icon} size={21} color={Colors.light.onInk} />
        <Text style={[styles.label, { color: Colors.light.onInk }]}>
          {label}
        </Text>
      </Reanimated.View>
    </View>
  );
}

type DockProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  emitter: {
    emit: (event: {
      type: "tabPress" | "tabLongPress";
      target: string;
      canPreventDefault?: boolean;
    }) => { defaultPrevented?: boolean };
  };
  navigateToTab: (key: string) => void;
  insets: { bottom: number };
};
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
  onWidth,
  allowPress,
  onPressStart,
}: DockProps & {
  onHeight: (height: number) => void;
  onWidth?: (width: number) => void;
  allowPress?: () => boolean;
  onPressStart?: () => void;
}) {
  const [width, setWidth] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  const scrub = useContext(TabScrubContext);
  const scrubStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateX: ((scrub?.position.value ?? state.index) * width) / 4 },
      ],
    }),
    [scrub, width, state.index],
  );
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
      collapsable={false}
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
          onLayout={(event) => {
            setWidth(event.nativeEvent.layout.width);
            onWidth?.(event.nativeEvent.layout.width);
          }}
        >
          {width > 0 ? (
            <Reanimated.View
              pointerEvents="none"
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.selection, { width: width / 4 }, scrubStyle]}
            />
          ) : null}
          {state.routes.map((route, index) => {
            const selected = state.index === index;
            const options = descriptors[route.key].options;
            const activate = () => {
              const event = emitter.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!selected && !event.defaultPrevented)
                navigateToTab(route.key);
            };
            return (
              <MotionPressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={options.title ?? route.name}
                accessibilityState={{ selected }}
                onPointerDown={onPressStart}
                onTouchStart={onPressStart}
                {...(Platform.OS === "web"
                  ? {
                      onKeyDownCapture: (event: KeyDownEvent) => {
                        onPressStart?.();
                        if (event.nativeEvent.key === " " && !event.nativeEvent.repeat) {
                          event.preventDefault();
                          activate();
                        }
                      },
                    }
                  : {})}
                onPress={() => {
                  if (allowPress && !allowPress()) return;
                  activate();
                }}
                onLongPress={() =>
                  emitter.emit({ type: "tabLongPress", target: route.key })
                }
                style={styles.item}
              >
                <DockForeground
                  index={index}
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

type TabEvents = {
  tabPress: { data: undefined; canPreventDefault: true };
  tabLongPress: { data: undefined; canPreventDefault: false };
};
type ExtraTabProps = ReturnType<typeof createJSTabsProps> & {
  declaredRouteNames: string[];
  preload: (name: string) => void;
};
type TabContentProps = NavigatorContentProps<
  { title?: string },
  TabEvents,
  object,
  ExtraTabProps
>;

function ScrubbableTabs({
  state: actualState,
  descriptors,
  actions,
  emitter,
  declaredRouteNames,
  preload,
}: TabContentProps) {
  const insets = useSafeAreaInsets();
  const [clearance, onHeight] = useState(73 + insets.bottom + 12);
  const state = declaredTabs({
    ...actualState,
    routeNames: declaredRouteNames,
  });
  const { selectedDeviceId, scopeRevision } = useDeviceAccess();
  const pathname = usePathname();
  const window = useWindowDimensions();
  const scope = `${selectedDeviceId}:${scopeRevision}:${pathname}:${actualState.routes[actualState.index].key}:${window.width}:${window.height}`;
  const epoch = useSharedValue(0);
  const gestureEpoch = useSharedValue(-1);
  const position = useSharedValue(state.index);
  const trackWidth = useSharedValue(1);
  const dragging = useSharedValue(false);
  const [preview, setPreview] = useState<number | null>(null);
  const draggedPress = useRef(false);
  const requestedPreviews = useRef(new Set<string>());
  useEffect(() => {
    actualState.routes.forEach((route) =>
      requestedPreviews.current.delete(route.name),
    );
  }, [actualState.routes]);
  const beginPressDrag = useCallback(() => {
    draggedPress.current = true;
  }, []);
  const reduced = useReducedMotion();
  const settle = useCallback(
    (target: number) => {
      dragging.set(false);
      position.set(
        reduced
          ? target
          : withTiming(target, {
              duration: Motion.transition,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
      );
    },
    [dragging, position, reduced],
  );
  useLayoutEffect(() => {
    epoch.set((value) => value + 1);
    settle(state.index);
    return () => {
      dragging.set(false);
      cancelAnimation(position);
    };
  }, [scope, state.index, settle, epoch, dragging, position]);
  const commit = useCallback(
    (index: number) => {
      const route = state.routes[index];
      const event = emitter.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (event.defaultPrevented) return false;
      if (index !== state.index) actions.navigate(route.name);
      return true;
    },
    [state, emitter, actions],
  );
  const finish = useCallback(
    (fraction: number, success: boolean) => {
      setPreview(null);
      settle(
        success
          ? releaseTab(fraction, state.index, state.routes.length, commit)
          : state.index,
      );
    },
    [commit, settle, state],
  );
  const requestPreview = useCallback(
    (boundary: number) => {
      for (const index of [boundary, boundary + 1]) {
        const name = declaredRouteNames[index];
        if (
          name &&
          !actualState.routes.some((route) => route.name === name) &&
          !requestedPreviews.current.has(name)
        ) {
          requestedPreviews.current.add(name);
          preload(name);
        }
      }
      setPreview(boundary);
    },
    [declaredRouteNames, actualState.routes, preload],
  );
  useAnimatedReaction(
    () => (dragging.value ? Math.floor(position.value) : -1),
    (index, previous) => {
      if (index >= 0 && index !== previous) runOnJS(requestPreview)(index);
    },
    [position, dragging, requestPreview],
  );
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onTouchesDown((event, manager) => {
          if (event.numberOfTouches > 1) manager.fail();
        })
        .minDistance(6)
        // Gesture callbacks run on pointer activation, never during React render.
        // eslint-disable-next-line react-hooks/refs
        .onStart(() => {
          cancelAnimation(position);
          dragging.set(true);
          gestureEpoch.set(epoch.value);
          runOnJS(beginPressDrag)();
          runOnJS(requestPreview)(Math.floor(position.value));
        })
        .onUpdate((event) => {
          position.set(
            scrubPosition(event.x - 7, trackWidth.value, state.routes.length),
          );
        })
        .onFinalize((_event, success) => {
          if (dragging.value && gestureEpoch.value === epoch.value)
            runOnJS(finish)(position.value, success);
        }),
    [
      position,
      dragging,
      trackWidth,
      finish,
      state.routes.length,
      requestPreview,
      beginPressDrag,
      gestureEpoch,
      epoch,
    ],
  );
  const dockDescriptors = Object.fromEntries(
    state.routes.map((route) => [
      route.key,
      {
        options: {
          title:
            (
              {
                index: "Home",
                schedule: "Schedule",
                history: "History",
                device: "Settings",
              } as Record<string, string>
            )[route.name] ?? route.name,
        },
      },
    ]),
  );
  return (
    <GestureHandlerRootView
      style={{
        flex: 1,
        overflow: "hidden",
        backgroundColor: Colors.light.background,
      }}
    >
      <FloatingDockClearance.Provider value={clearance}>
        <TabScrubContext.Provider value={{ position, preview }}>
          {actualState.routes.map((route) => (
            <TabScene
              key={route.key}
              descriptor={{ route, render: descriptors[route.key].render }}
              index={declaredRouteNames.indexOf(route.name)}
              isFocused={
                route.key === actualState.routes[actualState.index].key
              }
              loaded={false}
            />
          ))}
          <GestureDetector gesture={pan}>
            <FloatingDock
              state={state}
              descriptors={dockDescriptors}
              emitter={{
                emit: (args) => {
                  const event = emitter.emit(args);
                  return {
                    defaultPrevented:
                      "defaultPrevented" in event && !!event.defaultPrevented,
                  };
                },
              }}
              navigateToTab={(key) => {
                const index = state.routes.findIndex(
                  (route) => route.key === key,
                );
                actions.navigate(state.routes[index].name);
              }}
              insets={insets}
              onHeight={onHeight}
              onPressStart={() => {
                draggedPress.current = false;
              }}
              allowPress={() => !draggedPress.current}
              onWidth={(width) => {
                trackWidth.set(width);
              }}
            />
          </GestureDetector>
        </TabScrubContext.Provider>
      </FloatingDockClearance.Provider>
    </GestureHandlerRootView>
  );
}

const RetainedTabs = createStandardRouterNavigator(ScrubbableTabs, TabRouter, {
  createProps: (args) => ({
    ...createJSTabsProps(args),
    declaredRouteNames: args.state.routeNames,
    preload: (name: string) =>
      args.dispatch({ type: "PRELOAD", payload: { name } }),
  }),
});

export default function TabLayout() {
  const pathname = usePathname();
  const tabIndex = ["/", "/schedule", "/history", "/device"].indexOf(pathname);
  const [entry, setEntry] = useState({ index: tabIndex, generation: 1 });
  if (tabIndex >= 0 && tabIndex !== entry.index)
    setEntry({ index: tabIndex, generation: entry.generation + 1 });
  return (
    <TabEntryContext.Provider
      value={{ kind: "tab-entry", generation: entry.generation }}
    >
      <RetainedTabs backBehavior="history" activityEnabled={false}>
        <RetainedTabs.Screen name="index" options={{ title: "Home" }} />
        <RetainedTabs.Screen name="schedule" options={{ title: "Schedule" }} />
        <RetainedTabs.Screen name="history" options={{ title: "History" }} />
        <RetainedTabs.Screen name="device" options={{ title: "Settings" }} />
      </RetainedTabs>
    </TabEntryContext.Provider>
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
