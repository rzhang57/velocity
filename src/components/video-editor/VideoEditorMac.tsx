

import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import PlaybackControls from "./PlaybackControls";
import TimelineEditor from "./timeline/TimelineEditor";
import { SettingsPanel } from "./SettingsPanel";
import { ExportDialog } from "./ExportDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import type { Span } from "dnd-timeline";
import {
  DEFAULT_ZOOM_DEPTH,
  clampZoomDepth,
  clampFocusToDepth,
  DEFAULT_CROP_REGION,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIGURE_DATA,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type TrimRegion,
  type AnnotationRegion,
  type CropRegion,
  type FigureData,
  type CameraHiddenRegion,
} from "./types";
import { VideoExporter, GifExporter, type ExportProgress, type ExportSettings, type ExportFormat, type GifFrameRate, type GifSizePreset, type Mp4FrameRate, type Mp4ResolutionPreset, GIF_SIZE_PRESETS, calculateOutputDimensions } from "@/lib/exporter";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { getAssetPath } from "@/lib/assetPath";
import type { RecordingSession } from "@/types/recordingSession";
import type { AutoZoomIntensity, InputTelemetryFileV1 } from "@/types/inputTelemetry";
import { generateAutoZoomRegions } from "@/lib/autoZoom/generateAutoZoomRegions";
import { buildSmoothedCursorTelemetry, type CustomCursorTelemetry } from "@/lib/cursor/customCursor";

const WALLPAPER_COUNT = 18;
const WALLPAPER_PATHS = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `/wallpapers/wallpaper${i + 1}.jpg`);
const AUTO_ZOOM_ALGORITHM_VERSION = "v1-balanced-plus";
const AUTO_ZOOM_INTENSITY_OPTIONS: Array<{ value: AutoZoomIntensity; label: string }> = [
  { value: "subtle", label: "Subtle" },
  { value: "balanced", label: "Balanced" },
  { value: "intense", label: "Intense" },
];
const PREVIEW_QUALITY_SCALE: Record<'full' | 'half' | 'quarter', number> = {
  full: 1,
  half: 0.5,
  quarter: 0.25,
};
const EXPORT_DIRECTORY_STORAGE_KEY = "openscreen.exportDirectory";

export default function VideoEditor() {
  const debugPrefix = "[mac-editor-debug]";
  const emitDiagnostic = useCallback((level: 'log' | 'warn' | 'error', message: string, data?: unknown) => {
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (data !== undefined) {
      logger(`${debugPrefix} ${message}`, data);
    } else {
      logger(`${debugPrefix} ${message}`);
    }
    window.electronAPI?.logRendererDiagnostic?.({
      level,
      scope: 'mac-editor',
      message,
      data,
    });
  }, []);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [recordingSession, setRecordingSession] = useState<RecordingSession | null>(null);
  const [cameraVideoPath, setCameraVideoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursorProcessing, setCursorProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [wallpaper, setWallpaper] = useState<string>(WALLPAPER_PATHS[0]);
  const [shadowIntensity, setShadowIntensity] = useState(0);
  const [showBlur, setShowBlur] = useState(false);
  const [motionBlurEnabled, setMotionBlurEnabled] = useState(false);
  const [cursorTrailEnabled, setCursorTrailEnabled] = useState(false);
  const [customCursorSize, setCustomCursorSize] = useState(1.2);
  const [customCursorTelemetry, setCustomCursorTelemetry] = useState<CustomCursorTelemetry | null>(null);
  const [borderRadius, setBorderRadius] = useState(0);
  const [padding, setPadding] = useState(50);
  const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
  const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
  const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
  const [cameraHiddenRegions, setCameraHiddenRegions] = useState<CameraHiddenRegion[]>([]);
  const [selectedCameraHiddenId, setSelectedCameraHiddenId] = useState<string | null>(null);
  const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isAutoZoomGenerating, setIsAutoZoomGenerating] = useState(false);
  const [autoZoomIntensity, setAutoZoomIntensity] = useState<AutoZoomIntensity>("balanced");
  const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
  const [isStartingNewRecording, setIsStartingNewRecording] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [sourceAspectRatio, setSourceAspectRatio] = useState<number>(16 / 9);
  const [previewQuality, setPreviewQuality] = useState<'full' | 'half' | 'quarter'>('full');
  const [mp4FrameRate, setMp4FrameRate] = useState<Mp4FrameRate>(60);
  const [mp4Resolution, setMp4Resolution] = useState<Mp4ResolutionPreset>(1080);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mp4');
  const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(10);
  const [gifLoop, setGifLoop] = useState(true);
  const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>('small');
  const [exportDirectory, setExportDirectory] = useState<string>("");
  const safePadding = Number.isFinite(padding) ? Math.min(100, Math.max(0, padding)) : 50;

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
  const nextZoomIdRef = useRef(1);
  const nextTrimIdRef = useRef(1);
  const nextAnnotationIdRef = useRef(1);
  const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
  const nextCameraHiddenIdRef = useRef(1);
  const exporterRef = useRef<VideoExporter | null>(null);
  const autoGeneratedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      emitDiagnostic('error', 'window error event', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      emitDiagnostic('error', 'unhandled promise rejection', {
        reason: event.reason,
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [emitDiagnostic]);

  // Helper to convert file path to proper file:// URL
  const toFileUrl = (filePath: string): string => {
    // Normalize path separators to forward slashes
    const normalized = filePath.replace(/\\/g, '/');
    
    // Check if it's a Windows absolute path (e.g., C:/Users/...)
    if (normalized.match(/^[a-zA-Z]:/)) {
      const fileUrl = encodeURI(`file:///${normalized}`);
      return fileUrl;
    }
    
    // Unix-style absolute path
    const fileUrl = encodeURI(`file://${normalized}`);
    return fileUrl;
  };

  useEffect(() => {
    async function loadVideo() {
      try {
        const sessionResult = await window.electronAPI.getCurrentRecordingSession();
        if (sessionResult.success && sessionResult.session) {
          const session = sessionResult.session as unknown as RecordingSession;
          const customEnabled = Boolean(session.customCursorEnabled && session.inputTelemetry);
          if (customEnabled) {
            setCursorProcessing(true);
          }
          setRecordingSession(session);
          setVideoPath(toFileUrl(session.screenVideoPath));
          setCameraVideoPath(session.cameraVideoPath ? toFileUrl(session.cameraVideoPath) : null);
          if (customEnabled) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            setCustomCursorTelemetry(buildSmoothedCursorTelemetry(session.inputTelemetry));
            setCursorProcessing(false);
          } else {
            setCustomCursorTelemetry(null);
            setCursorProcessing(false);
          }
          console.info("[auto-zoom][editor] Loaded recording session", {
            sessionId: session.id,
            hasTelemetry: Boolean(session.inputTelemetry),
            telemetryPath: session.inputTelemetryPath,
            existingAutoZoomGeneratedAtMs: session.autoZoomGeneratedAtMs,
          });
        } else {
          const result = await window.electronAPI.getCurrentVideoPath();
          if (result.success && result.path) {
            const videoUrl = toFileUrl(result.path);
            setRecordingSession(null);
            setCameraVideoPath(null);
            setVideoPath(videoUrl);
            setCustomCursorTelemetry(null);
            setCursorProcessing(false);
            console.info("[auto-zoom][editor] Loaded video without recording session context", {
              path: result.path,
            });
          } else {
            setError('No video to load. Please record or select a video.');
            console.warn("[auto-zoom][editor] No video/session available to load");
          }
        }
      } catch (err) {
        setError('Error loading video: ' + String(err));
        console.error("[auto-zoom][editor] Failed while loading video/session", err);
      } finally {
        setCursorProcessing(false);
        setLoading(false);
      }
    }
    loadVideo();
  }, []);

  const applyAutoGeneratedZooms = useCallback((telemetry: InputTelemetryFileV1, showFeedback: boolean, intensity: AutoZoomIntensity) => {
    if (duration <= 0) {
      console.warn("[auto-zoom][editor] Skipping auto-zoom generation because duration is not ready", {
        duration,
      });
      return;
    }

    console.info("[auto-zoom][editor] Generating auto zooms from telemetry", {
      sessionId: telemetry.sessionId,
      totalEvents: telemetry.stats.totalEvents,
      mouseDownCount: telemetry.stats.mouseDownCount,
      keyDownCount: telemetry.stats.keyDownCount,
      wheelCount: telemetry.stats.wheelCount,
      durationMs: Math.round(duration * 1000),
    });
    const generated = generateAutoZoomRegions({
      telemetry,
      durationMs: Math.round(duration * 1000),
      intensity,
    });
    if (generated.length === 0) {
      console.warn("[auto-zoom][editor] Auto-zoom generation produced zero regions", {
        sessionId: telemetry.sessionId,
      });
    } else {
      console.info("[auto-zoom][editor] Auto-zoom generation produced regions", {
        sessionId: telemetry.sessionId,
        count: generated.length,
      });
    }

    const nextRegions: ZoomRegion[] = generated.map((region) => ({
      id: `zoom-${nextZoomIdRef.current++}`,
      startMs: Math.round(region.startMs),
      endMs: Math.round(region.endMs),
      depth: region.depth,
      focus: region.focus,
    }));

    setZoomRegions(nextRegions);
    setSelectedZoomId(null);
    setRecordingSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        autoZoomGeneratedAtMs: Date.now(),
        autoZoomAlgorithmVersion: AUTO_ZOOM_ALGORITHM_VERSION,
        inputTelemetry: {
          ...telemetry,
          generatedAutoZoom: {
            algorithmVersion: AUTO_ZOOM_ALGORITHM_VERSION,
            generatedAtMs: Date.now(),
            preset: intensity,
            regions: generated,
          },
        },
      };
    });

    if (showFeedback) {
      toast.success(`Generated ${nextRegions.length} auto zoom${nextRegions.length === 1 ? "" : "s"}`);
    }
  }, [duration]);

  const regenerateAutoZooms = useCallback(() => {
    if (!recordingSession?.inputTelemetry) {
      console.warn("[auto-zoom][editor] Regenerate requested but no telemetry exists on session", {
        sessionId: recordingSession?.id,
      });
      return;
    }

    if (zoomRegions.length > 0) {
      console.info("[auto-zoom][editor] Regenerate requested with existing zoom regions", {
        sessionId: recordingSession.id,
        existingZoomCount: zoomRegions.length,
      });
      const confirmed = window.confirm("Regenerating auto zooms will replace all existing zoom regions. Continue?");
      if (!confirmed) {
        console.info("[auto-zoom][editor] Regenerate cancelled by user", {
          sessionId: recordingSession.id,
        });
        return;
      }
    }

    setIsAutoZoomGenerating(true);
    try {
      applyAutoGeneratedZooms(recordingSession.inputTelemetry, true, autoZoomIntensity);
    } finally {
      setIsAutoZoomGenerating(false);
    }
  }, [applyAutoGeneratedZooms, autoZoomIntensity, recordingSession, zoomRegions.length]);

  useEffect(() => {
    if (!recordingSession?.inputTelemetry) {
      if (recordingSession && duration > 0) {
        console.info("[auto-zoom][editor] Auto-generation skipped: no telemetry on current session", {
          sessionId: recordingSession.id,
        });
      }
      return;
    }

    if (duration <= 0) {
      console.info("[auto-zoom][editor] Auto-generation waiting for video duration", {
        sessionId: recordingSession.id,
      });
      return;
    }

    const sessionId = recordingSession.id || "";
    if (autoGeneratedSessionIdRef.current === sessionId) {
      console.info("[auto-zoom][editor] Auto-generation skipped: already generated for session in this editor lifecycle", {
        sessionId,
      });
      return;
    }

    autoGeneratedSessionIdRef.current = sessionId;
    console.info("[auto-zoom][editor] Auto-generating zooms for session load", {
      sessionId,
    });
    setIsAutoZoomGenerating(true);
    try {
      const preferredIntensity = recordingSession.inputTelemetry.generatedAutoZoom?.preset ?? autoZoomIntensity;
      applyAutoGeneratedZooms(recordingSession.inputTelemetry, false, preferredIntensity);
    } finally {
      setIsAutoZoomGenerating(false);
    }
  }, [applyAutoGeneratedZooms, autoZoomIntensity, duration, recordingSession]);

  useEffect(() => {
    const preset = recordingSession?.inputTelemetry?.generatedAutoZoom?.preset;
    if (preset) {
      setAutoZoomIntensity(preset);
    }
  }, [recordingSession]);

  const handleStartNewRecording = useCallback(async (replaceCurrentTake: boolean) => {
    setIsStartingNewRecording(true);
    try {
      const result = await window.electronAPI.startNewRecordingSession({
        replaceCurrentTake,
        session: replaceCurrentTake && recordingSession
          ? {
              screenVideoPath: recordingSession.screenVideoPath,
              cameraVideoPath: recordingSession.cameraVideoPath,
              inputTelemetryPath: recordingSession.inputTelemetryPath,
            }
          : undefined,
      });

      if (!result.success) {
        toast.error("Could not start a new recording");
        return;
      }

      console.info("[editor] Starting new recording session", {
        replaceCurrentTake,
      });
      setShowNewRecordingDialog(false);
    } catch (error) {
      console.error("[editor] Failed to start new recording session", error);
      toast.error("Could not start a new recording");
    } finally {
      setIsStartingNewRecording(false);
    }
  }, [recordingSession]);

  // Initialize default wallpaper with resolved asset path
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resolvedPath = await getAssetPath('wallpapers/wallpaper1.jpg');
        if (mounted) {
          setWallpaper(resolvedPath);
        }
      } catch (err) {
        // If resolution fails, keep the fallback
        console.warn('Failed to resolve default wallpaper path:', err);
      }
    })();
    return () => { mounted = false };
  }, []);

  function togglePlayPause() {
    const playback = videoPlaybackRef.current;
    const video = playback?.video;
    if (!playback || !video) return;

    if (isPlaying) {
      playback.pause();
    } else {
      playback.play().catch(err => console.error('Video play failed:', err));
    }
  }

  function handleSeek(time: number) {
    const video = videoPlaybackRef.current?.video;
    if (!video) return;
    video.currentTime = time;
  }

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
    if (id) setSelectedTrimId(null);
  }, []);

  const handleSelectTrim = useCallback((id: string | null) => {
    setSelectedTrimId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedAnnotationId(null);
      setSelectedCameraHiddenId(null);
    }
  }, []);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedCameraHiddenId(null);
    }
  }, []);

  const handleSelectCameraHidden = useCallback((id: string | null) => {
    setSelectedCameraHiddenId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
    }
  }, []);

  const handleZoomAdded = useCallback((span: Span) => {
    const id = `zoom-${nextZoomIdRef.current++}`;
    const newRegion: ZoomRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      depth: DEFAULT_ZOOM_DEPTH,
      focus: { cx: 0.5, cy: 0.5 },
    };
    setZoomRegions((prev) => [...prev, newRegion]);
    setSelectedZoomId(id);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, []);

  const handleTrimAdded = useCallback((span: Span) => {
    const id = `trim-${nextTrimIdRef.current++}`;
    const newRegion: TrimRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setTrimRegions((prev) => [...prev, newRegion]);
    setSelectedTrimId(id);
    setSelectedZoomId(null);
    setSelectedAnnotationId(null);
  }, []);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleTrimSpanChange = useCallback((id: string, span: Span) => {
    setTrimRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleCameraHiddenAdded = useCallback((span: Span) => {
    const id = `camera-hide-${nextCameraHiddenIdRef.current++}`;
    const newRegion: CameraHiddenRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setCameraHiddenRegions((prev) => [...prev, newRegion]);
    setSelectedCameraHiddenId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, []);

  const handleCameraHiddenSpanChange = useCallback((id: string, span: Span) => {
    setCameraHiddenRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleCameraHiddenDelete = useCallback((id: string) => {
    setCameraHiddenRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedCameraHiddenId === id) {
      setSelectedCameraHiddenId(null);
    }
  }, [selectedCameraHiddenId]);

  const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              focus: clampFocusToDepth(focus, region.depth),
            }
          : region,
      ),
    );
  }, []);

  useEffect(() => {
    const loadExportDirectory = async () => {
      const stored = localStorage.getItem(EXPORT_DIRECTORY_STORAGE_KEY);
      if (stored) {
        setExportDirectory(stored);
        return;
      }
      const result = await window.electronAPI.getDefaultExportDirectory();
      if (result.success && result.path) {
        setExportDirectory(result.path);
      }
    };
    loadExportDirectory().catch((error) => {
      console.warn("Failed to load export directory:", error);
    });
  }, []);

  useEffect(() => {
    if (exportDirectory) {
      localStorage.setItem(EXPORT_DIRECTORY_STORAGE_KEY, exportDirectory);
    }
  }, [exportDirectory]);

  useEffect(() => {
    if (safePadding !== padding) {
      emitDiagnostic('warn', 'normalized padding', {
        originalPadding: padding,
        normalizedPadding: safePadding,
      });
    }
  }, [padding, safePadding, emitDiagnostic]);

  const handleZoomDepthChangeForId = useCallback((id: string, depth: ZoomDepth) => {
    const clampedDepth = clampZoomDepth(depth);
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              depth: clampedDepth,
              focus: clampFocusToDepth(region.focus, clampedDepth),
            }
          : region,
      ),
    );
  }, []);

  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    handleZoomDepthChangeForId(selectedZoomId, depth);
  }, [handleZoomDepthChangeForId, selectedZoomId]);

  const handleZoomDelete = useCallback((id: string) => {
    setZoomRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedZoomId === id) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId]);

  const handleTrimDelete = useCallback((id: string) => {
    setTrimRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedTrimId === id) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId]);

  const handleAnnotationAdded = useCallback((span: Span) => {
    const id = `annotation-${nextAnnotationIdRef.current++}`;
    const zIndex = nextAnnotationZIndexRef.current++; // Assign z-index based on creation order
    const newRegion: AnnotationRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      type: 'text',
      content: 'Enter text...',
      position: { ...DEFAULT_ANNOTATION_POSITION },
      size: { ...DEFAULT_ANNOTATION_SIZE },
      style: { ...DEFAULT_ANNOTATION_STYLE },
      zIndex,
    };
    setAnnotationRegions((prev) => [...prev, newRegion]);
    setSelectedAnnotationId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
  }, []);

  const handleAnnotationSpanChange = useCallback((id: string, span: Span) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotationRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId]);

  const handleAnnotationContentChange = useCallback((id: string, content: string) => {
    setAnnotationRegions((prev) => {
      const updated = prev.map((region) => {
        if (region.id !== id) return region;
        
        // Store content in type-specific fields
        if (region.type === 'text') {
          return { ...region, content, textContent: content };
        } else if (region.type === 'image') {
          return { ...region, content, imageContent: content };
        } else {
          return { ...region, content };
        }
      });
      return updated;
    });
  }, []);

  const handleAnnotationTypeChange = useCallback((id: string, type: AnnotationRegion['type']) => {
    setAnnotationRegions((prev) => {
      const updated = prev.map((region) => {
        if (region.id !== id) return region;
        
        const updatedRegion = { ...region, type };
        
        // Restore content from type-specific storage
        if (type === 'text') {
          updatedRegion.content = region.textContent || 'Enter text...';
        } else if (type === 'image') {
          updatedRegion.content = region.imageContent || '';
        } else if (type === 'figure') {
          updatedRegion.content = '';
          if (!region.figureData) {
            updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
          }
        }
        
        return updatedRegion;
      });
      return updated;
    });
  }, []);

  const handleAnnotationStyleChange = useCallback((id: string, style: Partial<AnnotationRegion['style']>) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, style: { ...region.style, ...style } }
          : region,
      ),
    );
  }, []);

  const handleAnnotationFigureDataChange = useCallback((id: string, figureData: FigureData) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, figureData }
          : region,
      ),
    );
  }, []);

  const handleAnnotationPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, position }
          : region,
      ),
    );
  }, []);

  const handleAnnotationSizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, size }
          : region,
      ),
    );
  }, []);
  
  // Global Tab prevention
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Allow tab only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
      }

      if (e.key === ' ' || e.code === 'Space') {
        // Allow space only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
        
        const playback = videoPlaybackRef.current;
        if (playback?.video) {
          if (playback.video.paused) {
            playback.play().catch(console.error);
          } else {
            playback.pause();
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId, zoomRegions]);

  useEffect(() => {
    if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId, trimRegions]);

  useEffect(() => {
    if (selectedAnnotationId && !annotationRegions.some((region) => region.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId, annotationRegions]);

  useEffect(() => {
    if (selectedCameraHiddenId && !cameraHiddenRegions.some((region) => region.id === selectedCameraHiddenId)) {
      setSelectedCameraHiddenId(null);
    }
  }, [selectedCameraHiddenId, cameraHiddenRegions]);

  const handleExport = useCallback(async (settings: ExportSettings) => {
    if (!videoPath) {
      toast.error('No video loaded');
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error('Video not ready');
      return;
    }

    setIsExporting(true);
    setExportProgress({
      currentFrame: 0,
      totalFrames: 1,
      percentage: 0,
      estimatedTimeRemaining: 0,
      phase: 'initializing',
    });
    setExportError(null);

    try {
      const wasPlaying = isPlaying;
      if (wasPlaying) {
        videoPlaybackRef.current?.pause();
      }

      const aspectRatioValue = getAspectRatioValue(aspectRatio);

      // Get preview CONTAINER dimensions for scaling
      const playbackRef = videoPlaybackRef.current;
      const containerElement = playbackRef?.containerRef?.current;
      const previewWidth = containerElement?.clientWidth || 1920;
      const previewHeight = containerElement?.clientHeight || 1080;

      if (settings.format === 'gif' && settings.gifConfig) {
        // GIF Export
        const gifExporter = new GifExporter({
          videoUrl: videoPath,
          cameraVideoUrl: cameraVideoPath || undefined,
          cameraStartOffsetMs: recordingSession?.cameraStartOffsetMs,
          cameraHiddenRegions,
          width: settings.gifConfig.width,
          height: settings.gifConfig.height,
          frameRate: settings.gifConfig.frameRate,
          loop: settings.gifConfig.loop,
          sizePreset: settings.gifConfig.sizePreset,
          wallpaper,
          zoomRegions,
          trimRegions,
          showShadow: shadowIntensity > 0,
          shadowIntensity,
          showBlur,
          motionBlurEnabled,
          cursorTrailEnabled,
          customCursorEnabled: Boolean(recordingSession?.customCursorEnabled),
          customCursorSize,
          borderRadius,
          padding: safePadding,
          videoPadding: safePadding,
          cropRegion,
          inputTelemetry: recordingSession?.inputTelemetry,
          customCursorTelemetry,
          annotationRegions,
          previewWidth,
          previewHeight,
          onProgress: (progress: ExportProgress) => {
            setExportProgress(progress);
          },
        });

        exporterRef.current = gifExporter as unknown as VideoExporter;
        const result = await gifExporter.export();

        if (result.success && result.blob) {
          const arrayBuffer = await result.blob.arrayBuffer();
          const timestamp = Date.now();
          const fileName = `export-${timestamp}.gif`;
          const targetDirectory = exportDirectory || (await window.electronAPI.getDefaultExportDirectory()).path;
          if (!targetDirectory) {
            throw new Error("No export directory available");
          }

          const saveResult = await window.electronAPI.saveExportedVideoToDirectory(arrayBuffer, fileName, targetDirectory);
          if (saveResult.success) {
            if (!exportDirectory) {
              setExportDirectory(targetDirectory);
            }
            toast.success(`GIF exported successfully to ${saveResult.path}`);
          } else {
            setExportError(saveResult.message || 'Failed to save GIF');
            toast.error(saveResult.message || 'Failed to save GIF');
          }
        } else {
          setExportError(result.error || 'GIF export failed');
          toast.error(result.error || 'GIF export failed');
        }
      } else {
        // MP4 Export
        const mp4Settings = settings.mp4Config ?? { frameRate: mp4FrameRate, resolution: mp4Resolution };
        let exportWidth: number;
        let exportHeight: number;
        const targetHeight = mp4Settings.resolution;
        if (aspectRatioValue >= 1) {
          exportHeight = Math.floor(targetHeight / 2) * 2;
          exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;
        } else {
          exportWidth = Math.floor(targetHeight / 2) * 2;
          exportHeight = Math.floor((exportWidth / aspectRatioValue) / 2) * 2;
        }
        const totalPixels = exportWidth * exportHeight;
        let bitrate = 20_000_000;
        if (totalPixels <= 1280 * 720) {
          bitrate = mp4Settings.frameRate === 120 ? 18_000_000 : mp4Settings.frameRate === 60 ? 12_000_000 : 8_000_000;
        } else if (totalPixels <= 1920 * 1080) {
          bitrate = mp4Settings.frameRate === 120 ? 35_000_000 : mp4Settings.frameRate === 60 ? 20_000_000 : 12_000_000;
        } else if (totalPixels <= 2560 * 1440) {
          bitrate = mp4Settings.frameRate === 120 ? 55_000_000 : mp4Settings.frameRate === 60 ? 32_000_000 : 20_000_000;
        } else {
          bitrate = mp4Settings.frameRate === 120 ? 90_000_000 : mp4Settings.frameRate === 60 ? 50_000_000 : 28_000_000;
        }

        const exporter = new VideoExporter({
          videoUrl: videoPath,
          cameraVideoUrl: cameraVideoPath || undefined,
          cameraStartOffsetMs: recordingSession?.cameraStartOffsetMs,
          cameraHiddenRegions,
          width: exportWidth,
          height: exportHeight,
          frameRate: mp4Settings.frameRate,
          bitrate,
          codec: 'avc1.640033',
          wallpaper,
          zoomRegions,
          trimRegions,
          showShadow: shadowIntensity > 0,
          shadowIntensity,
          showBlur,
          motionBlurEnabled,
          cursorTrailEnabled,
          customCursorEnabled: Boolean(recordingSession?.customCursorEnabled),
          customCursorSize,
          borderRadius,
          padding: safePadding,
          cropRegion,
          inputTelemetry: recordingSession?.inputTelemetry,
          customCursorTelemetry,
          annotationRegions,
          previewWidth,
          previewHeight,
          onProgress: (progress: ExportProgress) => {
            setExportProgress(progress);
          },
        });

        exporterRef.current = exporter;
        const result = await exporter.export();

        if (result.success && result.blob) {
          const arrayBuffer = await result.blob.arrayBuffer();
          const timestamp = Date.now();
          const fileName = `export-${timestamp}.mp4`;
          const targetDirectory = exportDirectory || (await window.electronAPI.getDefaultExportDirectory()).path;
          if (!targetDirectory) {
            throw new Error("No export directory available");
          }

          const saveResult = await window.electronAPI.saveExportedVideoToDirectory(arrayBuffer, fileName, targetDirectory);
          if (saveResult.success) {
            if (!exportDirectory) {
              setExportDirectory(targetDirectory);
            }
            toast.success(`Video exported successfully to ${saveResult.path}`);
          } else {
            setExportError(saveResult.message || 'Failed to save video');
            toast.error(saveResult.message || 'Failed to save video');
          }
        } else {
          setExportError(result.error || 'Export failed');
          toast.error(result.error || 'Export failed');
        }
      }

      if (wasPlaying) {
        videoPlaybackRef.current?.play();
      }
    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setExportError(errorMessage);
      toast.error(`Export failed: ${errorMessage}`);
    } finally {
      setIsExporting(false);
      exporterRef.current = null;
      // Reset dialog state to ensure it can be opened again on next export
      // This fixes the bug where second export doesn't show save dialog
      setShowExportDialog(false);
      setExportProgress(null);
    }
  }, [videoPath, cameraVideoPath, recordingSession, cameraHiddenRegions, wallpaper, zoomRegions, trimRegions, shadowIntensity, showBlur, motionBlurEnabled, cursorTrailEnabled, customCursorSize, customCursorTelemetry, borderRadius, safePadding, cropRegion, annotationRegions, isPlaying, aspectRatio, mp4FrameRate, mp4Resolution, exportDirectory]);

  const handleOpenExportDialog = useCallback(() => {
    if (!videoPath) {
      toast.error('No video loaded');
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error('Video not ready');
      return;
    }

    // Build export settings from current state
    const sourceWidth = video.videoWidth || 1920;
    const sourceHeight = video.videoHeight || 1080;
    const gifDimensions = calculateOutputDimensions(sourceWidth, sourceHeight, gifSizePreset, GIF_SIZE_PRESETS);

    const settings: ExportSettings = {
      format: exportFormat,
      mp4Config: exportFormat === 'mp4' ? {
        frameRate: mp4FrameRate,
        resolution: mp4Resolution,
      } : undefined,
      gifConfig: exportFormat === 'gif' ? {
        frameRate: gifFrameRate,
        loop: gifLoop,
        sizePreset: gifSizePreset,
        width: gifDimensions.width,
        height: gifDimensions.height,
      } : undefined,
    };

    setShowExportDialog(true);
    setExportError(null);

    // Start export immediately
    handleExport(settings);
  }, [videoPath, exportFormat, mp4FrameRate, mp4Resolution, gifFrameRate, gifLoop, gifSizePreset, handleExport]);

  const handleChooseExportDirectory = useCallback(async () => {
    const result = await window.electronAPI.chooseExportDirectory(exportDirectory || undefined);
    if (result.success && result.path) {
      setExportDirectory(result.path);
      toast.success(`Export folder set to ${result.path}`);
    } else if (!result.cancelled) {
      toast.error(result.message || 'Failed to choose export folder');
    }
  }, [exportDirectory]);

  const handleOpenExportDirectory = useCallback(async () => {
    if (!exportDirectory) {
      const fallback = await window.electronAPI.getDefaultExportDirectory();
      if (fallback.success && fallback.path) {
        setExportDirectory(fallback.path);
        await window.electronAPI.openDirectory(fallback.path);
      } else {
        toast.error('No export folder configured');
      }
      return;
    }
    const result = await window.electronAPI.openDirectory(exportDirectory);
    if (!result.success) {
      toast.error(result.message || 'Failed to open export folder');
    }
  }, [exportDirectory]);

  const handleCancelExport = useCallback(() => {
    if (exporterRef.current) {
      exporterRef.current.cancel();
      toast.info('Export cancelled');
      setShowExportDialog(false);
      setIsExporting(false);
      setExportProgress(null);
      setExportError(null);
    }
  }, []);

  const handlePaddingChange = useCallback((nextPadding: number) => {
    if (!Number.isFinite(nextPadding)) {
      emitDiagnostic('error', 'rejected invalid padding value', { nextPadding });
      return;
    }
    const clampedPadding = Math.min(100, Math.max(0, nextPadding));
    emitDiagnostic('log', 'padding change', {
      requestedPadding: nextPadding,
      appliedPadding: clampedPadding,
    });
    setPadding(clampedPadding);
  }, [emitDiagnostic]);

  if (loading || cursorProcessing) {
    return (
      <div className="relative h-screen bg-[#09090b] text-slate-200 p-5 overflow-hidden">
        <div className="h-10 rounded-xl border border-white/5 bg-white/[0.02] animate-pulse mb-4" />
        <div className="flex gap-4 h-[calc(100%-56px)]">
          <div className="flex-[7] flex flex-col gap-3">
            <div className="flex-1 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
              <div className="h-full rounded-xl bg-white/[0.03] animate-pulse" />
            </div>
            <div className="h-40 rounded-2xl border border-white/5 bg-white/[0.02] p-3 space-y-2">
              <div className="h-5 w-28 rounded bg-white/10 animate-pulse" />
              <div className="h-8 rounded bg-white/10 animate-pulse" />
              <div className="h-8 rounded bg-white/10 animate-pulse" />
            </div>
          </div>
          <div className="flex-[2] rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
            <div className="h-5 w-24 rounded bg-white/10 animate-pulse" />
            <div className="h-10 rounded bg-white/10 animate-pulse" />
            <div className="h-10 rounded bg-white/10 animate-pulse" />
            <div className="h-10 rounded bg-white/10 animate-pulse" />
            <div className="h-10 rounded bg-white/10 animate-pulse" />
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-xs text-slate-400">
          {loading ? "Loading editor..." : "Processing cursor telemetry..."}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }


  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
      <div
        className="h-7 flex-shrink-0 bg-[#09090b]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div 
        className="h-10 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 flex items-center justify-between pl-24 pr-4 z-50"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          {recordingSession?.inputTelemetry && (
            <>
              <select
                value={autoZoomIntensity}
                onChange={(e) => setAutoZoomIntensity(e.target.value as AutoZoomIntensity)}
                className="h-7 rounded-md border border-white/15 bg-white/5 px-2 text-xs text-slate-200 outline-none hover:bg-white/10"
                title="Auto zoom intensity"
              >
                {AUTO_ZOOM_INTENSITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-black text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={regenerateAutoZooms}
                disabled={isAutoZoomGenerating}
                className="h-7 px-3 rounded-md border border-white/15 bg-white/5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isAutoZoomGenerating ? "Generating..." : "Regenerate Auto Zooms"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowNewRecordingDialog(true)}
            disabled={isStartingNewRecording}
            className="h-7 px-3 rounded-md border border-red-300/20 bg-red-500/70 text-xs text-[#c8f4df] hover:bg-red-700/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            New Recording
          </button>
        </div>
      </div>

      <div className="flex-1 p-5 gap-4 flex min-h-0 relative">
        {/* Left Column - Video & Timeline */}
        <div className="flex-[7] flex flex-col gap-3 min-w-0 h-full">
          <PanelGroup direction="vertical" className="gap-3">
            {/* Top section: video preview and controls */}
            <Panel defaultSize={70} minSize={40}>
              <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
                {/* Video preview */}
                <div className="w-full flex justify-center items-center" style={{ flex: '1 1 auto', margin: '6px 0 0' }}>
                  <div className="relative" style={{ width: 'auto', height: '100%', aspectRatio: sourceAspectRatio, maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
                    <VideoPlayback
                      aspectRatio={aspectRatio}
                      debugDiagnostics
                      previewScale={PREVIEW_QUALITY_SCALE[previewQuality]}
                      ref={videoPlaybackRef}
                      videoPath={videoPath || ''}
                      cameraVideoPath={cameraVideoPath || undefined}
                      cameraStartOffsetMs={recordingSession?.cameraStartOffsetMs}
                      cameraHiddenRegions={cameraHiddenRegions}
                      onDurationChange={setDuration}
                      onTimeUpdate={setCurrentTime}
                      currentTime={currentTime}
                      onPlayStateChange={setIsPlaying}
                      onError={setError}
                      wallpaper={wallpaper}
                      zoomRegions={zoomRegions}
                      selectedZoomId={selectedZoomId}
                      onSelectZoom={handleSelectZoom}
                      onZoomFocusChange={handleZoomFocusChange}
                      onZoomDepthChange={handleZoomDepthChangeForId}
                      isPlaying={isPlaying}
                      showShadow={shadowIntensity > 0}
                      shadowIntensity={shadowIntensity}
                      showBlur={showBlur}
                      motionBlurEnabled={motionBlurEnabled}
                      cursorTrailEnabled={cursorTrailEnabled}
                      customCursorEnabled={Boolean(recordingSession?.customCursorEnabled)}
                      customCursorSize={customCursorSize}
                      inputTelemetry={recordingSession?.inputTelemetry}
                      customCursorTelemetry={customCursorTelemetry}
                      borderRadius={borderRadius}
                      padding={safePadding}
                      cropRegion={cropRegion}
                      trimRegions={trimRegions}
                      annotationRegions={annotationRegions}
                      selectedAnnotationId={selectedAnnotationId}
                      onSelectAnnotation={handleSelectAnnotation}
                      onAnnotationPositionChange={handleAnnotationPositionChange}
                      onAnnotationSizeChange={handleAnnotationSizeChange}
                      onSourceMetadata={({ aspectRatio }) => {
                        if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
                          setSourceAspectRatio(aspectRatio);
                        }
                      }}
                    />
                  </div>
                </div>
                {/* Playback controls */}
                <div className="w-full flex justify-center items-center" style={{ height: '48px', flexShrink: 0, padding: '6px 12px', margin: '6px 0 6px 0' }}>
                  <div style={{ width: '100%', maxWidth: '700px' }}>
                    <PlaybackControls
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      duration={duration}
                      onTogglePlayPause={togglePlayPause}
                      onSeek={handleSeek}
                    />
                  </div>
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="h-3 bg-[#09090b]/80 hover:bg-[#09090b] transition-colors rounded-full mx-4 flex items-center justify-center">
              <div className="w-8 h-1 bg-white/20 rounded-full"></div>
            </PanelResizeHandle>

            {/* Timeline section */}
            <Panel defaultSize={30} minSize={20}>
              <div className="h-full bg-[#09090b] rounded-2xl border border-white/5 shadow-lg overflow-hidden flex flex-col">
            <TimelineEditor
              videoDuration={duration}
              currentTime={currentTime}
              onSeek={handleSeek}
              inputTelemetry={recordingSession?.inputTelemetry}
              zoomRegions={zoomRegions}
              onZoomAdded={handleZoomAdded}
              onZoomSpanChange={handleZoomSpanChange}
              onZoomDelete={handleZoomDelete}
              selectedZoomId={selectedZoomId}
              onSelectZoom={handleSelectZoom}
              trimRegions={trimRegions}
              onTrimAdded={handleTrimAdded}
              onTrimSpanChange={handleTrimSpanChange}
              onTrimDelete={handleTrimDelete}
              selectedTrimId={selectedTrimId}
              onSelectTrim={handleSelectTrim}
              annotationRegions={annotationRegions}
              onAnnotationAdded={handleAnnotationAdded}
              onAnnotationSpanChange={handleAnnotationSpanChange}
              onAnnotationDelete={handleAnnotationDelete}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={handleSelectAnnotation}
              cameraHiddenRegions={recordingSession?.cameraCaptured ? cameraHiddenRegions : []}
              onCameraHiddenAdded={recordingSession?.cameraCaptured ? handleCameraHiddenAdded : undefined}
              onCameraHiddenSpanChange={recordingSession?.cameraCaptured ? handleCameraHiddenSpanChange : undefined}
              onCameraHiddenDelete={recordingSession?.cameraCaptured ? handleCameraHiddenDelete : undefined}
              selectedCameraHiddenId={recordingSession?.cameraCaptured ? selectedCameraHiddenId : null}
              onSelectCameraHidden={recordingSession?.cameraCaptured ? handleSelectCameraHidden : undefined}
              aspectRatio={aspectRatio}
              onAspectRatioChange={setAspectRatio}
            />
              </div>
            </Panel>
          </PanelGroup>
        </div>

          {/* Right section: settings panel */}
          <SettingsPanel
          selected={wallpaper}
          onWallpaperChange={setWallpaper}
          selectedZoomDepth={selectedZoomId ? zoomRegions.find(z => z.id === selectedZoomId)?.depth : null}
          onZoomDepthChange={handleZoomDepthChange}
          selectedZoomId={selectedZoomId}
          onZoomDelete={handleZoomDelete}
          selectedTrimId={selectedTrimId}
          onTrimDelete={handleTrimDelete}
          shadowIntensity={shadowIntensity}
          onShadowChange={setShadowIntensity}
          showBlur={showBlur}
          onBlurChange={setShowBlur}
          motionBlurEnabled={motionBlurEnabled}
          onMotionBlurChange={setMotionBlurEnabled}
          cursorTrailEnabled={cursorTrailEnabled}
          onCursorTrailChange={setCursorTrailEnabled}
          customCursorEnabled={Boolean(recordingSession?.customCursorEnabled)}
          customCursorSize={customCursorSize}
          onCustomCursorSizeChange={setCustomCursorSize}
          previewQuality={previewQuality}
          onPreviewQualityChange={setPreviewQuality}
          borderRadius={borderRadius}
          onBorderRadiusChange={setBorderRadius}
          padding={safePadding}
          onPaddingChange={handlePaddingChange}
          cropRegion={cropRegion}
          onCropChange={setCropRegion}
          aspectRatio={aspectRatio}
          videoElement={videoPlaybackRef.current?.video || null}
          mp4FrameRate={mp4FrameRate}
          onMp4FrameRateChange={setMp4FrameRate}
          mp4Resolution={mp4Resolution}
          onMp4ResolutionChange={setMp4Resolution}
          exportFormat={exportFormat}
          onExportFormatChange={setExportFormat}
          gifFrameRate={gifFrameRate}
          onGifFrameRateChange={setGifFrameRate}
          gifLoop={gifLoop}
          onGifLoopChange={setGifLoop}
          gifSizePreset={gifSizePreset}
          onGifSizePresetChange={setGifSizePreset}
          exportDirectory={exportDirectory}
          onChooseExportDirectory={handleChooseExportDirectory}
          onOpenExportDirectory={handleOpenExportDirectory}
          gifOutputDimensions={calculateOutputDimensions(
            videoPlaybackRef.current?.video?.videoWidth || 1920,
            videoPlaybackRef.current?.video?.videoHeight || 1080,
            gifSizePreset,
            GIF_SIZE_PRESETS
          )}
          onExport={handleOpenExportDialog}
          selectedAnnotationId={selectedAnnotationId}
          annotationRegions={annotationRegions}
          onAnnotationContentChange={handleAnnotationContentChange}
          onAnnotationTypeChange={handleAnnotationTypeChange}
          onAnnotationStyleChange={handleAnnotationStyleChange}
          onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
          onAnnotationDelete={handleAnnotationDelete}
        />
      </div>

      <Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
        <DialogContent className="max-w-md bg-[#111214] border-white/10 text-slate-200">
          <DialogHeader>
            <DialogTitle>Start a New Recording</DialogTitle>
            <DialogDescription className="text-slate-400">
              Choose whether to keep this take or delete it before starting a new recording.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleStartNewRecording(false)}
              disabled={isStartingNewRecording}
              className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-50"
            >
              Keep current take and start a new recording
            </button>
            <button
              type="button"
              onClick={() => handleStartNewRecording(true)}
              disabled={isStartingNewRecording}
              className="w-full rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              Delete current take and start a new recording
            </button>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setShowNewRecordingDialog(false)}
              disabled={isStartingNewRecording}
              className="h-8 rounded-md border border-white/15 bg-white/5 px-3 text-xs hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster theme="dark" className="pointer-events-auto" />
      
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        progress={exportProgress}
        isExporting={isExporting}
        error={exportError}
        onCancel={handleCancelExport}
        exportFormat={exportFormat}
      />
    </div>
  );
}
