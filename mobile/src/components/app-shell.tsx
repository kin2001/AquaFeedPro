import { router, usePathname, useIsFocused, type Href } from "expo-router";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { IconButton, Button, ListRow, Notice, Sheet } from "./bento-kit";
import { Lucide } from "@react-native-vector-icons/lucide";
import { useDeviceAccess } from "@/lib/device-access";
import { errorText } from "@/lib/error-text";
import { MotionPressable, MotionScrollView, useEntranceMotion } from "./motion";
import { TabSceneReadyContext } from "./tab-presentation";

import {
  Colors,
  ControlSize,
  IconSize,
  MaxContentWidth,
  Spacing,
  Typography,
} from "@/constants/theme";

export {
  BentoCard,
  Button,
  Chip,
  DropdownPill,
  EmptyState,
  ErrorState,
  Fab,
  FeedingRow,
  IconButton,
  KeyValue,
  LinkButton,
  ListRow,
  Notice,
  ProgressBar,
  SectionHeader,
  Segmented,
  Sheet,
  Skeleton,
  Stat,
  StatusIcon,
  StatusLabel,
  statusIcons,
  SwitchRow,
  TextField,
  Toggle,
} from "./bento-kit";

export function AppIcon({
  size,
  decorative = false,
}: {
  size: number;
  decorative?: boolean;
}) {
  return (
    <Image
      // shortcut: ships the full-size source PNG; resize to 288 px if bundle size matters.
      source={require("@/assets/images/aquafeed-app-icon.png")}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : "AquaFeed Pro"}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
      }}
    />
  );
}

export const FloatingDockClearance = createContext(0);

/** Identity stays in the scroll flow; selection uses the existing authorized API. */
export function FeederContext({
  action,
  status,
}: {
  action?: ReactNode;
  status?: ReactNode;
}) {
  const access = useDeviceAccess();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<{ scope: string; message: string } | null>(
    null,
  );
  const [selecting, setSelecting] = useState(false);
  const selectingRef = useRef(false);
  const scope = `${access.installationId}:${access.scopeRevision}`;
  const latestScope = useRef({ scope, installationId: access.installationId });
  useLayoutEffect(() => {
    latestScope.current = { scope, installationId: access.installationId };
  }, [scope, access.installationId]);
  const device = access.selectedDevice;
  const select = async (id: string) => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    setSelecting(true);
    setError(null);
    const expected = scope;
    try {
      await access.selectDevice(id);
      if (latestScope.current.installationId === access.installationId)
        setOpen(false);
    } catch (reason) {
      if (latestScope.current.scope === expected)
        setError({
          scope: expected,
          message: errorText(reason, "Could not select feeder. Try again."),
        });
    } finally {
      selectingRef.current = false;
      setSelecting(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.tabHeader}>
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={
            device
              ? `Choose feeder, ${device.alias?.trim() || device.model}`
              : "Choose feeder, none selected"
          }
          onPress={() => {
            setError(null);
            setOpen(true);
          }}
          style={{
            minHeight: 48,
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
          }}
        >
          <View style={{ flexShrink: 1, gap: 3 }}>
            <Text accessibilityRole="header" style={styles.feederName}>
              {device?.alias?.trim() || device?.model || "Select a feeder"}
            </Text>
            <Text style={Typography.metadata}>
              {device
                ? [
                    device.location,
                    device.model,
                    device.isSimulated ? "Simulator" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "No feeder selected"}
            </Text>
          </View>
          <Lucide
            name="chevron-down"
            size={16}
            color={Colors.light.textSecondary}
          />
        </MotionPressable>
        {action}
      </View>
      {status}
      <Sheet
        visible={open}
        title="Choose a feeder"
        onClose={() => setOpen(false)}
      >
        {error?.scope === scope ? (
          <Notice tone="error">{error.message}</Notice>
        ) : null}
        {access.devices.map((item) => (
          <ListRow
            key={item.deviceId}
            title={item.alias?.trim() || item.model}
            lines={[
              [item.location, item.model, item.isSimulated ? "Simulator" : null]
                .filter(Boolean)
                .join(" · "),
              `ID …${item.deviceId.slice(-6)} · ${item.contactFreshness === "fresh" ? "Recent authenticated contact" : item.contactFreshness === "stale" ? "No recent authenticated contact" : "Contact unavailable"}`,
            ]}
            meta={
              item.deviceId === access.selectedDeviceId ? "Selected" : undefined
            }
            disabled={selecting}
            onPress={() => {
              void select(item.deviceId);
            }}
          />
        ))}
        {!access.devices.length ? (
          <Text style={Typography.supporting}>
            No paired feeders. Pair a feeder to get started.
          </Text>
        ) : null}
        <Button
          variant="secondary"
          onPress={() => {
            setOpen(false);
            router.push("/device");
          }}
        >
          Manage devices
        </Button>
      </Sheet>
    </View>
  );
}

export function AppPage({
  children,
  edges = ["top", "left", "right", "bottom"],
  gap = Spacing.four,
  floating,
  header,
  onRefresh,
  refreshing,
  refreshKey,
  refreshLabel,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  gap?: number;
  floating?: ReactNode;
  header?: ReactNode;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  refreshKey?: string;
  refreshLabel?: string;
}) {
  const markSceneReady = useContext(TabSceneReadyContext);
  useLayoutEffect(() => {
    markSceneReady?.();
  }, [markSceneReady]);
  const currentPathname = usePathname();
  const focused = useIsFocused();
  const [ownedPathname, setOwnedPathname] = useState(currentPathname);
  if (focused && ownedPathname !== currentPathname)
    setOwnedPathname(currentPathname);
  // Global pathname changes on hidden tabs too; their retained layout must not change.
  const pathname = focused ? currentPathname : ownedPathname;
  const dockClearance = useContext(FloatingDockClearance);
  const tab = ["/", "/schedule", "/history", "/device"].includes(pathname);
  // Native full pages already move with the stack; web pages need their own entrance.
  const entrance = useEntranceMotion(
    pathname,
    focused && (tab || Platform.OS === "web"),
    18,
  );
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      {header && !tab ? (
        <View style={styles.headerBar}>
          <View style={styles.headerInner}>{header}</View>
        </View>
      ) : null}
      <MotionScrollView
        onRefresh={onRefresh}
        refreshing={refreshing}
        refreshKey={refreshKey}
        refreshLabel={refreshLabel}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom:
              Spacing.four + (tab ? dockClearance : 0) + (floating ? 72 : 0),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        contentStyle={[styles.page, { gap }, entrance]}
      >
        {tab ? header : null}
        {children}
      </MotionScrollView>
      {floating ? (
        <View
          style={[
            styles.floatingLayer,
            { bottom: Spacing.three + (tab ? dockClearance : 0) },
          ]}
        >
          <View style={styles.floatingSlot}>{floating}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function ScreenHeader({
  title,
  action,
  back,
  status,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  back?: { label: string; fallback: Href; icon?: "arrow-left" | "x" };
  status?: ReactNode;
}) {
  if (!back && title === "Home")
    return <FeederContext action={action} status={status} />;
  if (!back) {
    return (
      <View>
        <View style={styles.tabHeader}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text accessibilityRole="header" style={styles.tabHeaderTitle}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={Typography.metadata}>{subtitle}</Text>
            ) : null}
          </View>
          <View style={styles.headerAction}>{action}</View>
        </View>
        {status ? <View style={styles.tabHeaderStatus}>{status}</View> : null}
      </View>
    );
  }
  return (
    <View style={styles.stackHeader}>
      <IconButton
        icon={back.icon ?? "arrow-left"}
        size={IconSize.nav}
        accessibilityLabel={back.label}
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace(back.fallback)
        }
      />
      <Text accessibilityRole="header" style={styles.stackHeaderTitle}>
        {title}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.light.background },
  feederName: { ...Typography.title, fontSize: 20, letterSpacing: -0.5 },
  // Pushed screens retain their title and Back controls; tabs put context in content.
  headerBar: {
    minHeight: 64,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.page,
    paddingVertical: Spacing.two,
    backgroundColor: Colors.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerInner: { width: "100%", maxWidth: MaxContentWidth },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.page,
    paddingVertical: Spacing.four,
  },
  floatingLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Spacing.three,
    paddingHorizontal: Spacing.page,
    alignItems: "center",
    pointerEvents: "box-none",
  },
  floatingSlot: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignItems: "flex-end",
    pointerEvents: "box-none",
  },
  page: { width: "100%", maxWidth: MaxContentWidth },
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: ControlSize.minimumTarget,
  },
  tabHeaderTitle: { ...Typography.pageTitle, flexShrink: 1 },
  headerAction: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  tabHeaderStatus: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  stackHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    minHeight: ControlSize.minimumTarget,
    marginLeft: -12,
  },
  stackHeaderTitle: { ...Typography.title, flex: 1 },
});
