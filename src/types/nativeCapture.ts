export type RecordingEncoder = "h264_libx264" | "h264_nvenc" | "hevc_nvenc" | "h264_amf";

export type NativeCapturePlatform = "win32" | "darwin" | "linux";

export type NativeCaptureSource = {
  type: "screen" | "window";
  id?: string;
  displayId?: string;
  name?: string;
};

export type NativeCaptureVideoConfig = {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  encoder: RecordingEncoder;
};

export type NativeCaptureCursorConfig = {
  mode: "hide" | "system";
};

export type NativeCaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NativeCaptureStartPayload = {
  sessionId: string;
  source: NativeCaptureSource;
  video: NativeCaptureVideoConfig;
  cursor: NativeCaptureCursorConfig;
  outputPath: string;
  platform: NativeCapturePlatform;
  ffmpegPath?: string;
  captureRegion?: NativeCaptureRegion;
};

export type NativeCaptureStopPayload = {
  sessionId: string;
  finalize?: boolean;
};

export type NativeCaptureStatus = "idle" | "starting" | "recording" | "stopping" | "error";

export type NativeCaptureSessionResult = {
  outputPath: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fpsActual?: number;
  bytes?: number;
  sourceBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type NativeCaptureStatusResult = {
  status: NativeCaptureStatus;
  message?: string;
  sessionId?: string;
  startedAtMs?: number;
};
