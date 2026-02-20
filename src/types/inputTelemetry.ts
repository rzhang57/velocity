import type { ZoomDepth, ZoomFocus } from "@/components/video-editor/types";

export type InputSourceKind = "screen" | "window" | "unknown";

export interface InputSourceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type KeyCategory =
  | "printable"
  | "backspace"
  | "enter"
  | "tab"
  | "modifier"
  | "shortcut"
  | "other";

export interface MouseDownEvent {
  type: "mouseDown";
  ts: number;
  x: number;
  y: number;
  button: number;
}

export interface MouseUpEvent {
  type: "mouseUp";
  ts: number;
  x: number;
  y: number;
  button: number;
}

export interface MouseMoveSampledEvent {
  type: "mouseMoveSampled";
  ts: number;
  x: number;
  y: number;
}

export interface WheelEvent {
  type: "wheel";
  ts: number;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

export interface KeyDownCategoryEvent {
  type: "keyDownCategory";
  ts: number;
  category: KeyCategory;
}

export type InputTelemetryEvent =
  | MouseDownEvent
  | MouseUpEvent
  | MouseMoveSampledEvent
  | WheelEvent
  | KeyDownCategoryEvent;

export interface InputTelemetryStats {
  totalEvents: number;
  mouseDownCount: number;
  mouseUpCount: number;
  mouseMoveCount: number;
  wheelCount: number;
  keyDownCount: number;
}

export interface AutoZoomGeneratedRegion {
  startMs: number;
  endMs: number;
  depth: ZoomDepth;
  focus: ZoomFocus;
}

export interface AutoZoomGeneratedPayload {
  algorithmVersion: string;
  preset: AutoZoomIntensity;
  generatedAtMs: number;
  regions: AutoZoomGeneratedRegion[];
}

export type AutoZoomIntensity = "subtle" | "balanced" | "intense";

export interface InputTelemetryFileV1 {
  version: 1;
  sessionId: string;
  startedAtMs: number;
  sourceKind: InputSourceKind;
  sourceId?: string;
  sourceDisplayId?: string;
  sourceBounds?: InputSourceBounds;
  events: InputTelemetryEvent[];
  stats: InputTelemetryStats;
  generatedAutoZoom?: AutoZoomGeneratedPayload;
}

export interface StartInputTrackingPayload {
  sessionId: string;
  startedAtMs: number;
  sourceId?: string;
  sourceDisplayId?: string;
}
