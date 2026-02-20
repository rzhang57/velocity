import { useState, useEffect, useRef } from "react";
import styles from "./LaunchWindow.module.css";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { Button } from "../ui/button";
import { BsRecordCircle } from "react-icons/bs";
import { FaFolder, FaRegStopCircle } from "react-icons/fa";
import { MdMonitor } from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { FiMinus, FiX } from "react-icons/fi";
import { ContentClamp } from "../ui/content-clamp";
import { Mic, MicOff, Camera, CameraOff, Eye, EyeOff } from "lucide-react";

export function LaunchWindow() {
  const { recording, toggleRecording } = useScreenRecorder();
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedSource, setSelectedSource] = useState("Screen");
  const [hasSelectedSource, setHasSelectedSource] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState<string>("");
  const [micProcessingMode, setMicProcessingMode] = useState<"raw" | "cleaned">("cleaned");
  const [micLevel, setMicLevel] = useState(0);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraPreviewEnabled, setCameraPreviewEnabled] = useState(true);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState<string>("");
  const hudRef = useRef<HTMLDivElement | null>(null);

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
      if (!window.electronAPI) return;
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
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const microphones = devices.filter((d) => d.kind === "audioinput");
        const cameras = devices.filter((d) => d.kind === "videoinput");
        setMicDevices(microphones);
        setCameraDevices(cameras);
        if (!selectedMicDeviceId && microphones.length > 0) {
          setSelectedMicDeviceId(microphones[0].deviceId);
        }
        if (!selectedCameraDeviceId && cameras.length > 0) {
          setSelectedCameraDeviceId(cameras[0].deviceId);
        }
      } catch (error) {
        console.error("Failed to enumerate camera devices:", error);
      }
    };

    loadDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener?.("devicechange", loadDevices);
    };
  }, [selectedCameraDeviceId, selectedMicDeviceId]);

  useEffect(() => {
    const el = hudRef.current;
    if (!el) return;
    const measuredWidth = Math.ceil(el.scrollWidth + 2);
    window.electronAPI?.setHudOverlayWidth(measuredWidth).catch(() => {});
  }, [cameraEnabled, micEnabled, selectedMicDeviceId, selectedCameraDeviceId, micProcessingMode, selectedSource, recording]);

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
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedMicDeviceId ? { exact: selectedMicDeviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });

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
            if (boosted >= prev) {
              return boosted;
            }
            return Math.max(0, prev - 0.08);
          });
          rafId = requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        console.warn("Failed to start microphone level meter:", error);
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
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      setMicLevel(0);
    };
  }, [micEnabled, selectedMicDeviceId, recording]);

  useEffect(() => {
    if (cameraEnabled && cameraPreviewEnabled) {
      window.electronAPI?.openCameraPreviewWindow(selectedCameraDeviceId || undefined).catch(() => {});
      return;
    }
    window.electronAPI?.closeCameraPreviewWindow().catch(() => {});
  }, [cameraEnabled, cameraPreviewEnabled, selectedCameraDeviceId]);

  useEffect(() => {
    return () => {
      window.electronAPI?.closeCameraPreviewWindow().catch(() => {});
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const openSourceSelector = () => {
    window.electronAPI?.openSourceSelector();
  };

  const openVideoFile = async () => {
    const result = await window.electronAPI.openVideoFilePicker();
    if (result.cancelled) return;
    if (result.success && result.path) {
      await window.electronAPI.setCurrentVideoPath(result.path);
      await window.electronAPI.switchToEditor();
    }
  };

  const sendHudOverlayHide = () => {
    setCameraPreviewEnabled(false);
    window.electronAPI?.hudOverlayHide?.();
  };

  const sendHudOverlayClose = () => {
    window.electronAPI?.hudOverlayClose?.();
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent overflow-hidden">
      <div
        ref={hudRef}
        className={`flex items-center gap-2 px-3 py-2 ${styles.electronDrag}`}
        style={{
          width: 'fit-content',
          overflow: 'hidden',
          borderRadius: 12,
          background: 'linear-gradient(160deg, rgba(20,20,20,0.95) 0%, rgba(10,10,10,0.92) 100%)',
          backdropFilter: 'blur(28px) saturate(130%)',
          WebkitBackdropFilter: 'blur(28px) saturate(130%)',
          boxShadow: 'none',
          border: '1px solid rgba(255,255,255,0.1)',
          minHeight: 44,
        }}
      >
        <div className={`flex items-center gap-1 ${styles.electronDrag}`}>
          <RxDragHandleDots2 size={18} className="text-white/40" />
        </div>

        <div className={`flex items-center gap-1 px-1.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.12] ${styles.electronNoDrag}`}>
          <Button
            variant="link"
            size="sm"
            className="h-7 gap-1 text-white bg-transparent hover:bg-transparent px-1 text-left text-xs min-w-[156px] justify-start"
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
                    })
                : openSourceSelector
            }
            disabled={!hasSelectedSource && !recording}
            className="h-7 gap-1.5 text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.2] px-2 text-center text-xs min-w-[90px] rounded-md"
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
        </div>

        <div className="w-px h-5 bg-white/12" />

        <div className={`flex items-center gap-1 px-1.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.12] ${styles.electronNoDrag}`}>
          <Button
            variant="link"
            size="sm"
            onClick={() => setMicEnabled((prev) => !prev)}
            disabled={recording}
            title={micEnabled ? "Turn off microphone" : "Turn on microphone"}
            className={`h-7 px-2 gap-1 ${styles.toggleButton} ${micEnabled ? styles.toggleOn : styles.toggleOff}`}
          >
            {micEnabled ? <Mic size={14} className="text-white/90" /> : <MicOff size={14} className="text-white/50" />}
          </Button>
          {micEnabled && (
            <>
              <div
                className="h-7 w-[6px] rounded-full border border-white/15 bg-black/30 p-[1px] overflow-hidden flex items-end"
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
              <select
                className="w-[102px] h-7 text-[10px] bg-[#1c1c1c] text-white border border-white/20 rounded-md px-1.5 outline-none"
                style={{ colorScheme: 'dark' }}
                value={selectedMicDeviceId}
                disabled={recording || micDevices.length === 0}
                onChange={(e) => setSelectedMicDeviceId(e.target.value)}
                title="Microphone device"
              >
                {micDevices.length === 0 ? (
                  <option value="" className="bg-white text-black">No microphone</option>
                ) : (
                  micDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId} className="bg-white text-black">
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
              <select
                className="w-[72px] h-7 text-[10px] bg-[#1c1c1c] text-white border border-white/20 rounded-md px-1.5 outline-none"
                style={{ colorScheme: 'dark' }}
                value={micProcessingMode}
                disabled={recording}
                onChange={(e) => setMicProcessingMode(e.target.value as "raw" | "cleaned")}
                title="Microphone processing"
              >
                <option value="cleaned" className="bg-white text-black">Cleaned</option>
                <option value="raw" className="bg-white text-black">Raw</option>
              </select>
            </>
          )}
        </div>

        <div className={`flex items-center gap-1 px-1.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.12] ${styles.electronNoDrag}`}>
          <Button
            variant="link"
            size="sm"
            onClick={() => setCameraEnabled((prev) => !prev)}
            disabled={recording}
            title={cameraEnabled ? "Turn off camera" : "Turn on camera"}
            className={`h-7 px-2 gap-1 ${styles.toggleButton} ${cameraEnabled ? styles.toggleOn : styles.toggleOff}`}
          >
            {cameraEnabled ? <Camera size={14} className="text-white/90" /> : <CameraOff size={14} className="text-white/50" />}
          </Button>

          {cameraEnabled && (
            <>
              <select
                className="w-[112px] h-7 text-[10px] bg-[#1c1c1c] text-white border border-white/20 rounded-md px-1.5 outline-none"
                style={{ colorScheme: 'dark' }}
                value={selectedCameraDeviceId}
                disabled={recording || cameraDevices.length === 0}
                onChange={(e) => setSelectedCameraDeviceId(e.target.value)}
                title="Camera device"
              >
                {cameraDevices.length === 0 ? (
                  <option value="" className="bg-white text-black">No camera</option>
                ) : (
                  cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId} className="bg-white text-black">
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
              <Button
                  variant="link"
                  size="sm"
                  onClick={() => setCameraPreviewEnabled((prev) => !prev)}
                  disabled={recording}
                  title={cameraPreviewEnabled ? "Turn camera preview off" : "Turn camera preview on"}
                  className={`h-7 px-2 gap-1 ${styles.toggleButton} ${cameraPreviewEnabled ? styles.toggleOn : styles.toggleOff}`}
              >
                {cameraPreviewEnabled ? <Eye size={13} className="text-white/90" /> : <EyeOff size={13} className="text-white/50" />}
              </Button>
            </>
          )}
        </div>

        <div className="w-px h-5 bg-white/12" />

        <div className={`flex items-center gap-1.5 ${styles.electronNoDrag}`}>
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
          <Button
            variant="link"
            size="icon"
            className={`h-8 w-8 ${styles.hudOverlayButton} ${styles.hudActionButton}`}
            title="Hide HUD"
            onClick={sendHudOverlayHide}
          >
            <FiMinus size={16} className={styles.hudActionIcon} style={{ color: '#fff', opacity: 0.72 }} />
          </Button>

          <Button
            variant="link"
            size="icon"
            className={`h-8 w-8 ${styles.hudOverlayButton} ${styles.hudActionButton} ${styles.hudActionDanger}`}
            title="Close App"
            onClick={sendHudOverlayClose}
          >
            <FiX size={16} className={styles.hudActionIcon} style={{ color: '#fff', opacity: 0.72 }} />
          </Button>
        </div>
      </div>
    </div>
  );
}
