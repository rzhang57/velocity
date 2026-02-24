import { useState, useEffect, useRef, type RefObject } from "react";
import styles from "./LaunchWindow.module.css";
import { useScreenRecorder, type RecordingPreset, type RecordingFps } from "../../hooks/useScreenRecorder";
import type { RecordingEncoder } from "@/types/nativeCapture";
import { Button } from "../ui/button";
import { BsRecordCircle } from "react-icons/bs";
import { FaFolder, FaRegStopCircle } from "react-icons/fa";
import { MdMonitor } from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { FiMinus, FiX } from "react-icons/fi";
import { ContentClamp } from "../ui/content-clamp";
import { EllipsisVertical, Mic, MicOff, Camera, CameraOff, Settings } from "lucide-react";
import { toast } from "sonner";

const RECORDING_PRESET_STORAGE_KEY = "openscreen.recordingPreset";
const RECORDING_FPS_STORAGE_KEY = "openscreen.recordingFps";

export function LaunchWindow() {
  const { recording, toggleRecording } = useScreenRecorder();
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedSource, setSelectedSource] = useState("Screen");
  const [hasSelectedSource, setHasSelectedSource] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState<string>("");
  const [micProcessingMode, setMicProcessingMode] = useState<"raw" | "cleaned">("cleaned");
  const [micLevel, setMicLevel] = useState(0);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraPreviewEnabled, setCameraPreviewEnabled] = useState(true);
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState<string>("");
  const [recordingPreset, setRecordingPreset] = useState<RecordingPreset>("quality");
  const [recordingFps, setRecordingFps] = useState<RecordingFps>(60);
  const [customCursorEnabled, setCustomCursorEnabled] = useState(true);
  const [useLegacyRecorder, setUseLegacyRecorder] = useState(false);
  const [recordingEncoder, setRecordingEncoder] = useState<RecordingEncoder>("h264_libx264");
  const [popoverSide, setPopoverSide] = useState<"top" | "bottom">("top");
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const recordingSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const mediaSettingsButtonRef = useRef<HTMLButtonElement | null>(null);

  const probeNativeEncoderOptions = () => {
    window.electronAPI.getNativeCaptureEncoderOptions()
      .then((result) => {
        if (Array.isArray(result?.options) && result.options.length > 0) {
          window.electronAPI.setHudEncoderOptions(result.options).catch(() => {});
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    const storedPreset = localStorage.getItem(RECORDING_PRESET_STORAGE_KEY);
    const storedFps = localStorage.getItem(RECORDING_FPS_STORAGE_KEY);
    if (storedPreset === "performance" || storedPreset === "balanced" || storedPreset === "quality") {
      setRecordingPreset(storedPreset);
    }
    if (storedFps === "30" || storedFps === "60") {
      setRecordingFps(Number(storedFps) as RecordingFps);
    } else if (storedFps === "120") {
      setRecordingFps(60);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(RECORDING_PRESET_STORAGE_KEY, recordingPreset);
  }, [recordingPreset]);

  useEffect(() => {
    localStorage.setItem(RECORDING_FPS_STORAGE_KEY, String(recordingFps));
  }, [recordingFps]);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (recording) {
      if (!recordingStart) setRecordingStart(Date.now());
      timer = setInterval(() => {
        if (recordingStart) {
          setElapsed(Math.floor((Date.now() - recordingStart) / 1000));
        }
      }, 1000);
    } else {
      setRecordingStart(null);
      setElapsed(0);
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording, recordingStart]);

  useEffect(() => {
    const checkSelectedSource = async () => {
      const source = await window.electronAPI.getSelectedSource();
      if (source) {
        setSelectedSource(source.name);
        setHasSelectedSource(true);
      } else {
        setSelectedSource("Screen");
        setHasSelectedSource(false);
      }
    };

    checkSelectedSource();
    const interval = setInterval(checkSelectedSource, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const syncWidth = () => {
      const el = hudRef.current;
      if (!el) return;
      const measuredWidth = Math.ceil(el.scrollWidth + 2);
      window.electronAPI.setHudOverlayWidth(measuredWidth).catch(() => {});
      window.electronAPI.setHudOverlayHeight(120, "top").catch(() => {});
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    if (hudRef.current) observer.observe(hudRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncPopoverSide = async () => {
      const result = await window.electronAPI.getHudOverlayPopoverSide();
      if (!cancelled && result?.success && (result.side === "top" || result.side === "bottom")) {
        setPopoverSide(result.side);
      }
    };
    syncPopoverSide().catch(() => {});
    const interval = setInterval(() => {
      syncPopoverSide().catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    window.electronAPI.preloadHudPopoverWindows().catch(() => {});
    window.electronAPI.requestStartupPermissions().catch(() => {});
    probeNativeEncoderOptions();
  }, []);

  useEffect(() => {
    let mounted = true;
    const applySettings = (settings: {
      micEnabled: boolean;
      selectedMicDeviceId: string;
      micProcessingMode: "raw" | "cleaned";
      cameraEnabled: boolean;
      cameraPreviewEnabled: boolean;
      selectedCameraDeviceId: string;
      recordingPreset: RecordingPreset;
      recordingFps: RecordingFps;
      customCursorEnabled: boolean;
      useLegacyRecorder: boolean;
      recordingEncoder: RecordingEncoder;
      encoderOptions: Array<{ encoder: RecordingEncoder; label: string; hardware: "cpu" | "nvidia" | "amd" }>;
    }) => {
      setMicEnabled(settings.micEnabled);
      setSelectedMicDeviceId(settings.selectedMicDeviceId);
      setMicProcessingMode(settings.micProcessingMode);
      setCameraEnabled(settings.cameraEnabled);
      setCameraPreviewEnabled(settings.cameraPreviewEnabled);
      setSelectedCameraDeviceId(settings.selectedCameraDeviceId);
      setRecordingPreset(settings.recordingPreset);
      setRecordingFps(settings.recordingFps);
      setCustomCursorEnabled(settings.customCursorEnabled);
      setUseLegacyRecorder(settings.useLegacyRecorder);
      setRecordingEncoder(settings.recordingEncoder);
    };

    window.electronAPI.getHudSettings().then((result) => {
      if (result.success) {
        applySettings(result.settings);
      }
    }).catch(() => {})
      .finally(() => {
        if (mounted) setSettingsHydrated(true);
      });

    const unsubscribe = window.electronAPI.onHudSettingsUpdated((settings) => {
      applySettings(settings);
      if (mounted) setSettingsHydrated(true);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    window.electronAPI.updateHudSettings({
      micEnabled,
      selectedMicDeviceId,
      micProcessingMode,
      cameraEnabled,
      cameraPreviewEnabled,
      selectedCameraDeviceId,
      recordingPreset,
      recordingFps,
      customCursorEnabled,
      useLegacyRecorder,
      recordingEncoder,
    }).catch(() => {});
  }, [settingsHydrated, micEnabled, selectedMicDeviceId, micProcessingMode, cameraEnabled, cameraPreviewEnabled, selectedCameraDeviceId, recordingPreset, recordingFps, customCursorEnabled, useLegacyRecorder, recordingEncoder]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let rafId: number | null = null;
    let disposed = false;

    const startMeter = async () => {
      if (!micEnabled || recording) {
        setMicLevel(0);
        return;
      }

      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: selectedMicDeviceId ? { exact: selectedMicDeviceId } : undefined,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          });
        }

        if (disposed || !stream) {
          stream?.getTracks().forEach(track => track.stop());
          return;
        }

        context = new AudioContext();
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.25;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);

        const tick = () => {
          if (!analyser || disposed) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const normalized = (data[i] - 128) / 128;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / data.length);
          const boosted = Math.min(1, rms * 2.5);
          setMicLevel((prev) => {
            if (boosted >= prev) return boosted;
            return Math.max(0, prev - 0.08);
          });
          rafId = requestAnimationFrame(tick);
        };

        tick();
      } catch {
        setMicLevel(0);
      }
    };

    startMeter();

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (source) source.disconnect();
      if (analyser) analyser.disconnect();
      if (context) context.close().catch(() => {});
      if (stream) stream.getTracks().forEach(track => track.stop());
      setMicLevel(0);
    };
  }, [micEnabled, selectedMicDeviceId, recording]);

  useEffect(() => {
    let cancelled = false;
    const syncCameraPreview = async () => {
      if (cameraEnabled && cameraPreviewEnabled) {
        if (cancelled) return;
        await window.electronAPI.openCameraPreviewWindow(selectedCameraDeviceId || undefined).catch(() => {});
        return;
      }
      await window.electronAPI.closeCameraPreviewWindow().catch(() => {});
    };
    void syncCameraPreview();
    return () => {
      cancelled = true;
    };
  }, [cameraEnabled, cameraPreviewEnabled, selectedCameraDeviceId]);

  useEffect(() => {
    if (recording) {
      window.electronAPI.closeHudPopoverWindow().catch(() => {});
    }
  }, [recording]);

  useEffect(() => {
    return () => {
      window.electronAPI.closeCameraPreviewWindow().catch(() => {});
      window.electronAPI.closeHudPopoverWindow().catch(() => {});
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const openSourceSelector = () => {
    window.electronAPI.openSourceSelector();
  };

  const openVideoFile = async () => {
    const result = await window.electronAPI.openVideoFilePicker();
    if (result.cancelled) return;
    if (result.success && result.path) {
      await window.electronAPI.setCurrentVideoPath(result.path);
      await window.electronAPI.switchToEditor();
    }
  };

  const openHudPopover = (kind: "recording" | "media", buttonRef: RefObject<HTMLButtonElement | null>) => {
    if (recording) return;
    if (kind === "recording") {
      probeNativeEncoderOptions();
    }
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    window.electronAPI.toggleHudPopoverWindow({
      kind,
      side: popoverSide,
      anchorRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    }).catch(() => {});
  };

  const sendHudOverlayHide = () => {
    setCameraPreviewEnabled(false);
    window.electronAPI.hudOverlayHide?.();
  };

  const sendHudOverlayClose = () => {
    window.electronAPI.hudOverlayClose?.();
  };

  const handleMicToggle = async () => {
    if (recording) return;
    if (micEnabled) {
      setMicEnabled(false);
      toast.message("Microphone disabled");
      return;
    }
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      probe.getTracks().forEach((track) => track.stop());
      setMicEnabled(true);
      toast.success("Microphone enabled");
      return;
    } catch {
      const permission = await window.electronAPI.requestMediaAccess("microphone").catch(() => ({ success: false, granted: false }));
      if (permission.granted) {
        setMicEnabled(true);
        toast.success("Microphone enabled");
        return;
      }
    }
    toast.error("Microphone permission required", {
      description: "Allow access in System Settings > Privacy & Security > Microphone.",
    });
  };

  const handleCameraToggle = async () => {
    if (recording) return;
    if (cameraEnabled) {
      setCameraEnabled(false);
      toast.message("Camera disabled");
      return;
    }
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
      probe.getTracks().forEach((track) => track.stop());
      setCameraEnabled(true);
      toast.success("Camera enabled");
      return;
    } catch {
      const permission = await window.electronAPI.requestMediaAccess("camera").catch(() => ({ success: false, granted: false }));
      if (permission.granted) {
        setCameraEnabled(true);
        toast.success("Camera enabled");
        return;
      }
    }
    toast.error("Camera permission required", {
      description: "Allow access in System Settings > Privacy & Security > Camera.",
    });
  };

  const hudAnchorClass = popoverSide === "top" ? "items-end pb-1" : "items-start pt-1";

  return (
    <div className={`w-full h-full flex justify-center bg-transparent ${hudAnchorClass}`}>
      <div
        ref={hudRef}
        className={`flex items-center gap-2 px-3 py-2 ${styles.electronDrag}`}
        style={{
          width: "fit-content",
          overflow: "hidden",
          borderRadius: 12,
          background: "linear-gradient(160deg, rgba(20,20,20,0.95) 0%, rgba(10,10,10,0.92) 100%)",
          backdropFilter: "blur(28px) saturate(130%)",
          WebkitBackdropFilter: "blur(28px) saturate(130%)",
          border: "1px solid rgba(255,255,255,0.1)",
          minHeight: 44,
        }}
      >
        <div className={`flex items-center gap-1 order-1 ${styles.electronNoDrag}`}>
          <button
            type="button"
            onClick={sendHudOverlayClose}
            className="group w-3 h-3 rounded-full bg-[#ff5f57] border border-[#d64541]/70 flex items-center justify-center"
            title="Close App"
          >
            <FiX size={8} className="text-black/70 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <button
            type="button"
            onClick={sendHudOverlayHide}
            className="group w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#d7991b]/70 flex items-center justify-center"
            title="Hide HUD"
          >
            <FiMinus size={8} className="text-black/70 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>

        <div className="order-2 w-px h-4 bg-white/15" />

        <div className={`relative flex items-center gap-1 px-1.5 py-1 pr-9 rounded-md bg-white/[0.03] border border-white/[0.12] order-6 ${styles.electronNoDrag}`}>
          <Button
            variant="link"
            size="sm"
            className="h-7 gap-1 text-white bg-transparent hover:bg-white/5 px-1 text-left text-xs min-w-[156px] justify-start no-underline hover:no-underline"
            onClick={openSourceSelector}
            disabled={recording}
          >
            <MdMonitor size={14} className="text-white/90" />
            <ContentClamp truncateLength={20}>{selectedSource}</ContentClamp>
          </Button>

          <Button
            variant="link"
            size="sm"
            onClick={
              hasSelectedSource
                ? () =>
                    toggleRecording({
                      micEnabled,
                      micDeviceId: selectedMicDeviceId || undefined,
                      micProcessingMode,
                      cameraEnabled,
                      cameraDeviceId: selectedCameraDeviceId || undefined,
                      recordingPreset,
                      recordingFps,
                      customCursorEnabled,
                      useLegacyRecorder,
                      recordingEncoder,
                    })
                : openSourceSelector
            }
            disabled={!hasSelectedSource && !recording}
            className="h-7 gap-1.5 text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.2] px-2 text-center text-xs min-w-[90px] rounded-md no-underline hover:no-underline"
          >
            {recording ? (
              <>
                <FaRegStopCircle size={14} className="text-red-400" />
                <span className="text-red-400 font-medium tabular-nums">{formatTime(elapsed)}</span>
              </>
            ) : (
              <>
                <BsRecordCircle size={14} className={hasSelectedSource ? "text-white" : "text-white/50"} />
                <span className={hasSelectedSource ? "text-white" : "text-white/50"}>Record</span>
              </>
            )}
          </Button>
          <Button
            ref={recordingSettingsButtonRef}
            variant="link"
            size="sm"
            onClick={() => openHudPopover("recording", recordingSettingsButtonRef)}
            disabled={recording}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 min-w-6 p-0 text-white hover:bg-white/[0.14]"
            title="Recording settings"
          >
            <Settings size={13} className={hasSelectedSource ? "text-white" : "text-white/70"} />
          </Button>
        </div>

        <div className="w-px h-5 bg-white/12 order-5" />

        <div className={`relative flex items-center gap-1 px-1.5 py-1 pr-8 rounded-md bg-white/[0.03] border border-white/[0.12] order-3 ${styles.electronNoDrag}`}>
          <Button
            variant="link"
            size="sm"
            onClick={handleMicToggle}
            disabled={recording}
            title={micEnabled ? "Turn off microphone" : "Turn on microphone"}
            className={`h-7 px-2 gap-1 ${styles.toggleButton} ${micEnabled ? styles.toggleOn : styles.toggleOff}`}
          >
            {micEnabled ? <Mic size={14} className="text-white/90" /> : <MicOff size={14} className="text-white/50" />}
          </Button>
          <div
            className="h-7 w-[8px] rounded-full border border-white/15 bg-black/30 p-[1px] overflow-hidden flex items-end"
            title="Microphone level"
          >
            <div
              className="w-full rounded-full transition-[height] duration-50"
              style={{
                height: `${Math.round(micLevel * 100)}%`,
                background: micLevel > 0.85 ? "#ef4444" : micLevel > 0.55 ? "#f59e0b" : "#34B27B",
              }}
            />
          </div>
          <div className="h-4 w-px bg-white/15" />
          <Button
            variant="link"
            size="sm"
            onClick={handleCameraToggle}
            disabled={recording}
            title={cameraEnabled ? "Turn off camera" : "Turn on camera"}
            className={`h-7 px-2 gap-1 ${styles.toggleButton} ${cameraEnabled ? styles.toggleOn : styles.toggleOff}`}
          >
            {cameraEnabled ? <Camera size={14} className="text-white/90" /> : <CameraOff size={14} className="text-white/50" />}
          </Button>
          <Button
            ref={mediaSettingsButtonRef}
            variant="link"
            size="sm"
            onClick={() => openHudPopover("media", mediaSettingsButtonRef)}
            disabled={recording}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 min-w-6 p-0 text-white hover:bg-white/[0.14]"
            title="Microphone and camera settings"
          >
            <EllipsisVertical size={14} className="text-white/80" />
          </Button>
        </div>

        <div className="w-px h-5 bg-white/12 order-7" />

        <div className={`flex items-center gap-1.5 order-8 ${styles.electronNoDrag}`}>
          <Button
            variant="link"
            size="sm"
            onClick={openVideoFile}
            className={`h-8 w-8 text-white bg-transparent text-xs ${styles.folderButton} ${styles.hudActionButton}`}
            disabled={recording}
            title="Open video"
          >
            <FaFolder size={13} className={`text-white/85 ${styles.hudActionIcon}`} />
          </Button>
        </div>

        <div className={`flex items-center gap-1 ml-2 order-10 ${styles.electronDrag}`}>
          <RxDragHandleDots2 size={18} className="text-white/40 hover:cursor-grab active:cursor-grabbing" />
        </div>
      </div>
    </div>
  );
}
