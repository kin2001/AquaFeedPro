import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";

import { Colors, InterFamilies } from "@/constants/theme";

const ink = Colors.light;
const ticks = Array.from({ length: 12 }, (_, index) => index);
const twoDigits = (value: number) => String(value).padStart(2, "0");

export function ScheduleTimePicker({
  value,
  is24Hour,
  onCancel,
  onConfirm,
}: {
  value: string;
  is24Hour: boolean;
  onCancel: () => void;
  onConfirm: (time: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [hour, setHour] = useState(() => Number(value.slice(0, 2)));
  const [minute, setMinute] = useState(() => Number(value.slice(3)));
  const [part, setPart] = useState<"hour" | "minute">("hour");
  const minuteMode = part === "minute";
  const afternoon = hour >= 12;
  const innerRing = is24Hour && (hour === 0 || hour > 12);
  const angle = minuteMode ? minute * 6 : (hour % 12) * 30;

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  function chooseHour(slot: number, inner: boolean) {
    let nextHour = slot + (afternoon ? 12 : 0);
    if (is24Hour) nextHour = inner ? (slot ? slot + 12 : 0) : slot || 12;
    setHour(nextHour);
    setPart("minute");
  }

  function choosePoint(event: MouseEvent<HTMLDivElement>) {
    const { left, top, width, height } =
      event.currentTarget.getBoundingClientRect();
    const x = event.clientX - left - width / 2;
    const y = event.clientY - top - height / 2;
    const distance = Math.hypot(x, y);
    if (distance < 10) return;
    const turn = Math.atan2(x, -y) / (Math.PI * 2);
    if (minuteMode) setMinute((Math.round(turn * 60) + 60) % 60);
    else chooseHour((Math.round(turn * 12) + 12) % 12, distance < width * 0.34);
  }

  function adjust(
    event: KeyboardEvent<HTMLButtonElement>,
    field: "hour" | "minute",
  ) {
    const forward = event.key === "ArrowUp" || event.key === "ArrowRight";
    if (!forward && event.key !== "ArrowDown" && event.key !== "ArrowLeft")
      return;
    const delta = forward ? 1 : -1;
    event.preventDefault();
    setPart(field);
    if (field === "hour") setHour((hour + delta + 24) % 24);
    else setMinute((minute + delta + 60) % 60);
  }

  function dialNumber(slot: number, inner = false) {
    const radians = (slot * Math.PI) / 6;
    const distance = inner ? 24 : 42;
    const number = minuteMode
      ? slot * 5
      : inner
        ? slot
          ? slot + 12
          : 0
        : slot || 12;
    const label =
      minuteMode || (is24Hour && inner) ? twoDigits(number) : number;
    const selected = minuteMode
      ? minute === number
      : is24Hour
        ? hour === number
        : hour % 12 === slot;
    return (
      <button
        key={`${inner}-${slot}`}
        type="button"
        aria-label={`${minuteMode ? "Minute" : "Hour"} ${label}`}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          if (minuteMode) setMinute(number);
          else chooseHour(slot, inner);
        }}
        style={{
          ...styles.number,
          left: `${50 + Math.sin(radians) * distance}%`,
          top: `${50 - Math.cos(radians) * distance}%`,
          color: selected ? ink.onInk : ink.ink,
          background: selected ? ink.ink : "transparent",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      style={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={title} style={styles.title}>
        Select time
      </h2>
      <div style={styles.header}>
        <button
          type="button"
          autoFocus
          aria-label="Hours"
          aria-pressed={!minuteMode}
          onClick={() => setPart("hour")}
          onKeyDown={(event) => adjust(event, "hour")}
          style={{
            ...styles.value,
            background: minuteMode ? ink.surfaceMuted : ink.border,
          }}
        >
          {twoDigits(is24Hour ? hour : hour % 12 || 12)}
        </button>
        <span aria-hidden style={styles.colon}>
          :
        </span>
        <button
          type="button"
          aria-label="Minutes"
          aria-pressed={minuteMode}
          onClick={() => setPart("minute")}
          onKeyDown={(event) => adjust(event, "minute")}
          style={{
            ...styles.value,
            background: minuteMode ? ink.border : ink.surfaceMuted,
          }}
        >
          {twoDigits(minute)}
        </button>
        {is24Hour ? null : (
          <div style={styles.period}>
            {[false, true].map((pm) => (
              <button
                key={String(pm)}
                type="button"
                aria-pressed={afternoon === pm}
                onClick={() => setHour((hour % 12) + (pm ? 12 : 0))}
                style={{
                  ...styles.periodButton,
                  background: afternoon === pm ? ink.border : ink.surface,
                }}
              >
                {pm ? "PM" : "AM"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        role="group"
        aria-label={minuteMode ? "Choose minute" : "Choose hour"}
        onClick={choosePoint}
        style={styles.dial}
      >
        <div
          aria-hidden
          style={{
            ...styles.hand,
            height: !minuteMode && innerRing ? "24%" : "42%",
            transform: `rotate(${angle}deg)`,
          }}
        />
        <div aria-hidden style={styles.pin} />
        {ticks.map((slot) => dialNumber(slot))}
        {!minuteMode && is24Hour
          ? ticks.map((slot) => dialNumber(slot, true))
          : null}
      </div>
      <div style={styles.actions}>
        <button type="button" style={styles.action} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          style={styles.action}
          onClick={() => onConfirm(`${twoDigits(hour)}:${twoDigits(minute)}`)}
        >
          OK
        </button>
      </div>
    </dialog>
  );
}

const styles = {
  dialog: {
    width: "min(328px, calc(100% - 32px))",
    maxHeight: "calc(100dvh - 32px)",
    boxSizing: "border-box",
    border: 0,
    borderRadius: 28,
    padding: 24,
    background: ink.surface,
    color: ink.ink,
    fontFamily: `${InterFamilies.regular}, system-ui, sans-serif`,
  },
  title: { margin: "0 0 16px", fontSize: 14, fontWeight: 600 },
  header: { display: "flex", alignItems: "stretch", gap: 4 },
  value: {
    minWidth: 0,
    flex: 1,
    height: 72,
    border: 0,
    borderRadius: 8,
    color: ink.ink,
    font: "inherit",
    fontSize: "clamp(26px, 10vw, 44px)",
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
  },
  colon: { alignSelf: "center", fontSize: "clamp(26px, 10vw, 44px)" },
  period: {
    display: "flex",
    flexDirection: "column",
    marginLeft: 6,
    borderRadius: 8,
    border: `1px solid ${ink.controlBorder}`,
    overflow: "hidden",
  },
  periodButton: {
    flex: 1,
    paddingInline: 8,
    color: ink.ink,
    border: 0,
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
  },
  dial: {
    position: "relative",
    width: "min(100%, 248px)",
    aspectRatio: 1,
    margin: "20px auto 16px",
    borderRadius: "50%",
    background: ink.surfaceMuted,
    cursor: "pointer",
  },
  hand: {
    position: "absolute",
    bottom: "50%",
    left: "calc(50% - 1px)",
    width: 2,
    transformOrigin: "center bottom",
    background: ink.ink,
    pointerEvents: "none",
  },
  pin: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 6,
    height: 6,
    transform: "translate(-50%, -50%)",
    borderRadius: "50%",
    background: ink.ink,
    pointerEvents: "none",
  },
  number: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    width: "15%",
    aspectRatio: 1,
    borderRadius: "50%",
    border: 0,
    padding: 0,
    font: "inherit",
    fontSize: 14,
    cursor: "pointer",
  },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  action: {
    minHeight: 40,
    padding: "0 12px",
    border: 0,
    borderRadius: 20,
    background: "transparent",
    color: ink.ink,
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;
