import type { ZoomDepth, ZoomFocus } from "@/components/video-editor/types";
import type { AutoZoomIntensity, InputTelemetryEvent, InputTelemetryFileV1, KeyCategory } from "@/types/inputTelemetry";

const CLICK_PRE_ROLL_MS = 420;
const CLICK_TAIL_MS = 760;
const CLICK_DEPTH: ZoomDepth = 2;

const TYPE_BURST_GAP_MS = 350;
const TYPE_PRE_ROLL_MS = 280;
const TYPE_TAIL_MS = 920;

const SCROLL_BURST_GAP_MS = 250;
const SCROLL_PRE_ROLL_MS = 120;
const SCROLL_TAIL_MS = 760;
const SCROLL_DEPTH: ZoomDepth = 2;

const DRAG_MIN_MS = 700;
const DRAG_DEPTH: ZoomDepth = 1;
const DRAG_PRE_ROLL_MS = 280;
const DRAG_TAIL_MS = 700;

const MERGE_GAP_MS = 180;
const MERGE_FOCUS_DISTANCE = 0.08;
const MIN_DURATION_MS = 220;

interface GeneratedZoomRegion {
  startMs: number;
  endMs: number;
  depth: ZoomDepth;
  focus: ZoomFocus;
}

interface CandidateRegion extends GeneratedZoomRegion {
  reason: "click" | "typing" | "scroll" | "drag";
}

interface GenerateAutoZoomRegionsParams {
  telemetry: InputTelemetryFileV1;
  durationMs: number;
  intensity?: AutoZoomIntensity;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: ZoomFocus, b: ZoomFocus) {
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function isTypingCategory(category: KeyCategory) {
  return category === "printable" || category === "backspace" || category === "enter" || category === "tab";
}

function toFocus(event: { x: number; y: number }, telemetry: InputTelemetryFileV1, fallback: ZoomFocus): ZoomFocus {
  const bounds = telemetry.sourceBounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return fallback;
  }

  return {
    cx: clamp((event.x - bounds.x) / bounds.width, 0, 1),
    cy: clamp((event.y - bounds.y) / bounds.height, 0, 1),
  };
}

function clampAndFilter(regions: CandidateRegion[], durationMs: number): CandidateRegion[] {
  const sorted = regions
    .map((region) => ({
      ...region,
      startMs: clamp(region.startMs, 0, durationMs),
      endMs: clamp(region.endMs, 0, durationMs),
    }))
    .filter((region) => region.endMs - region.startMs >= MIN_DURATION_MS)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: CandidateRegion[] = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(current);
      continue;
    }

    const canMerge = current.startMs - previous.endMs <= MERGE_GAP_MS && distance(current.focus, previous.focus) <= MERGE_FOCUS_DISTANCE;
    if (canMerge) {
      previous.endMs = Math.max(previous.endMs, current.endMs);
      previous.focus = {
        cx: (previous.focus.cx + current.focus.cx) / 2,
        cy: (previous.focus.cy + current.focus.cy) / 2,
      };
      previous.depth = (Math.max(previous.depth, current.depth) as ZoomDepth);
      continue;
    }

    merged.push(current);
  }

  const nonOverlapping: CandidateRegion[] = [];
  for (const region of merged) {
    const previous = nonOverlapping[nonOverlapping.length - 1];
    if (!previous) {
      nonOverlapping.push(region);
      continue;
    }

    const startMs = Math.max(region.startMs, previous.endMs);
    if (region.endMs - startMs >= MIN_DURATION_MS) {
      nonOverlapping.push({ ...region, startMs });
    }
  }

  return nonOverlapping;
}

export function generateAutoZoomRegions(params: GenerateAutoZoomRegionsParams): GeneratedZoomRegion[] {
  const { telemetry, durationMs, intensity = "balanced" } = params;
  if (durationMs <= 0 || !Array.isArray(telemetry.events) || telemetry.events.length === 0) {
    return [];
  }

  const profile = intensity === "subtle"
      ? {
        depthOffset: -1,
        tailScale: 1.2,
      }
    : intensity === "intense"
      ? {
          depthOffset: 0,
          tailScale: 1.5,
        }
      : {
          depthOffset: 0,
          tailScale: 1.35,
        };

  const withDepthOffset = (depth: ZoomDepth): ZoomDepth => {
    const adjusted = depth + profile.depthOffset;
    return Math.max(1, Math.min(6, adjusted)) as ZoomDepth;
  };

  const scaleTail = (ms: number) => Math.round(ms * profile.tailScale);

  const events = [...telemetry.events].sort((a, b) => a.ts - b.ts);
  const pointerEvents = events.filter((event): event is Extract<InputTelemetryEvent, { x: number; y: number }> =>
    "x" in event && "y" in event
  );

  const fallbackFocus: ZoomFocus = { cx: 0.5, cy: 0.5 };
  const lastPointerBefore = (ts: number): ZoomFocus => {
    for (let i = pointerEvents.length - 1; i >= 0; i -= 1) {
      if (pointerEvents[i].ts <= ts) {
        return toFocus(pointerEvents[i], telemetry, fallbackFocus);
      }
    }
    return fallbackFocus;
  };

  const candidates: CandidateRegion[] = [];

  for (const event of events) {
    if (event.type !== "mouseDown") continue;
    candidates.push({
      reason: "click",
      startMs: event.ts - telemetry.startedAtMs - CLICK_PRE_ROLL_MS,
      endMs: event.ts - telemetry.startedAtMs + scaleTail(CLICK_TAIL_MS),
      depth: withDepthOffset(CLICK_DEPTH),
      focus: toFocus(event, telemetry, fallbackFocus),
    });
  }

  const keyEvents = events.filter((event): event is Extract<InputTelemetryEvent, { type: "keyDownCategory" }> =>
    event.type === "keyDownCategory" && isTypingCategory(event.category)
  );
  if (keyEvents.length > 0) {
    let burstStart = keyEvents[0].ts;
    let burstEnd = keyEvents[0].ts;
    let burstCount = 1;

    for (let i = 1; i < keyEvents.length; i += 1) {
      const current = keyEvents[i];
      if (current.ts - burstEnd <= TYPE_BURST_GAP_MS) {
        burstEnd = current.ts;
        burstCount += 1;
        continue;
      }

      candidates.push({
        reason: "typing",
        startMs: burstStart - telemetry.startedAtMs - TYPE_PRE_ROLL_MS,
        endMs: burstEnd - telemetry.startedAtMs + scaleTail(TYPE_TAIL_MS),
        depth: withDepthOffset(burstCount >= 14 ? 2 : 1),
        focus: lastPointerBefore(burstStart),
      });

      burstStart = current.ts;
      burstEnd = current.ts;
      burstCount = 1;
    }

    candidates.push({
      reason: "typing",
      startMs: burstStart - telemetry.startedAtMs - TYPE_PRE_ROLL_MS,
      endMs: burstEnd - telemetry.startedAtMs + scaleTail(TYPE_TAIL_MS),
      depth: withDepthOffset(burstCount >= 14 ? 2 : 1),
      focus: lastPointerBefore(burstStart),
    });
  }

  const wheelEvents = events.filter((event): event is Extract<InputTelemetryEvent, { type: "wheel" }> => event.type === "wheel");
  if (wheelEvents.length > 0) {
    let burstStart = wheelEvents[0].ts;
    let burstEnd = wheelEvents[0].ts;
    let focus = toFocus(wheelEvents[0], telemetry, fallbackFocus);

    for (let i = 1; i < wheelEvents.length; i += 1) {
      const current = wheelEvents[i];
      if (current.ts - burstEnd <= SCROLL_BURST_GAP_MS) {
        burstEnd = current.ts;
        focus = toFocus(current, telemetry, focus);
        continue;
      }

      candidates.push({
        reason: "scroll",
        startMs: burstStart - telemetry.startedAtMs - SCROLL_PRE_ROLL_MS,
        endMs: burstEnd - telemetry.startedAtMs + scaleTail(SCROLL_TAIL_MS),
        depth: withDepthOffset(SCROLL_DEPTH),
        focus,
      });

      burstStart = current.ts;
      burstEnd = current.ts;
      focus = toFocus(current, telemetry, fallbackFocus);
    }

    candidates.push({
      reason: "scroll",
      startMs: burstStart - telemetry.startedAtMs - SCROLL_PRE_ROLL_MS,
      endMs: burstEnd - telemetry.startedAtMs + scaleTail(SCROLL_TAIL_MS),
      depth: withDepthOffset(SCROLL_DEPTH),
      focus,
    });
  }

  const mouseDownEvents = events.filter((event): event is Extract<InputTelemetryEvent, { type: "mouseDown" }> => event.type === "mouseDown");
  const mouseUpEvents = events.filter((event): event is Extract<InputTelemetryEvent, { type: "mouseUp" }> => event.type === "mouseUp");
  const moveEvents = events.filter((event): event is Extract<InputTelemetryEvent, { type: "mouseMoveSampled" }> => event.type === "mouseMoveSampled");

  for (const down of mouseDownEvents) {
    const up = mouseUpEvents.find((event) => event.ts > down.ts);
    if (!up) continue;
    const dragDuration = up.ts - down.ts;
    if (dragDuration < DRAG_MIN_MS) continue;

    const dragMoves = moveEvents.filter((event) => event.ts >= down.ts && event.ts <= up.ts);
    if (dragMoves.length < 2) continue;
    const middleTs = down.ts + (up.ts - down.ts) / 2;
    const nearestMove = dragMoves.reduce((best, current) => {
      const bestDiff = Math.abs(best.ts - middleTs);
      const currentDiff = Math.abs(current.ts - middleTs);
      return currentDiff < bestDiff ? current : best;
    });

    candidates.push({
      reason: "drag",
      startMs: down.ts - telemetry.startedAtMs - DRAG_PRE_ROLL_MS,
      endMs: up.ts - telemetry.startedAtMs + scaleTail(DRAG_TAIL_MS),
      depth: withDepthOffset(DRAG_DEPTH),
      focus: toFocus(nearestMove, telemetry, fallbackFocus),
    });
  }

  return clampAndFilter(candidates, durationMs).map((region) => ({
    startMs: region.startMs,
    endMs: region.endMs,
    depth: region.depth,
    focus: region.focus,
  }));
}
