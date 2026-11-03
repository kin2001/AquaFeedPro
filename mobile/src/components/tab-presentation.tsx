import { createContext, useContext, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
type SceneDescriptor = {
  route: { key: string; name: string };
  render: () => React.ReactNode;
};

/** Presentation coordinates only; Router retains the real route/data identities. */
export const TabScrubContext = createContext<{
  position: SharedValue<number>;
  preview: number | null;
} | null>(null);

export function declaredTabs<T extends { key: string; name: string }>(state: {
  routeNames: string[];
  routes: T[];
  index: number;
}) {
  return {
    index: state.routeNames.indexOf(state.routes[state.index].name),
    routes: state.routeNames.map(
      (name) =>
        state.routes.find((route) => route.name === name) ?? {
          key: name,
          name,
        },
    ),
  };
}

export function scrubPosition(x: number, width: number, count = 4) {
  "worklet";
  return Math.max(
    0,
    Math.min(count - 1, (x / Math.max(1, width)) * count - 0.5),
  );
}

export function releaseTab(
  position: number,
  previous: number,
  count: number,
  commit: (index: number) => boolean,
) {
  const next = Math.max(0, Math.min(count - 1, Math.round(position)));
  return next === previous || !commit(next) ? previous : next;
}

export function TabScene({
  descriptor,
  index,
  isFocused,
  loaded,
}: {
  descriptor: SceneDescriptor;
  index: number;
  isFocused: boolean;
  loaded: boolean;
}) {
  const scrub = useContext(TabScrubContext);
  const { width } = useWindowDimensions();
  const previewed =
    scrub?.preview !== null &&
    scrub?.preview !== undefined &&
    (index === scrub.preview || index === scrub.preview + 1);
  const [retained, setRetained] = useState(loaded || isFocused || previewed);
  if (!retained && (loaded || isFocused || previewed)) setRetained(true);
  const style = useAnimatedStyle(() => {
    const position = scrub?.position.value ?? index;
    return {
      transform: [{ translateX: (index - position) * width }],
      opacity: Math.abs(index - position) <= 1.01 ? 1 : 0,
    };
  }, [scrub, index, width]);
  if (!retained && !loaded && !isFocused && !previewed) return null;
  return (
    <Animated.View
      pointerEvents={isFocused ? "auto" : "none"}
      aria-hidden={!isFocused}
      accessibilityElementsHidden={!isFocused}
      importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
      style={[StyleSheet.absoluteFill, style]}
    >
      {descriptor.render()}
    </Animated.View>
  );
}
