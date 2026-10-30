import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/components/motion";

/** Visual frames only. Thresholds, units and accessibility must use the actual reading. */
export function useAnimatedReading(
  value: number | null,
  scope: string,
  enabled = true,
) {
  const reduced = useReducedMotion();
  const target = value !== null && Number.isFinite(value) ? value : null;
  const immediate = reduced || !enabled;
  const [frame, setFrame] = useState(() => ({
    scope,
    value: immediate ? target : target === null ? null : 0,
  }));
  const displayed = useRef(frame);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const from =
      displayed.current.scope === scope ? (displayed.current.value ?? 0) : 0;
    const show = (next: number | null) => {
      displayed.current = { scope, value: next };
      setFrame(displayed.current);
    };
    if (target === null || immediate || from === target) {
      show(target);
      return;
    }
    show(from);
    const start = performance.now();
    const tick = () => {
      if (cancelled) return;
      const progress = Math.max(
        0,
        Math.min(1, (performance.now() - start) / 1000),
      );
      show(
        progress === 1
          ? target
          : from + (target - from) * (1 - Math.pow(1 - progress, 3)),
      );
      if (progress < 1) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(request);
    };
  }, [scope, target, immediate]);

  // Context/quality changes take effect during render, before an old frame can paint.
  if (target === null || immediate) return target;
  return frame.scope === scope ? (frame.value ?? 0) : 0;
}
