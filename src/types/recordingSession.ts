import type { InputTelemetryFileV1 } from "./inputTelemetry";

export interface RecordingSession {
  id: string;
  startedAtMs: number;
  screenVideoPath: string;
  cameraVideoPath?: string;
  micEnabled: boolean;
  micCaptured: boolean;
  micStartOffsetMs?: number;
  cameraEnabled: boolean;
  cameraCaptured: boolean;
  cameraStartOffsetMs?: number;
  screenDurationMs: number;
  cameraDurationMs?: number;
  requestedCaptureFps?: 30 | 60;
  actualCaptureFps?: number;
  requestedCaptureWidth?: number;
  requestedCaptureHeight?: number;
  actualCaptureWidth?: number;
  actualCaptureHeight?: number;
  inputTelemetryPath?: string;
  inputTelemetry?: InputTelemetryFileV1;
  autoZoomGeneratedAtMs?: number;
  autoZoomAlgorithmVersion?: string;
  customCursorEnabled?: boolean;
  captureBackend?: "native-sidecar" | "legacy-electron";
  recordingEncoder?: "h264_libx264" | "h264_nvenc" | "hevc_nvenc" | "h264_amf";
}

export interface CameraHiddenRegion {
  id: string;
  startMs: number;
  endMs: number;
}
