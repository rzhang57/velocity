import { useState, useRef, useEffect } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";

export interface RecorderOptions {
  micEnabled: boolean;
  micDeviceId?: string;
  micProcessingMode?: "raw" | "cleaned";
  cameraEnabled: boolean;
  cameraDeviceId?: string;
  cameraPreviewStream?: MediaStream | null;
}

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
  const cameraStartTime = useRef<number | null>(null);

  const TARGET_FRAME_RATE = 60;
  const TARGET_WIDTH = 3840;
  const TARGET_HEIGHT = 2160;
  const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;

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

  const computeBitrate = (width: number, height: number) => {
    const pixels = width * height;
    const highFrameRateBoost = TARGET_FRAME_RATE >= 60 ? 1.7 : 1;

    if (pixels >= FOUR_K_PIXELS) {
      return Math.round(45_000_000 * highFrameRateBoost);
    }

    if (pixels >= 2560 * 1440) {
      return Math.round(28_000_000 * highFrameRateBoost);
    }

    return Math.round(18_000_000 * highFrameRateBoost);
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
      const selectedSource = await window.electronAPI.getSelectedSource();
      if (!selectedSource) {
        alert("Please select a source to record");
        return;
      }

      const mediaStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSource.id,
            maxWidth: TARGET_WIDTH,
            maxHeight: TARGET_HEIGHT,
            maxFrameRate: TARGET_FRAME_RATE,
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
          frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
          width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
          height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
        });
      } catch (error) {
        console.warn("Unable to lock 4K/60fps constraints, using best available track settings.", error);
      }

      let { width = 1920, height = 1080 } = videoTrack.getSettings();
      width = Math.floor(width / 2) * 2;
      height = Math.floor(height / 2) * 2;

      const videoBitsPerSecond = computeBitrate(width, height);
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
          videoBitsPerSecond: computeBitrate(camWidth, camHeight),
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
        if (chunks.current.length === 0) return;
        const duration = Date.now() - startTime.current;
        const screenBlob = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];

        try {
          const fixedScreenBlob = await fixWebmDuration(screenBlob, duration);
          const cameraBlob = await cameraStopPromise;
          const timestamp = Date.now();
          const screenFileName = `recording-${timestamp}.webm`;
          const cameraFileName = cameraBlob ? `recording-camera-${timestamp}.webm` : undefined;
          const cameraStartOffsetMs = cameraStartTime.current
            ? Math.max(0, cameraStartTime.current - startTime.current)
            : undefined;

          const sessionPayload = {
            screenVideoData: await fixedScreenBlob.arrayBuffer(),
            screenFileName,
            cameraVideoData: cameraBlob ? await cameraBlob.arrayBuffer() : undefined,
            cameraFileName,
            session: {
              id: `session-${timestamp}`,
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
            },
          };

          const result = await window.electronAPI.storeRecordingSession(sessionPayload);
          if (!result.success || !result.session) {
            console.error("Failed to store recording session:", result.message);
            return;
          }

          await window.electronAPI.setCurrentRecordingSession(result.session);
          await window.electronAPI.switchToEditor();
        } catch (error) {
          console.error("Error saving recording session:", error);
        }
      };

      screenRecorder.onerror = () => setRecording(false);
      screenRecorder.start(1000);
      startTime.current = Date.now();
      setRecording(true);
      window.electronAPI?.setRecordingState(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecording(false);
      stopAllTracks();
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
    };
    startRecording(resolvedOptions);
  };

  return { recording, toggleRecording };
}
