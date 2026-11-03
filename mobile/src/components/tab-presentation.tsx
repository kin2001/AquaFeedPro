import { createContext, useCallback, useContext, useState } from "react";
import {
  Animated as LegacyAnimated,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Colors } from "@/constants/theme";
import { useSkeletonPulse } from "./motion";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
type SceneDescriptor = {
  route: { key: string; name: string };
  render: () => React.ReactNode;
};

export const TabSceneReadyContext = createContext<(() => void) | null>(null);

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

/** Skeleton cover until the real scene signals mount. Same pulse as in-content
 * skeletons; announcement preserved through the accessible label. */
function Ph({ opacity, style }: { opacity: object; style: object }) {
  return <LegacyAnimated.View style={[style, { opacity }]} />;
}

function SceneSkeleton({ live, slot }: { live: boolean; slot: number }) {
  const opacity = useSkeletonPulse();
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="Loading page"
      aria-busy
      accessibilityLiveRegion={live ? "polite" : "none"}
      style={[StyleSheet.absoluteFill, styles.skeletonCover]}
    >
      {slot === 0 ? (
        <>
          <Ph opacity={opacity} style={styles.skeletonHeader} />
          <Ph opacity={opacity} style={styles.skeletonDo} />
          <Ph opacity={opacity} style={styles.skeletonPanel} />
          <Ph opacity={opacity} style={styles.skeletonButton} />
          <Ph opacity={opacity} style={styles.skeletonRowItem} />
        </>
      ) : slot === 2 ? (
        <>
          <Ph opacity={opacity} style={styles.skeletonTitle} />
          <View style={styles.skeletonRow}>
            <Ph opacity={opacity} style={styles.skeletonHalf} />
            <Ph opacity={opacity} style={styles.skeletonHalf} />
          </View>
          <Ph opacity={opacity} style={styles.skeletonRowItem} />
          <Ph opacity={opacity} style={styles.skeletonRowItem} />
        </>
      ) : (
        <>
          <Ph opacity={opacity} style={styles.skeletonTitle} />
          <Ph opacity={opacity} style={styles.skeletonCard} />
          <Ph opacity={opacity} style={styles.skeletonRowItem} />
          <Ph opacity={opacity} style={styles.skeletonRowItem} />
        </>
      )}
    </View>
  );
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
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
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
      <TabSceneReadyContext.Provider value={markReady}>
        {descriptor.render()}
      </TabSceneReadyContext.Provider>
      {!ready ? <SceneSkeleton live={isFocused} slot={index} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  skeletonCover: {
    backgroundColor: Colors.light.background,
    padding: 16,
    gap: 12,
  },
  skeletonTitle: {
    width: "40%",
    height: 20,
    borderRadius: 6,
    backgroundColor: Colors.light.border,
  },
  skeletonCard: {
    height: 148,
    borderRadius: 14,
    backgroundColor: Colors.light.border,
  },
  skeletonShort: {
    height: 112,
  },
  skeletonHero: {
    height: 248,
    borderRadius: 14,
    backgroundColor: Colors.light.border,
  },
  skeletonHeader: {
    height: 30,
    width: "55%",
    borderRadius: 6,
    backgroundColor: Colors.light.border,
  },
  skeletonDo: {
    height: 268,
    borderRadius: 14,
    backgroundColor: Colors.light.border,
  },
  skeletonPanel: {
    height: 190,
    borderRadius: 14,
    backgroundColor: Colors.light.border,
  },
  skeletonButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.light.border,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: 12,
  },
  skeletonHalf: {
    flex: 1,
    height: 118,
    borderRadius: 14,
    backgroundColor: Colors.light.border,
  },
  skeletonRowItem: {
    height: 64,
    borderRadius: 12,
    backgroundColor: Colors.light.border,
  },
});
