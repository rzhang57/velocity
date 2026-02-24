import { useState, useRef, useEffect } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import type { InputTelemetryFileV1 } from "@/types/inputTelemetry";
import type {
  RecordingEncoder,
  NativeCaptureStartPayload,
  NativeCaptureSource,
} from "@/types/nativeCapture";

const RECORDING_NOTICE_STORAGE_KEY = "openscreen.recordingNotice";

export interface RecorderOptions {
  micEnabled: boolean;
  micDeviceId?: string;
  micProcessingMode?: "raw" | "cleaned";
  cameraEnabled: boolean;
  cameraDeviceId?: string;
  cameraPreviewStream?: MediaStream | null;
  recordingPreset?: RecordingPreset;
  recordingFps?: RecordingFps;
  customCursorEnabled?: boolean;
  useLegacyRecorder?: boolean;
  recordingEncoder?: RecordingEncoder;
}

export type RecordingPreset = "performance" | "balanced" | "quality";
export type RecordingFps = 30 | 60;

type CaptureProfile = {
  width: number;
  height: number;
  fps: RecordingFps;
};

type UseScreenRecorderReturn = {
  recording: boolean;
  toggleRecording: (options?: RecorderOptions) => void;
};

export function useScreenRecorder(): UseScreenRecorderReturn {
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const cameraRecorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cameraChunks = useRef<Blob[]>([]);
  const startTime = useRef<number>(0);
  const sessionIdRef = useRef<string>("");
  const cameraStartTime = useRef<number | null>(null);
  const nativeCaptureActiveRef = useRef(false);
  const nativeCustomCursorEnabledRef = useRef(true);
  const nativeRecordingEncoderRef = useRef<RecordingEncoder>("h264_libx264");
  const nativeOptionsRef = useRef<RecorderOptions | null>(null);
  const nativeCaptureProfileRef = useRef<CaptureProfile | null>(null);
  const nativeMicRecorderRef = useRef<MediaRecorder | null>(null);
  const nativeMicStreamRef = useRef<MediaStream | null>(null);
  const nativeMicChunksRef = useRef<Blob[]>([]);
  const nativeCameraRecorderRef = useRef<MediaRecorder | null>(null);
  const nativeCameraStreamRef = useRef<MediaStream | null>(null);
  const nativeCameraChunksRef = useRef<Blob[]>([]);
  const nativeCameraStartTimeRef = useRef<number | null>(null);
  const nativeMicStartTimeRef = useRef<number | null>(null);
  const nativeScreenStartTimeRef = useRef<number | null>(null);
  const setRecordingNotice = (message: string) => {
    try {
      localStorage.setItem(RECORDING_NOTICE_STORAGE_KEY, message);
    } catch {
      // intentional: ignore storage errors
    }
  };
  const clearRecordingNotice = () => {
    try {
      localStorage.removeItem(RECORDING_NOTICE_STORAGE_KEY);
    } catch {
      // intentional: ignore storage errors
    }
  };

  const getCaptureProfile = (options: RecorderOptions): CaptureProfile => {
    const preset = options.recordingPreset ?? "quality";
    const fps = options.recordingFps ?? 60;
    const dimensionsByPreset: Record<RecordingPreset, { width: number; height: number }> = {
      performance: { width: 1920, height: 1080 },
      balanced: { width: 2560, height: 1440 },
      quality: { width: 3840, height: 2160 },
    };
    const dimensions = dimensionsByPreset[preset];

    return {
      width: dimensions.width,
      height: dimensions.height,
      fps,
    };
  };

  const selectMimeType = () => {
    const preferred = [
      "video/webm;codecs=av1",
      "video/webm;codecs=h264",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];

    return preferred.find(type => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
  };

  const selectAudioMimeType = () => {
    const preferred = [
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    return preferred.find(type => MediaRecorder.isTypeSupported(type)) ?? "audio/webm";
  };

  const createDesktopCaptureStream = async (
    selectedSource: { id?: string; name?: string },
    captureProfile: CaptureProfile,
    customCursorEnabled: boolean
  ) => {
    const captureCursorMode = customCursorEnabled ? "never" : "motion";
    const isScreenSource = typeof selectedSource.id === "string" && selectedSource.id.startsWith("screen:");

    if (isScreenSource && typeof navigator.mediaDevices.getDisplayMedia === "function") {
      try {
        const displayStream = await (navigator.mediaDevices as MediaDevices).getDisplayMedia({
          video: {
            frameRate: { ideal: captureProfile.fps, max: captureProfile.fps },
            width: { ideal: captureProfile.width, max: captureProfile.width },
            height: { ideal: captureProfile.height, max: captureProfile.height },
            displaySurface: "monitor",
            cursor: captureCursorMode,
          } as MediaTrackConstraints,
          audio: false,
        });
        const track = displayStream.getVideoTracks()[0];
        if (track && customCursorEnabled) {
          try {
            await track.applyConstraints(({
              advanced: [{ cursor: "never" }],
            } as unknown) as MediaTrackConstraints);
          } catch {
            // intentional: cursor constraint may not be supported on all platforms
          }
        }
        return displayStream;
      } catch (error) {
        console.warn("getDisplayMedia failed, falling back to desktop source capture.", error);
      }
    }

    const fallbackCursorMode = customCursorEnabled ? "never" : "motion";
    const captureCursorOptional: Record<string, unknown>[] = [{ cursor: fallbackCursorMode }];
    if (customCursorEnabled) {
      captureCursorOptional.push({ googCaptureCursor: false });
    }
    return await (navigator.mediaDevices as unknown as { getUserMedia: (constraints: Record<string, unknown>) => Promise<MediaStream> }).getUserMedia({
      audio: false,
      video: {
        cursor: fallbackCursorMode,
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: selectedSource.id,
          cursor: fallbackCursorMode,
          ...(customCursorEnabled ? { googCaptureCursor: false } : {}),
          maxWidth: captureProfile.width,
          maxHeight: captureProfile.height,
          maxFrameRate: captureProfile.fps,
          minFrameRate: 30,
        },
        optional: captureCursorOptional,
      },
    });
  };

  const computeBitrate = (width: number, height: number, fps: RecordingFps) => {
    const pixels = width * height;
    if (pixels >= 3840 * 2160) {
      return fps === 60 ? 60_000_000 : 36_000_000;
    }
    if (pixels >= 2560 * 1440) {
      return fps === 60 ? 42_000_000 : 25_000_000;
    }
    return fps === 60 ? 24_000_000 : 14_000_000;
  };

  const computeNativeBitrate = (preset: RecordingPreset, fps: RecordingFps) => {
    const baseByPreset: Record<RecordingPreset, number> = {
      performance: 14_000_000,
      balanced: 22_000_000,
      quality: 32_000_000,
    };
    const fpsMultiplier = fps === 60 ? 1 : 0.65;
    return Math.round(baseByPreset[preset] * fpsMultiplier);
  };

  const stopAllTracks = () => {
    if (stream.current) {
      stream.current.getTracks().forEach(track => track.stop());
      stream.current = null;
    }
    if (micStream.current) {
      micStream.current.getTracks().forEach(track => track.stop());
      micStream.current = null;
    }
    if (cameraStream.current) {
      cameraStream.current.getTracks().forEach(track => track.stop());
      cameraStream.current = null;
    }
    if (nativeMicStreamRef.current) {
      nativeMicStreamRef.current.getTracks().forEach(track => track.stop());
      nativeMicStreamRef.current = null;
    }
    if (nativeCameraStreamRef.current) {
      nativeCameraStreamRef.current.getTracks().forEach(track => track.stop());
      nativeCameraStreamRef.current = null;
    }
  };

  const startNativeAuxiliaryCapture = async (options: RecorderOptions) => {
    nativeMicChunksRef.current = [];
    nativeCameraChunksRef.current = [];
    nativeMicStartTimeRef.current = null;
    nativeCameraStartTimeRef.current = null;
    nativeMicRecorderRef.current = null;
    nativeCameraRecorderRef.current = null;

    if (options.micEnabled) {
      try {
        const micMode = options.micProcessingMode ?? "cleaned";
        const processed = micMode === "cleaned";
        try {
          nativeMicStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: options.micDeviceId ? { exact: options.micDeviceId } : undefined,
              echoCancellation: processed,
              noiseSuppression: processed,
              autoGainControl: processed,
              channelCount: 1,
              sampleRate: 48000,
            },
            video: false,
          });
        } catch {
          nativeMicStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: processed,
              noiseSuppression: processed,
              autoGainControl: processed,
              channelCount: 1,
              sampleRate: 48000,
            },
            video: false,
          });
        }
        const micMimeType = selectAudioMimeType();
        const micRecorder = new MediaRecorder(nativeMicStreamRef.current, {
          mimeType: micMimeType,
          audioBitsPerSecond: micMode === "raw" ? 256_000 : 192_000,
        });
        micRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) nativeMicChunksRef.current.push(e.data);
        };
        nativeMicStartTimeRef.current = Date.now();
        micRecorder.start(1000);
        nativeMicRecorderRef.current = micRecorder;
      } catch (error) {
        console.warn("Native mode microphone capture unavailable. Continuing without microphone.", error);
      }
    }

    if (options.cameraEnabled) {
      try {
        if (options.cameraPreviewStream && options.cameraPreviewStream.getVideoTracks().length > 0) {
          nativeCameraStreamRef.current = options.cameraPreviewStream.clone();
        } else {
          try {
            nativeCameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: options.cameraDeviceId ? { exact: options.cameraDeviceId } : undefined,
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 60 },
              },
            });
          } catch {
            nativeCameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 60 },
              },
            });
          }
        }

        const nativeCameraMimeType = selectMimeType();
        const cameraTrackSettings = nativeCameraStreamRef.current.getVideoTracks()[0]?.getSettings();
        const camWidth = Math.floor((cameraTrackSettings?.width || 1280) / 2) * 2;
        const camHeight = Math.floor((cameraTrackSettings?.height || 720) / 2) * 2;
        const cameraRecorder = new MediaRecorder(nativeCameraStreamRef.current, {
          mimeType: nativeCameraMimeType,
          videoBitsPerSecond: computeBitrate(camWidth, camHeight, 60),
        });
        cameraRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) nativeCameraChunksRef.current.push(e.data);
        };
        nativeCameraStartTimeRef.current = Date.now();
        cameraRecorder.start(1000);
        nativeCameraRecorderRef.current = cameraRecorder;
      } catch (error) {
        console.warn("Native mode camera capture unavailable. Continuing without camera.", error);
      }
    }
  };

  const cancelNativeAuxiliaryCapture = () => {
    if (nativeMicRecorderRef.current && nativeMicRecorderRef.current.state !== "inactive") {
      nativeMicRecorderRef.current.stop();
    }
    if (nativeCameraRecorderRef.current && nativeCameraRecorderRef.current.state !== "inactive") {
      nativeCameraRecorderRef.current.stop();
    }
    nativeMicRecorderRef.current = null;
    nativeCameraRecorderRef.current = null;
    nativeMicChunksRef.current = [];
    nativeCameraChunksRef.current = [];
    nativeMicStartTimeRef.current = null;
    nativeCameraStartTimeRef.current = null;
    nativeScreenStartTimeRef.current = null;
    if (nativeMicStreamRef.current) {
      nativeMicStreamRef.current.getTracks().forEach((track) => track.stop());
      nativeMicStreamRef.current = null;
    }
    if (nativeCameraStreamRef.current) {
      nativeCameraStreamRef.current.getTracks().forEach((track) => track.stop());
      nativeCameraStreamRef.current = null;
    }
  };

  const stopNativeAuxiliaryCapture = async () => {
    const cameraMimeType = selectMimeType();
    const stopMicPromise = new Promise<Blob | null>((resolve) => {
      const recorder = nativeMicRecorderRef.current;
      if (!recorder) {
        resolve(null);
        return;
      }
      if (recorder.state === "inactive") {
        if (nativeMicChunksRef.current.length === 0) {
          resolve(null);
          return;
        }
        const micBlob = new Blob(nativeMicChunksRef.current, { type: selectAudioMimeType() });
        nativeMicChunksRef.current = [];
        resolve(micBlob);
        return;
      }
      recorder.onstop = () => {
        if (nativeMicChunksRef.current.length === 0) {
          resolve(null);
          return;
        }
        const micBlob = new Blob(nativeMicChunksRef.current, { type: selectAudioMimeType() });
        nativeMicChunksRef.current = [];
        resolve(micBlob);
      };
      recorder.stop();
    });

    const stopCameraPromise = new Promise<Blob | null>((resolve) => {
      const recorder = nativeCameraRecorderRef.current;
      const startedAt = nativeCameraStartTimeRef.current;
      if (!recorder || !startedAt) {
        resolve(null);
        return;
      }
      if (recorder.state === "inactive") {
        if (nativeCameraChunksRef.current.length === 0) {
          resolve(null);
          return;
        }
        const cameraDuration = Math.max(0, Date.now() - startedAt);
        const cameraBlob = new Blob(nativeCameraChunksRef.current, { type: cameraMimeType });
        nativeCameraChunksRef.current = [];
        fixWebmDuration(cameraBlob, cameraDuration)
          .then((fixed) => resolve(fixed))
          .catch(() => resolve(cameraBlob));
        return;
      }
      recorder.onstop = async () => {
        if (nativeCameraChunksRef.current.length === 0) {
          resolve(null);
          return;
        }
        const cameraDuration = Math.max(0, Date.now() - startedAt);
        const cameraBlob = new Blob(nativeCameraChunksRef.current, { type: cameraMimeType });
        nativeCameraChunksRef.current = [];
        try {
          resolve(await fixWebmDuration(cameraBlob, cameraDuration));
        } catch {
          resolve(cameraBlob);
        }
      };
      recorder.stop();
    });

    const [micBlob, cameraBlob] = await Promise.all([stopMicPromise, stopCameraPromise]);
    nativeMicRecorderRef.current = null;
    nativeCameraRecorderRef.current = null;

    const screenStartAt = nativeScreenStartTimeRef.current ?? startTime.current;
    const micStartOffsetMs = nativeMicStartTimeRef.current
      ? nativeMicStartTimeRef.current - screenStartAt
      : undefined;
    const cameraStartOffsetMs = nativeCameraStartTimeRef.current
      ? Math.max(0, nativeCameraStartTimeRef.current - screenStartAt)
      : undefined;
    const cameraDurationMs = cameraBlob && nativeCameraStartTimeRef.current
      ? Math.max(0, Date.now() - nativeCameraStartTimeRef.current)
      : undefined;

    if (nativeMicStreamRef.current) {
      nativeMicStreamRef.current.getTracks().forEach((track) => track.stop());
      nativeMicStreamRef.current = null;
    }
    if (nativeCameraStreamRef.current) {
      nativeCameraStreamRef.current.getTracks().forEach((track) => track.stop());
      nativeCameraStreamRef.current = null;
    }
    nativeMicStartTimeRef.current = null;
    nativeCameraStartTimeRef.current = null;
    nativeScreenStartTimeRef.current = null;

    return { micBlob, cameraBlob, micStartOffsetMs, cameraStartOffsetMs, cameraDurationMs };
  };

  const withRecomputedTelemetryStats = (telemetry: InputTelemetryFileV1): InputTelemetryFileV1 => {
    const stats = telemetry.events.reduce((acc, event) => {
      acc.totalEvents += 1;
      if (event.type === "mouseDown") acc.mouseDownCount += 1;
      if (event.type === "mouseUp") acc.mouseUpCount += 1;
      if (event.type === "mouseMoveSampled") acc.mouseMoveCount += 1;
      if (event.type === "wheel") acc.wheelCount += 1;
      if (event.type === "keyDownCategory") acc.keyDownCount += 1;
      return acc;
    }, {
      totalEvents: 0,
      mouseDownCount: 0,
      mouseUpCount: 0,
      mouseMoveCount: 0,
      wheelCount: 0,
      keyDownCount: 0,
    });

    return { ...telemetry, stats };
  };

  const trimTelemetryToDuration = (telemetry: InputTelemetryFileV1, durationMs: number): InputTelemetryFileV1 => {
    const TELEMETRY_END_TOLERANCE_MS = 350;
    const TELEMETRY_TRIM_ONLY_IF_OVERRUN_MS = 1_500;
    const maxTimestamp = telemetry.startedAtMs + Math.max(0, durationMs) + TELEMETRY_END_TOLERANCE_MS;
    const lastEventTs = telemetry.events[telemetry.events.length - 1]?.ts;
    if (typeof lastEventTs === "number" && lastEventTs <= maxTimestamp + TELEMETRY_TRIM_ONLY_IF_OVERRUN_MS) {
      return telemetry;
    }
    const nextEvents = telemetry.events.filter((event) => event.ts <= maxTimestamp);
    if (nextEvents.length === telemetry.events.length) return telemetry;
    return withRecomputedTelemetryStats({ ...telemetry, events: nextEvents });
  };

  const alignTelemetryStartToNativeDuration = (
    telemetry: InputTelemetryFileV1,
    nativeDurationMs: number,
    wallElapsedMs: number
  ): InputTelemetryFileV1 => {
    const MAX_ALIGNMENT_SHIFT_MS = 1_500;
    const rawShiftMs = Math.max(0, wallElapsedMs - nativeDurationMs);
    const shiftMs = Math.min(MAX_ALIGNMENT_SHIFT_MS, rawShiftMs);
    if (shiftMs < 1) return telemetry;
    return {
      ...telemetry,
      startedAtMs: telemetry.startedAtMs + shiftMs,
    };
  };

  const stopNativeCaptureFlow = async () => {
    const sessionId = sessionIdRef.current;
    console.info("[native-capture][renderer] stop flow started", { sessionId });
    setRecording(false);
    window.electronAPI?.setRecordingState(false);
    await window.electronAPI.setRecordingFinalizationState({
      status: "finalizing",
      sessionId,
      message: "Finalizing recording...",
      progressPhase: "stopping-native",
    });
    await window.electronAPI.openEditorNow();

    const options = nativeOptionsRef.current;
    const requestedProfile = nativeCaptureProfileRef.current;
    const auxiliaryResultPromise = stopNativeAuxiliaryCapture();
    const telemetryStopPromise = (async () => {
      // Keep a short grace window so the user's stop click is captured before telemetry closes.
      await new Promise((resolve) => setTimeout(resolve, 160));
      const trackingResult = await window.electronAPI.stopInputTracking();
        if (trackingResult.success && trackingResult.telemetry && trackingResult.telemetry.stats.totalEvents > 0) {
          return trackingResult.telemetry;
        }
        return undefined;
      })()
      .catch((error) => {
        console.warn("[auto-zoom][telemetry] stopInputTracking failed while stopping native capture", error);
        return undefined;
      });
    let nativeResult: Awaited<ReturnType<typeof window.electronAPI.nativeCaptureStop>> | null = null;
    try {
      console.info("[native-capture][renderer] requesting native-capture-stop", { sessionId });
      nativeResult = await window.electronAPI.nativeCaptureStop({
        sessionId,
        finalize: true,
      });
      console.info("[native-capture][renderer] native-capture-stop resolved", {
        sessionId,
        success: nativeResult?.success,
        message: nativeResult?.message,
        outputPath: nativeResult?.result?.outputPath,
      });
    } catch (error) {
      console.error("[native-capture] Failed to stop native capture", error);
      await window.electronAPI.setRecordingFinalizationState({
        status: "error",
        sessionId,
        message: `Failed to stop native capture: ${String(error)}`,
      });
    } finally {
      nativeCaptureActiveRef.current = false;
    }

    const [auxiliaryResult, inputTelemetryRaw] = await Promise.all([auxiliaryResultPromise, telemetryStopPromise]);
    let inputTelemetry = inputTelemetryRaw;
    console.info("[native-capture][renderer] auxiliary capture stop resolved", {
      hasMicBlob: Boolean(auxiliaryResult.micBlob),
      hasCameraBlob: Boolean(auxiliaryResult.cameraBlob),
    });

    if (!nativeResult?.success || !nativeResult.result?.outputPath) {
      console.error("[native-capture] No output from native capture stop", nativeResult);
      await window.electronAPI.setRecordingFinalizationState({
        status: "error",
        sessionId,
        message: nativeResult?.message || "Native capture did not produce output",
      });
      nativeOptionsRef.current = null;
      nativeCaptureProfileRef.current = null;
      return;
    }

    await window.electronAPI.setRecordingFinalizationState({
      status: "finalizing",
      sessionId,
      message: "Preparing recording assets...",
      progressPhase: "storing-assets",
    });
    const now = Date.now();
    const wallElapsedMs = Math.max(0, now - startTime.current);
    const nativeDurationMs = nativeResult.result.durationMs;
    const durationMs = Math.max(nativeDurationMs ?? 0, wallElapsedMs);
    if (inputTelemetry) {
      if (typeof nativeDurationMs === "number" && nativeDurationMs > 0) {
        inputTelemetry = alignTelemetryStartToNativeDuration(inputTelemetry, nativeDurationMs, wallElapsedMs);
      }
      inputTelemetry = trimTelemetryToDuration(inputTelemetry, durationMs);
    }
    const sessionPayload = {
      screenVideoPath: nativeResult.result.outputPath,
      inputTelemetry,
      inputTelemetryFileName: inputTelemetry ? `${pathSafeSessionName(now)}.telemetry.json` : undefined,
      micAudioData: auxiliaryResult.micBlob ? await auxiliaryResult.micBlob.arrayBuffer() : undefined,
      micAudioFileName: auxiliaryResult.micBlob ? `${pathSafeSessionName(now)}.mic.webm` : undefined,
      cameraVideoData: auxiliaryResult.cameraBlob ? await auxiliaryResult.cameraBlob.arrayBuffer() : undefined,
      cameraFileName: auxiliaryResult.cameraBlob ? `${pathSafeSessionName(now)}.camera.webm` : undefined,
      session: {
        id: sessionId || `session-${now}`,
        startedAtMs: startTime.current,
        micEnabled: Boolean(options?.micEnabled),
        micDeviceId: options?.micDeviceId,
        micProcessingMode: options?.micProcessingMode ?? "cleaned",
        micCaptured: Boolean(auxiliaryResult.micBlob),
        micStartOffsetMs: auxiliaryResult.micStartOffsetMs,
        cameraEnabled: Boolean(options?.cameraEnabled),
        cameraCaptured: Boolean(auxiliaryResult.cameraBlob),
        cameraStartOffsetMs: auxiliaryResult.cameraStartOffsetMs,
        screenDurationMs: durationMs,
        cameraDurationMs: auxiliaryResult.cameraDurationMs,
        requestedCaptureFps: requestedProfile?.fps,
        actualCaptureFps: nativeResult.result.fpsActual,
        requestedCaptureWidth: requestedProfile?.width,
        requestedCaptureHeight: requestedProfile?.height,
        actualCaptureWidth: nativeResult.result.width,
        actualCaptureHeight: nativeResult.result.height,
        capturedSourceBounds: nativeResult.result.sourceBounds,
        autoZoomGeneratedAtMs: undefined,
        autoZoomAlgorithmVersion: undefined,
        customCursorEnabled: nativeCustomCursorEnabledRef.current,
        captureBackend: "native-sidecar",
        recordingEncoder: nativeRecordingEncoderRef.current,
      },
    };

    await window.electronAPI.setRecordingFinalizationState({
      status: "finalizing",
      sessionId,
      message: auxiliaryResult.micBlob ? "Merging microphone audio..." : "Finalizing recording...",
      progressPhase: auxiliaryResult.micBlob ? "muxing-audio" : "storing-assets",
    });
    const stored = await window.electronAPI.storeNativeRecordingSession(sessionPayload);
    console.info("[native-capture][renderer] store-native-recording-session resolved", {
      success: stored?.success,
      message: stored?.message,
      hasSession: Boolean(stored?.session),
    });
    if (!stored.success || !stored.session) {
      console.error("[native-capture] Failed to store native recording session", stored.message);
      await window.electronAPI.setRecordingFinalizationState({
        status: "error",
        sessionId,
        message: stored.message || "Failed to store recording session",
      });
      nativeOptionsRef.current = null;
      nativeCaptureProfileRef.current = null;
      return;
    }
    nativeOptionsRef.current = null;
    nativeCaptureProfileRef.current = null;
    console.info("[native-capture][renderer] recording session finalized", {
      sessionId: typeof stored.session.id === "string" ? stored.session.id : undefined,
      screenVideoPath: typeof stored.session.screenVideoPath === "string" ? stored.session.screenVideoPath : undefined,
    });
    await window.electronAPI.setCurrentRecordingSession(stored.session);
    await window.electronAPI.setRecordingFinalizationState({
      status: "ready",
      sessionId,
      progressPhase: "done",
    });
    window.close();
  };

  const stopRecording = useRef(() => {
    if (nativeCaptureActiveRef.current) {
      void stopNativeCaptureFlow();
      return;
    }
    const screenRecording = mediaRecorder.current?.state === "recording";
    const camRecording = cameraRecorder.current?.state === "recording";
    if (!screenRecording && !camRecording) {
      return;
    }

    stopAllTracks();
    if (screenRecording) {
      mediaRecorder.current?.stop();
    }
    if (camRecording) {
      cameraRecorder.current?.stop();
    }

    setRecording(false);
    window.electronAPI?.setRecordingState(false);
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (window.electronAPI?.onStopRecordingFromTray) {
      cleanup = window.electronAPI.onStopRecordingFromTray(() => {
        stopRecording.current();
      });
    }

    return () => {
      if (cleanup) cleanup();
      if (mediaRecorder.current?.state === "recording") {
        mediaRecorder.current.stop();
      }
      if (cameraRecorder.current?.state === "recording") {
        cameraRecorder.current.stop();
      }
      stopAllTracks();
    };
  }, []);

  const startRecording = async (options: RecorderOptions) => {
    try {
      clearRecordingNotice();
      const captureProfile = getCaptureProfile(options);
      const selectedSource = await window.electronAPI.getSelectedSource();
      if (!selectedSource) {
        alert("Please select a source to record");
        return;
      }

      const recordingStartedAtMs = Date.now();
      startTime.current = recordingStartedAtMs;
      sessionIdRef.current = `session-${recordingStartedAtMs}`;
      const sourceId = typeof selectedSource.id === "string" ? selectedSource.id : undefined;
      const sourceDisplayId = typeof selectedSource.display_id === "string" ? selectedSource.display_id : undefined;
      console.info("[auto-zoom][telemetry] Starting input tracking", {
        sessionId: sessionIdRef.current,
        startedAtMs: recordingStartedAtMs,
        sourceId,
        sourceDisplayId,
      });
      const trackingStartResult = await window.electronAPI.startInputTracking({
        sessionId: sessionIdRef.current,
        startedAtMs: recordingStartedAtMs,
        sourceId,
        sourceDisplayId,
      });
      if (trackingStartResult.success) {
        console.info("[auto-zoom][telemetry] Input tracking started successfully", {
          sessionId: sessionIdRef.current,
        });
      } else {
        console.warn("[auto-zoom][telemetry] Input tracking did not start", {
          sessionId: sessionIdRef.current,
          message: trackingStartResult.message,
        });
      }

      const canTryNativeCapture = typeof window.electronAPI?.nativeCaptureStart === "function";
      nativeCustomCursorEnabledRef.current = Boolean(options.customCursorEnabled);
      nativeRecordingEncoderRef.current = options.recordingEncoder || "h264_libx264";
      nativeOptionsRef.current = options;
      nativeCaptureProfileRef.current = captureProfile;
      const sourceType: NativeCaptureSource["type"] =
        typeof selectedSource.id === "string" && selectedSource.id.startsWith("window:")
          ? "window"
          : "screen";
      const shouldPreferNative = Boolean(options.customCursorEnabled) || !options.useLegacyRecorder;
      if (canTryNativeCapture && shouldPreferNative) {
        const selectedEncoder = options.recordingEncoder || "h264_libx264";
        const buildNativePayload = async (encoder: RecordingEncoder): Promise<NativeCaptureStartPayload> => {
          let bitrate = computeNativeBitrate(options.recordingPreset ?? "quality", captureProfile.fps);
          if (encoder === "h264_nvenc") {
            bitrate = Math.max(8_000_000, Math.round(bitrate * 0.8));
          } else if (encoder === "hevc_nvenc") {
            bitrate = Math.max(6_000_000, Math.round(bitrate * 0.65));
          } else if (encoder === "h264_amf") {
            bitrate = Math.max(8_000_000, Math.round(bitrate * 0.85));
          }
          return {
            sessionId: sessionIdRef.current,
            source: {
              type: sourceType,
              id: sourceId,
              displayId: sourceDisplayId,
              name: typeof selectedSource.name === "string" ? selectedSource.name : undefined,
            },
            video: {
              width: captureProfile.width,
              height: captureProfile.height,
              fps: captureProfile.fps,
              bitrate,
              encoder,
            },
            cursor: {
              mode: options.customCursorEnabled ? "hide" : "system",
            },
            outputPath: `native-recording-${recordingStartedAtMs}.mp4`,
            platform: (await window.electronAPI.getPlatform()) as "win32" | "darwin" | "linux",
          };
        };
        await startNativeAuxiliaryCapture(options);
        nativeScreenStartTimeRef.current = Date.now();
        const nativeStart = await window.electronAPI.nativeCaptureStart(await buildNativePayload(selectedEncoder));
        if (nativeStart.success) {
          nativeCaptureActiveRef.current = true;
          setRecording(true);
          window.electronAPI?.setRecordingState(true);
          return;
        }
        const canPromptX264Retry = selectedEncoder !== "h264_libx264";
        if (canPromptX264Retry) {
          const retryWithX264 = window.confirm(
            `Native recorder failed with ${selectedEncoder}. Try x264 (CPU) instead?`
          );
          if (retryWithX264) {
            nativeScreenStartTimeRef.current = Date.now();
            const x264Start = await window.electronAPI.nativeCaptureStart(await buildNativePayload("h264_libx264"));
            if (x264Start.success) {
              nativeCaptureActiveRef.current = true;
              nativeRecordingEncoderRef.current = "h264_libx264";
              window.electronAPI?.updateHudSettings({ recordingEncoder: "h264_libx264" }).catch(() => {});
              setRecordingNotice("Native encoder failed. Retrying with x264 (CPU) for this recording.");
              setRecording(true);
              window.electronAPI?.setRecordingState(true);
              return;
            }
          }
        }
        cancelNativeAuxiliaryCapture();
        if (options.customCursorEnabled) {
          console.error("[native-capture] start failed while custom cursor is enabled", nativeStart.message);
          setRecordingNotice(`Native recorder failed to start: ${nativeStart.message || "unknown error"}`);
          window.electronAPI?.stopInputTracking().catch(() => {});
          return;
        }
        console.warn("[native-capture] start failed, falling back to renderer capture", nativeStart.message);
      }
      nativeCaptureActiveRef.current = false;

      const mediaStream = await createDesktopCaptureStream(
        selectedSource,
        captureProfile,
        Boolean(options.customCursorEnabled)
      );
      stream.current = mediaStream;
      if (!stream.current) {
        throw new Error("Media stream is not available.");
      }

      let micCaptured = false;
      if (options.micEnabled) {
        try {
          const micMode = options.micProcessingMode ?? "cleaned";
          const processed = micMode === "cleaned";
          try {
            micStream.current = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: options.micDeviceId ? { exact: options.micDeviceId } : undefined,
                echoCancellation: processed,
                noiseSuppression: processed,
                autoGainControl: processed,
                channelCount: 1,
                sampleRate: 48000,
              },
              video: false,
            });
          } catch {
            micStream.current = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: processed,
                noiseSuppression: processed,
                autoGainControl: processed,
                channelCount: 1,
                sampleRate: 48000,
              },
              video: false,
            });
          }
          const micTrack = micStream.current.getAudioTracks()[0];
          if (micTrack && stream.current) {
            try {
              await micTrack.applyConstraints({
                echoCancellation: processed,
                noiseSuppression: processed,
                autoGainControl: processed,
              });
            } catch (error) {
              console.warn("Unable to apply microphone constraints, continuing with system defaults.", error);
            }
            stream.current.addTrack(micTrack);
            micCaptured = true;
          }
        } catch (error) {
          console.warn("Microphone unavailable. Continuing without microphone.", error);
        }
      }

      let cameraCaptured = false;
      if (options.cameraEnabled) {
        try {
          if (options.cameraPreviewStream && options.cameraPreviewStream.getVideoTracks().length > 0) {
            cameraStream.current = options.cameraPreviewStream.clone();
          } else {
            try {
              cameraStream.current = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  deviceId: options.cameraDeviceId ? { exact: options.cameraDeviceId } : undefined,
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 30, max: 60 },
                },
              });
            } catch {
              cameraStream.current = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 30, max: 60 },
                },
              });
            }
          }
          cameraCaptured = cameraStream.current.getVideoTracks().length > 0;
        } catch (error) {
          console.warn("Camera unavailable. Continuing without camera.", error);
        }
      }

      const videoTrack = stream.current.getVideoTracks()[0];
      try {
        const baseConstraints: MediaTrackConstraints = {
          frameRate: { ideal: captureProfile.fps, max: captureProfile.fps },
          width: { ideal: captureProfile.width, max: captureProfile.width },
          height: { ideal: captureProfile.height, max: captureProfile.height },
        };
        if (options.customCursorEnabled) {
          // Some Chromium builds only honor cursor hiding as an advanced constraint on the track.
          (baseConstraints as MediaTrackConstraints & { advanced?: Array<Record<string, unknown>> }).advanced = [
            { cursor: "never" },
            { googCaptureCursor: false },
          ];
        }
        await videoTrack.applyConstraints(baseConstraints);
      } catch (error) {
        console.warn("Unable to lock requested capture constraints, using best available track settings.", error);
      }

      const { frameRate } = videoTrack.getSettings();
      let { width = 1920, height = 1080 } = videoTrack.getSettings();
      width = Math.floor(width / 2) * 2;
      height = Math.floor(height / 2) * 2;

      const actualCaptureFps = typeof frameRate === "number" ? Math.round(frameRate) : undefined;
      if (actualCaptureFps && actualCaptureFps < captureProfile.fps) {
        console.warn("Capture FPS is below requested target", {
          requestedFps: captureProfile.fps,
          actualFps: actualCaptureFps,
          requestedWidth: captureProfile.width,
          requestedHeight: captureProfile.height,
          actualWidth: width,
          actualHeight: height,
        });
      }
      const videoBitsPerSecond = computeBitrate(width, height, captureProfile.fps);
      const mimeType = selectMimeType();

      chunks.current = [];
      cameraChunks.current = [];

      const screenRecorder = new MediaRecorder(stream.current, {
        mimeType,
        videoBitsPerSecond,
        audioBitsPerSecond: options.micProcessingMode === "raw" ? 256_000 : 192_000,
      });
      mediaRecorder.current = screenRecorder;

      let cameraStopPromise: Promise<Blob | null> = Promise.resolve(null);
      if (cameraCaptured && cameraStream.current) {
        cameraStartTime.current = Date.now();
        const cameraTrackSettings = cameraStream.current.getVideoTracks()[0]?.getSettings();
        const camWidth = Math.floor((cameraTrackSettings?.width || 1280) / 2) * 2;
        const camHeight = Math.floor((cameraTrackSettings?.height || 720) / 2) * 2;
        const camRecorder = new MediaRecorder(cameraStream.current, {
          mimeType,
          videoBitsPerSecond: computeBitrate(camWidth, camHeight, 60),
        });
        cameraRecorder.current = camRecorder;
        camRecorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) cameraChunks.current.push(e.data);
        };
        cameraStopPromise = new Promise((resolve) => {
          camRecorder.onstop = async () => {
            try {
              if (cameraChunks.current.length === 0 || !cameraStartTime.current) {
                resolve(null);
                return;
              }
              const cameraDuration = Date.now() - cameraStartTime.current;
              const cameraBlob = new Blob(cameraChunks.current, { type: mimeType });
              cameraChunks.current = [];
              resolve(await fixWebmDuration(cameraBlob, cameraDuration));
            } catch {
              resolve(null);
            }
          };
        });
        camRecorder.start(1000);
      } else {
        cameraRecorder.current = null;
        cameraStartTime.current = null;
      }

      screenRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };

      screenRecorder.onstop = async () => {
        stream.current = null;
        micStream.current = null;
        cameraStream.current = null;
        let inputTelemetry: InputTelemetryFileV1 | undefined;
        try {
          console.info("[auto-zoom][telemetry] Stopping input tracking", {
            sessionId: sessionIdRef.current,
          });
          const trackingResult = await window.electronAPI.stopInputTracking();
          if (trackingResult.success && trackingResult.telemetry) {
            if (trackingResult.telemetry.stats.totalEvents > 0) {
              inputTelemetry = trackingResult.telemetry;
              console.info("[auto-zoom][telemetry] Input telemetry captured", {
                sessionId: sessionIdRef.current,
                totalEvents: inputTelemetry.stats.totalEvents,
                mouseDownCount: inputTelemetry.stats.mouseDownCount,
                keyDownCount: inputTelemetry.stats.keyDownCount,
                wheelCount: inputTelemetry.stats.wheelCount,
              });
            } else {
              console.warn("[auto-zoom][telemetry] Tracking returned empty telemetry; treating as unavailable", {
                sessionId: sessionIdRef.current,
              });
            }
          } else {
            console.warn("[auto-zoom][telemetry] Input tracking stop returned no telemetry", {
              sessionId: sessionIdRef.current,
              message: trackingResult.message,
            });
          }
        } catch (error) {
          console.error("[auto-zoom][telemetry] Failed to stop input tracking; continuing without telemetry", error);
        }
        if (chunks.current.length === 0) return;
        const duration = Date.now() - startTime.current;
        const screenBlob = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];

        try {
          const fixedScreenBlob = await fixWebmDuration(screenBlob, duration);
          const cameraBlob = await cameraStopPromise;
          const timestamp = Date.now();
          const screenFileName = `recording-${timestamp}.webm`;
          const inputTelemetryFileName = `recording-${timestamp}.telemetry.json`;
          const cameraFileName = cameraBlob ? `recording-camera-${timestamp}.webm` : undefined;
          const cameraStartOffsetMs = cameraStartTime.current
            ? Math.max(0, cameraStartTime.current - startTime.current)
            : undefined;

          const sessionPayload = {
            screenVideoData: await fixedScreenBlob.arrayBuffer(),
            screenFileName,
            cameraVideoData: cameraBlob ? await cameraBlob.arrayBuffer() : undefined,
            cameraFileName,
            inputTelemetry,
            inputTelemetryFileName: inputTelemetry ? inputTelemetryFileName : undefined,
            session: {
              id: sessionIdRef.current || `session-${timestamp}`,
              startedAtMs: startTime.current,
              micEnabled: options.micEnabled,
              micDeviceId: options.micDeviceId,
              micProcessingMode: options.micProcessingMode ?? "cleaned",
              micCaptured,
              cameraEnabled: options.cameraEnabled,
              cameraCaptured: Boolean(cameraBlob),
              cameraStartOffsetMs,
              screenDurationMs: duration,
              cameraDurationMs: cameraBlob && cameraStartTime.current
                ? Math.max(0, Date.now() - cameraStartTime.current)
                : undefined,
              requestedCaptureFps: captureProfile.fps,
              actualCaptureFps,
              requestedCaptureWidth: captureProfile.width,
              requestedCaptureHeight: captureProfile.height,
              actualCaptureWidth: width,
              actualCaptureHeight: height,
              autoZoomGeneratedAtMs: undefined,
              autoZoomAlgorithmVersion: undefined,
              customCursorEnabled: Boolean(options.customCursorEnabled),
            },
          };

          if (inputTelemetry) {
            console.info("[auto-zoom][telemetry] Persisting telemetry sidecar with recording session", {
              sessionId: sessionIdRef.current,
              inputTelemetryFileName,
              totalEvents: inputTelemetry.stats.totalEvents,
            });
          } else {
            console.warn("[auto-zoom][telemetry] No telemetry available for this recording session", {
              sessionId: sessionIdRef.current,
            });
          }

          const result = await window.electronAPI.storeRecordingSession(sessionPayload);
          if (!result.success || !result.session) {
            console.error("[auto-zoom][telemetry] Failed to store recording session", {
              sessionId: sessionIdRef.current,
              message: result.message,
            });
            return;
          }
          console.info("[auto-zoom][telemetry] Recording session stored", {
            sessionId: sessionIdRef.current,
            hasTelemetry: Boolean(inputTelemetry),
          });

          await window.electronAPI.setCurrentRecordingSession(result.session);
          await window.electronAPI.switchToEditor();
        } catch (error) {
          console.error("[auto-zoom][telemetry] Error while saving recording session", error);
        }
      };

      screenRecorder.onerror = () => setRecording(false);
      screenRecorder.start(1000);
      setRecording(true);
      window.electronAPI?.setRecordingState(true);
    } catch (error) {
      console.error("[auto-zoom][telemetry] Failed to start recording", error);
      setRecording(false);
      stopAllTracks();
      window.electronAPI?.stopInputTracking().catch((trackingError) => {
        console.warn("[auto-zoom][telemetry] Cleanup stopInputTracking failed", trackingError);
      });
    }
  };

  const toggleRecording = (options?: RecorderOptions) => {
    if (recording) {
      stopRecording.current();
      return;
    }

    const resolvedOptions: RecorderOptions = options ?? {
      micEnabled: true,
      micProcessingMode: "cleaned",
      cameraEnabled: false,
      recordingPreset: "quality",
      recordingFps: 60,
      customCursorEnabled: true,
      useLegacyRecorder: false,
      recordingEncoder: "h264_libx264",
    };
    startRecording(resolvedOptions);
  };

  return { recording, toggleRecording };
}

function pathSafeSessionName(ts: number) {
  return `recording-${ts}`;
}
