import type { InputTelemetryEvent, InputTelemetryFileV1 } from "@/types/inputTelemetry";

export interface CursorTrailPoint {
  xNorm: number;
  yNorm: number;
  ageRatio: number;
  emphasis: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isPointerEvent(
  event: InputTelemetryEvent
): event is Extract<InputTelemetryEvent, { x: number; y: number }> {
  return event.type === "mouseMoveSampled" || event.type === "mouseDown" || event.type === "mouseUp" || event.type === "wheel";
}

function eventEmphasis(event: InputTelemetryEvent) {
  if (event.type === "mouseDown") return 1;
  if (event.type === "mouseUp") return 0.9;
  if (event.type === "wheel") return 0.85;
  return 0.7;
}

export function getCursorTrailPoints(
  telemetry: InputTelemetryFileV1,
  absoluteTimeMs: number,
  maxAgeMs = 1100,
  maxPoints = 14
): CursorTrailPoint[] {
  const bounds = telemetry.sourceBounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return [];
  }

  const startTs = absoluteTimeMs - maxAgeMs;
  const pointerEvents = telemetry.events
    .filter(isPointerEvent)
    .filter((event) => event.ts <= absoluteTimeMs && event.ts >= startTs);

  if (pointerEvents.length === 0) {
    return [];
  }

  const sampled: Array<Extract<InputTelemetryEvent, { x: number; y: number }> | null> = [];
  let lastTs = -Infinity;
  for (let i = pointerEvents.length - 1; i >= 0; i -= 1) {
    const event = pointerEvents[i];
    if (lastTs - event.ts < 45 && event.type === "mouseMoveSampled") {
      continue;
    }
    sampled.push(event);
    lastTs = event.ts;
    if (sampled.length >= maxPoints) break;
  }

  sampled.reverse();

  return sampled
    .filter((event): event is Extract<InputTelemetryEvent, { x: number; y: number }> => Boolean(event))
    .map((event) => {
      const ageMs = absoluteTimeMs - event.ts;
      return {
        xNorm: clamp((event.x - bounds.x) / bounds.width, 0, 1),
        yNorm: clamp((event.y - bounds.y) / bounds.height, 0, 1),
        ageRatio: clamp(1 - ageMs / maxAgeMs, 0, 1),
        emphasis: eventEmphasis(event),
      };
    });
}
