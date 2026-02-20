import type { InputTelemetryFileV1 } from "./inputTelemetry";

export interface RecordingSession {
  id: string;
  startedAtMs: number;
  screenVideoPath: string;
  cameraVideoPath?: string;
  micEnabled: boolean;
  micCaptured: boolean;
  cameraEnabled: boolean;
  cameraCaptured: boolean;
  cameraStartOffsetMs?: number;
  screenDurationMs: number;
  cameraDurationMs?: number;
  inputTelemetryPath?: string;
  inputTelemetry?: InputTelemetryFileV1;
  autoZoomGeneratedAtMs?: number;
  autoZoomAlgorithmVersion?: string;
}

export interface CameraHiddenRegion {
  id: string;
  startMs: number;
  endMs: number;
}
