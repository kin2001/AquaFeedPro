import { Lucide, type LucideIconName } from "@react-native-vector-icons/lucide";
import { Link, type Href } from "expo-router";
import { useId, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { resolveButtonState } from "./button-state";

import {
  Colors,
  ControlSize,
  IconSize,
  InterFamilies,
  Radii,
  Spacing,
  Typography,
} from "@/constants/theme";

type BentoCardProps = {
  children: ReactNode;
  compact?: boolean;
  tone?: "default" | "muted" | "inverse";
  gap?: number;
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function BentoCard({
  children,
  compact = false,
  tone = "default",
  gap = Spacing.cardGap,
  flush = false,
  style,
}: BentoCardProps) {
  return (
    <View
      style={[
        styles.card,
        cardTones[tone],
        compact && styles.cardCompact,
        { gap },
        flush && styles.cardFlush,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export type ButtonVariant = "primary" | "secondary" | "text" | "inverse";

type ButtonSize = "default" | "compact";

type ButtonProps = {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIconName;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  children,
  variant = "primary",
  size = "default",
  icon,
  onPress,
  disabled = false,
  loading = false,
  accessibilityHint,
  style,
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const state = resolveButtonState({
    disabled,
    loading,
    hasAction: onPress !== undefined,
  });
  // A loading button keeps its normal colours; only a button that cannot act looks disabled.
  const visuallyDisabled = disabled || onPress === undefined;
  const labelColor =
    buttonLabelColors[variant][visuallyDisabled ? "disabled" : "enabled"];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={state.accessibilityState}
      disabled={state.disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hitSlop={size === "compact" ? compactHitSlop : undefined}
      android_ripple={{
        color:
          variant === "primary"
            ? Colors.light.rippleOnInk
            : Colors.light.rippleOnSurface,
      }}
      style={({ pressed }) => [
        styles.button,
        buttonVariants[variant],
        size === "compact" && styles.buttonCompact,
        visuallyDisabled && buttonDisabledVariants[variant],
        focused && styles.buttonFocused,
        pressed && !state.disabled && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <ActivityIndicator size="small" color={labelColor} />
        </View>
      ) : icon ? (
        <DecorativeIcon
          name={icon}
          color={labelColor}
          size={IconSize.default}
        />
      ) : null}
      <Text style={[styles.buttonText, { color: labelColor }]}>{children}</Text>
    </Pressable>
  );
}

type LinkButtonProps = {
  href: Href;
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIconName;
  accessibilityHint?: string;
};

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "default",
  icon,
  accessibilityHint,
}: LinkButtonProps) {
  const [focused, setFocused] = useState(false);
  const linkStyle = StyleSheet.flatten([
    styles.button,
    buttonVariants[variant],
    size === "compact" && styles.buttonCompact,
    focused && styles.buttonFocused,
  ]);
  const labelColor = buttonLabelColors[variant].enabled;

  return (
    <Link href={href} asChild style={linkStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={accessibilityHint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        hitSlop={size === "compact" ? compactHitSlop : undefined}
        android_ripple={{
          color:
            variant === "primary"
              ? Colors.light.rippleOnInk
              : Colors.light.rippleOnSurface,
        }}
      >
        {icon ? (
          <DecorativeIcon
            name={icon}
            color={labelColor}
            size={IconSize.default}
          />
        ) : null}
        <Text style={[styles.buttonText, { color: labelColor }]}>
          {children}
        </Text>
      </Pressable>
    </Link>
  );
}

export function DisabledButton({
  children,
  icon,
}: {
  children: string;
  icon?: LucideIconName;
}) {
  return (
    <Button disabled icon={icon}>
      {children}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action = "Add device",
  href = "/devices/add",
}: {
  icon: LucideIconName;
  title: string;
  description: string;
  action?: string;
  href?: Href;
}) {
  return (
    <BentoCard gap={0} style={styles.emptyState}>
      <View
        style={styles.emptyIcon}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Lucide name={icon} size={24} color={Colors.light.ink} />
      </View>
      <Text style={[Typography.title, styles.emptyTitle]}>{title}</Text>
      <Text style={[Typography.supporting, styles.emptyDescription]}>
        {description}
      </Text>
      <View style={styles.emptyAction}>
        <LinkButton href={href} icon="plus">
          {action}
        </LinkButton>
      </View>
    </BentoCard>
  );
}

export function ErrorState({
  title,
  description,
  retryLabel = "Try again",
  onRetry,
}: {
  title: string;
  description: string;
  retryLabel?: string;
  onRetry: () => void;
}) {
  return (
    <BentoCard style={styles.stateCard}>
      <StatusLabel kind="failed">Error</StatusLabel>
      <Text style={Typography.cardTitle}>{title}</Text>
      <Text style={[Typography.supporting, styles.secondaryText]}>
        {description}
      </Text>
      <Button variant="secondary" icon="rotate-ccw" onPress={onRetry}>
        {retryLabel}
      </Button>
    </BentoCard>
  );
}

export type StatusKind =
  | "completed"
  | "pending"
  | "running"
  | "warning"
  | "failed"
  | "online"
  | "offline"
  | "outdated"
  | "unknown"
  | "enabled"
  | "paused"
  | "selected"
  | "simulator";

const statusIcons: Record<StatusKind, LucideIconName> = {
  completed: "circle-check",
  pending: "clock",
  running: "loader",
  warning: "triangle-alert",
  failed: "circle-x",
  online: "wifi",
  offline: "wifi-off",
  outdated: "clock",
  unknown: "circle-help",
  enabled: "circle-play",
  paused: "circle-pause",
  selected: "check",
  simulator: "flask-conical",
};

export function StatusLabel({
  kind,
  children,
}: {
  kind: StatusKind;
  children: string;
}) {
  return (
    <View style={styles.statusLabel}>
      <DecorativeIcon
        name={statusIcons[kind]}
        color={Colors.light.ink}
        size={IconSize.small}
      />
      <Text style={styles.statusText}>{children}</Text>
    </View>
  );
}

type TextFieldProps = Omit<
  TextInputProps,
  | "accessibilityHint"
  | "accessibilityLabel"
  | "accessibilityLabelledBy"
  | "accessibilityState"
  | "editable"
> & {
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
  disabled?: boolean;
};

export function TextField({
  label,
  hint,
  error,
  suffix,
  disabled = false,
  style,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const id = useId();
  const handleFocus: NonNullable<TextInputProps["onFocus"]> = (event) => {
    setFocused(true);
    onFocus?.(event);
  };
  const handleBlur: NonNullable<TextInputProps["onBlur"]> = (event) => {
    setFocused(false);
    onBlur?.(event);
  };

  return (
    <View style={styles.field}>
      <Text
        nativeID={id}
        style={[styles.fieldLabel, disabled && styles.fieldLabelDisabled]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.inputBox,
          (focused || error) && styles.inputBoxStrong,
          disabled && styles.inputBoxDisabled,
        ]}
      >
        <TextInput
          {...inputProps}
          accessibilityLabel={
            Platform.OS === "android"
              ? undefined
              : error
                ? label + ". Error: " + error
                : label
          }
          accessibilityLabelledBy={
            Platform.OS === "android"
              ? error
                ? [id, id + "-error"]
                : id
              : undefined
          }
          accessibilityHint={hint}
          accessibilityState={{ disabled }}
          editable={!disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholderTextColor={Colors.light.textTertiary}
          selectionColor={Colors.light.ink}
          style={[styles.input, disabled && styles.inputDisabled, style]}
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
      {hint ? (
        <Text style={[styles.fieldHint, disabled && styles.fieldHintDisabled]}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <View style={styles.fieldError}>
          <View style={styles.fieldErrorIcon}>
            <DecorativeIcon
              name="circle-x"
              color={Colors.light.ink}
              size={IconSize.small}
            />
          </View>
          <Text
            nativeID={id + "-error"}
            accessibilityLabel={"Error: " + error}
            style={styles.fieldErrorText}
          >
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DecorativeIcon({
  name,
  color,
  size,
}: {
  name: LucideIconName;
  color: string;
  size: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Lucide name={name} color={color} size={size} />
    </View>
  );
}

const cardTones = StyleSheet.create({
  default: {
    backgroundColor: Colors.light.surface,
    borderColor: Colors.light.border,
    borderWidth: 1,
  },
  muted: {
    backgroundColor: Colors.light.surfaceMuted,
  },
  inverse: {
    backgroundColor: Colors.light.ink,
  },
});

const compactHitSlop = { top: 4, bottom: 4 };

const buttonLabelColors = {
  primary: { enabled: Colors.light.onInk, disabled: Colors.light.disabledText },
  secondary: { enabled: Colors.light.ink, disabled: Colors.light.disabledText },
  text: { enabled: Colors.light.ink, disabled: Colors.light.disabledText },
  inverse: {
    enabled: Colors.light.ink,
    disabled: Colors.light.onInkSecondary,
  },
} as const;

const buttonVariants = StyleSheet.create({
  primary: {
    backgroundColor: Colors.light.ink,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
  },
  secondary: {
    backgroundColor: Colors.light.surface,
    borderColor: Colors.light.controlBorder,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: Spacing.three,
  },
  text: {
    backgroundColor: "transparent",
    paddingVertical: 14,
    paddingHorizontal: 12,
    width: "auto",
    alignSelf: "flex-start",
  },
  inverse: {
    backgroundColor: Colors.light.surface,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
  },
});

const buttonDisabledVariants = StyleSheet.create({
  primary: {
    backgroundColor: Colors.light.disabledBackground,
  },
  secondary: {
    borderColor: Colors.light.border,
  },
  text: {},
  inverse: {
    backgroundColor: Colors.light.inverseDisabledBackground,
  },
});

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: Radii.card,
    padding: Spacing.card,
  },
  cardCompact: {
    padding: Spacing.cardCompact,
  },
  cardFlush: {
    padding: 0,
    gap: 0,
    overflow: "hidden",
  },
  button: {
    width: "100%",
    minHeight: ControlSize.minimumTarget,
    minWidth: ControlSize.minimumTarget,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: Spacing.two,
    borderRadius: Radii.control,
  },
  buttonCompact: {
    minHeight: ControlSize.compact,
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 14,
    gap: 6,
    width: "auto",
    alignSelf: "flex-start",
  },
  buttonFocused: {
    borderColor: Colors.light.ink,
    borderWidth: 2,
  },
  buttonPressed: {
    opacity: 0.72,
  },
  buttonText: {
    ...Typography.button,
    textAlign: "center",
    flexShrink: 1,
  },
  emptyState: {
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
  },
  emptyIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.surfaceMuted,
    borderRadius: Radii.pill,
  },
  emptyTitle: {
    textAlign: "center",
    marginTop: Spacing.three,
  },
  emptyDescription: {
    textAlign: "center",
    marginTop: Spacing.one,
  },
  emptyAction: {
    alignSelf: "stretch",
    marginTop: Spacing.four,
  },
  stateCard: {
    alignItems: "flex-start",
  },
  statusLabel: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: ControlSize.pill,
    paddingVertical: 6,
    paddingLeft: Spacing.two,
    paddingRight: 10,
    borderRadius: Radii.pill,
    backgroundColor: Colors.light.surfaceMuted,
  },
  statusText: {
    ...Typography.pill,
    flexShrink: 1,
  },
  field: {
    width: "100%",
    gap: Spacing.two,
  },
  fieldLabel: {
    ...Typography.label,
  },
  fieldLabelDisabled: {
    color: Colors.light.textTertiary,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: ControlSize.minimumTarget,
    paddingHorizontal: 15,
    backgroundColor: Colors.light.surface,
    borderColor: Colors.light.controlBorder,
    borderWidth: 1,
    borderRadius: Radii.control,
  },
  // 2 px border, so 1 px less padding keeps the text where it was.
  inputBoxStrong: {
    borderColor: Colors.light.ink,
    borderWidth: 2,
    paddingHorizontal: 14,
  },
  inputBoxDisabled: {
    backgroundColor: Colors.light.surfaceMuted,
    borderColor: Colors.light.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    padding: 0,
    ...Typography.body,
  },
  inputDisabled: {
    color: Colors.light.textSecondary,
  },
  inputSuffix: {
    ...Typography.body,
    color: Colors.light.textSecondary,
  },
  fieldHint: {
    ...Typography.supporting,
  },
  fieldHintDisabled: {
    color: Colors.light.textTertiary,
  },
  fieldError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  // Centres the 16 px icon on the 20 px first line of the message.
  fieldErrorIcon: {
    marginTop: Spacing.half,
  },
  fieldErrorText: {
    fontFamily: InterFamilies.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.light.ink,
    flex: 1,
  },
  secondaryText: {
    color: Colors.light.textSecondary,
  },
});
