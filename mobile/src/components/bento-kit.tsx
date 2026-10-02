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
  InterFamilies,
  Radii,
  Spacing,
  Typography,
} from "@/constants/theme";

type BentoCardProps = {
  children: ReactNode;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function BentoCard({
  children,
  compact = false,
  style,
}: BentoCardProps) {
  return (
    <View style={[styles.card, compact && styles.cardCompact, style]}>
      {children}
    </View>
  );
}

export type ButtonVariant = "primary" | "secondary" | "text";

type ButtonProps = {
  children: string;
  variant?: ButtonVariant;
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
  const textStyle =
    variant === "primary" && !state.disabled
      ? styles.buttonTextPrimary
      : state.disabled
        ? styles.buttonTextDisabled
        : styles.buttonText;
  const iconColor =
    variant === "primary" && !state.disabled
      ? "#FFFFFF"
      : state.disabled
        ? Colors.light.disabledText
        : Colors.light.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={state.accessibilityState}
      disabled={state.disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      android_ripple={{
        color:
          variant === "primary"
            ? "rgba(255, 255, 255, 0.16)"
            : "rgba(24, 24, 27, 0.12)",
      }}
      style={({ pressed }) => [
        styles.button,
        buttonVariants[variant],
        state.disabled && styles.buttonDisabled,
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
          <ActivityIndicator size="small" color={iconColor} />
        </View>
      ) : icon ? (
        <DecorativeIcon name={icon} color={iconColor} size={20} />
      ) : null}
      <Text style={[styles.buttonText, textStyle]}>{children}</Text>
    </Pressable>
  );
}

type LinkButtonProps = {
  href: Href;
  children: string;
  variant?: ButtonVariant;
  icon?: LucideIconName;
  accessibilityHint?: string;
};

export function LinkButton({
  href,
  children,
  variant = "primary",
  icon,
  accessibilityHint,
}: LinkButtonProps) {
  const [focused, setFocused] = useState(false);
  const linkStyle = StyleSheet.flatten([
    styles.button,
    buttonVariants[variant],
    focused && styles.buttonFocused,
  ]);
  const textColor = variant === "primary" ? "#FFFFFF" : Colors.light.text;

  return (
    <Link href={href} asChild style={linkStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={accessibilityHint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        android_ripple={{
          color:
            variant === "primary"
              ? "rgba(255, 255, 255, 0.16)"
              : "rgba(24, 24, 27, 0.12)",
        }}
      >
        {icon ? (
          <DecorativeIcon name={icon} color={textColor} size={20} />
        ) : null}
        <Text style={[styles.buttonText, { color: textColor }]}>
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
    <BentoCard style={styles.emptyState}>
      <View
        style={styles.emptyIcon}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Lucide name={icon} size={22} color={Colors.light.text} />
      </View>
      <Text style={Typography.cardTitle}>{title}</Text>
      <Text style={[Typography.body, styles.secondaryText]}>{description}</Text>
      <LinkButton href={href} icon="plus">
        {action}
      </LinkButton>
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
  | "warning"
  | "failed"
  | "online"
  | "offline"
  | "outdated";

const statusIcons: Record<StatusKind, LucideIconName> = {
  completed: "circle-check",
  pending: "clock",
  warning: "triangle-alert",
  failed: "circle-x",
  online: "wifi",
  offline: "wifi-off",
  outdated: "clock",
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
        color={Colors.light.text}
        size={18}
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
  disabled?: boolean;
};

export function TextField({
  label,
  hint,
  error,
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
      <Text nativeID={id} style={styles.fieldLabel}>
        {label}
      </Text>
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
        placeholderTextColor={Colors.light.textSecondary}
        selectionColor={Colors.light.primary}
        style={[
          styles.input,
          error && styles.inputError,
          focused && styles.inputFocused,
          disabled && styles.inputDisabled,
          style,
        ]}
      />
      {hint ? (
        <Text style={[Typography.supporting, styles.secondaryText]}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text nativeID={id + "-error"} style={styles.errorText}>
          Error: {error}
        </Text>
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

const buttonVariants = StyleSheet.create({
  primary: {
    backgroundColor: Colors.light.primary,
  },
  secondary: {
    backgroundColor: Colors.light.surface,
    borderColor: Colors.light.border,
    borderWidth: 1,
  },
  text: {
    backgroundColor: "transparent",
  },
});

const styles = StyleSheet.create({
  card: {
    width: "100%",
    gap: Spacing.cardGap,
    backgroundColor: Colors.light.surface,
    borderColor: Colors.light.border,
    borderWidth: 1,
    borderRadius: Radii.card,
    padding: Spacing.card,
  },
  cardCompact: {
    padding: Spacing.cardCompact,
  },
  button: {
    width: "100%",
    minHeight: ControlSize.minimumTarget,
    minWidth: ControlSize.minimumTarget,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.control,
  },
  buttonDisabled: {
    backgroundColor: Colors.light.disabledBackground,
    borderColor: Colors.light.border,
  },
  buttonFocused: {
    borderColor: Colors.light.textSecondary,
    borderWidth: 3,
  },
  buttonPressed: {
    opacity: 0.72,
  },
  buttonText: {
    ...Typography.button,
    color: Colors.light.text,
    textAlign: "center",
    flexShrink: 1,
  },
  buttonTextPrimary: {
    color: "#FFFFFF",
  },
  buttonTextDisabled: {
    color: Colors.light.disabledText,
  },
  emptyState: {
    alignItems: "flex-start",
  },
  emptyIcon: {
    width: ControlSize.minimumTarget,
    height: ControlSize.minimumTarget,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.surfaceMuted,
    borderRadius: Radii.control,
  },
  stateCard: {
    alignItems: "flex-start",
  },
  statusLabel: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    backgroundColor: Colors.light.surfaceMuted,
  },
  statusText: {
    ...Typography.supporting,
    color: Colors.light.text,
    fontFamily: InterFamilies.medium,
    flexShrink: 1,
  },
  field: {
    width: "100%",
    gap: Spacing.two,
  },
  fieldLabel: {
    ...Typography.supporting,
    color: Colors.light.text,
    fontFamily: InterFamilies.medium,
  },
  input: {
    width: "100%",
    minHeight: ControlSize.minimumTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderColor: Colors.light.controlBorder,
    borderWidth: 1,
    borderRadius: Radii.control,
    backgroundColor: Colors.light.surface,
    ...Typography.body,
  },
  inputError: {
    borderColor: Colors.light.text,
    borderWidth: 2,
  },
  inputFocused: {
    borderColor: Colors.light.primary,
    borderWidth: 2,
  },
  inputDisabled: {
    color: Colors.light.disabledText,
    backgroundColor: Colors.light.surfaceMuted,
  },
  secondaryText: {
    color: Colors.light.textSecondary,
  },
  errorText: {
    ...Typography.supporting,
    color: Colors.light.text,
    fontFamily: InterFamilies.medium,
  },
});
