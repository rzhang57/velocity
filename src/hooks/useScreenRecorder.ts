import { useState, useRef, useEffect } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import type { InputTelemetryFileV1 } from "@/types/inputTelemetry";

export interface RecorderOptions {
  micEnabled: boolean;
  micDeviceId?: string;
  micProcessingMode?: "raw" | "cleaned";
  cameraEnabled: boolean;
  cameraDeviceId?: string;
  cameraPreviewStream?: MediaStream | null;
  recordingPreset?: RecordingPreset;
  recordingFps?: RecordingFps;
}

export type RecordingPreset = "performance" | "balanced" | "quality";
export type RecordingFps = 60 | 120;

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

  const computeBitrate = (width: number, height: number, fps: RecordingFps) => {
    const pixels = width * height;
    if (pixels >= 3840 * 2160) {
      return fps === 120 ? 95_000_000 : 60_000_000;
    }
    if (pixels >= 2560 * 1440) {
      return fps === 120 ? 70_000_000 : 42_000_000;
    }
    return fps === 120 ? 40_000_000 : 24_000_000;
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
  };

  const stopRecording = useRef(() => {
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

      const mediaStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSource.id,
            maxWidth: captureProfile.width,
            maxHeight: captureProfile.height,
            maxFrameRate: captureProfile.fps,
            minFrameRate: 30,
          },
        },
      });
      stream.current = mediaStream;
      if (!stream.current) {
        throw new Error("Media stream is not available.");
      }

      let micCaptured = false;
      if (options.micEnabled) {
        try {
          const micMode = options.micProcessingMode ?? "cleaned";
          const processed = micMode === "cleaned";
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
            cameraStream.current = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: options.cameraDeviceId ? { exact: options.cameraDeviceId } : undefined,
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 60 },
              },
            });
          }
          cameraCaptured = cameraStream.current.getVideoTracks().length > 0;
        } catch (error) {
          console.warn("Camera unavailable. Continuing without camera.", error);
        }
      }

      const videoTrack = stream.current.getVideoTracks()[0];
      try {
        await videoTrack.applyConstraints({
          frameRate: { ideal: captureProfile.fps, max: captureProfile.fps },
          width: { ideal: captureProfile.width, max: captureProfile.width },
          height: { ideal: captureProfile.height, max: captureProfile.height },
        });
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
    };
    startRecording(resolvedOptions);
  };

  return { recording, toggleRecording };
}
