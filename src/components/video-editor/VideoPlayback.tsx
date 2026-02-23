import type React from "react";
import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useMemo, useCallback } from "react";
import { getAssetPath } from "@/lib/assetPath";
import { Application, Container, Sprite, Graphics, BlurFilter, Texture, VideoSource } from 'pixi.js';
import { getZoomScale, getZoomDepthFromScale, ZOOM_DEPTH_MAX, ZOOM_DEPTH_MIN, type ZoomRegion, type ZoomFocus, type ZoomDepth, type TrimRegion, type AnnotationRegion, type CameraHiddenRegion } from "./types";
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from "./videoPlayback/constants";
import { clamp01 } from "./videoPlayback/mathUtils";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import { clampFocusToStage as clampFocusToStageUtil } from "./videoPlayback/focusUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { applyZoomTransform } from "./videoPlayback/zoomTransform";
import { createVideoEventHandlers } from "./videoPlayback/videoEventHandlers";
import { type AspectRatio, formatAspectRatioForCSS } from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "./AnnotationOverlay";
import type { InputTelemetryFileV1 } from "@/types/inputTelemetry";
import { getCursorTrailPoints } from "@/lib/autoZoom/cursorTrail";
import {
  buildSmoothedCursorTelemetry,
  drawCustomCursor,
  getCursorClickPulse,
  getCursorSampleAtTime,
  type CustomCursorTelemetry,
} from "@/lib/cursor/customCursor";

interface VideoPlaybackProps {
  videoPath: string;
  previewScale?: number;
  cameraVideoPath?: string;
  cameraStartOffsetMs?: number;
  cameraHiddenRegions?: CameraHiddenRegion[];
  onDurationChange: (duration: number) => void;
  onTimeUpdate: (time: number) => void;
  currentTime: number;
  onPlayStateChange: (playing: boolean) => void;
  onError: (error: string) => void;
  wallpaper?: string;
  zoomRegions: ZoomRegion[];
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
  onZoomDepthChange: (id: string, depth: ZoomDepth) => void;
  isPlaying: boolean;
  showShadow?: boolean;
  shadowIntensity?: number;
  showBlur?: boolean;
  motionBlurEnabled?: boolean;
  cursorTrailEnabled?: boolean;
  customCursorEnabled?: boolean;
  customCursorSize?: number;
  inputTelemetry?: InputTelemetryFileV1;
  customCursorTelemetry?: CustomCursorTelemetry | null;
  borderRadius?: number;
  padding?: number;
  cropRegion?: import('./types').CropRegion;
  trimRegions?: TrimRegion[];
  aspectRatio: AspectRatio;
  annotationRegions?: AnnotationRegion[];
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
  onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
  onSourceMetadata?: (metadata: { width: number; height: number; aspectRatio: number }) => void;
}

export interface VideoPlaybackRef {
  video: HTMLVideoElement | null;
  app: Application | null;
  videoSprite: Sprite | null;
  videoContainer: Container | null;
  containerRef: React.RefObject<HTMLDivElement>;
  play: () => Promise<void>;
  pause: () => void;
}

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(({
  videoPath,
  previewScale = 1,
  cameraVideoPath,
  cameraStartOffsetMs = 0,
  cameraHiddenRegions = [],
  onDurationChange,
  onTimeUpdate,
  currentTime,
  onPlayStateChange,
  onError,
  wallpaper,
  zoomRegions,
  selectedZoomId,
  onSelectZoom,
  onZoomFocusChange,
  onZoomDepthChange,
  isPlaying,
  showShadow,
  shadowIntensity = 0,
  showBlur,
  motionBlurEnabled = false,
  cursorTrailEnabled = false,
  customCursorEnabled = false,
  customCursorSize = 1.2,
  inputTelemetry,
  customCursorTelemetry,
  borderRadius = 0,
  padding = 50,
  cropRegion,
  trimRegions = [],
  aspectRatio,
  annotationRegions = [],
  selectedAnnotationId,
  onSelectAnnotation,
  onAnnotationPositionChange,
  onAnnotationSizeChange,
  onSourceMetadata,
}, ref) => {
  const logDebug = useCallback((_level: 'log' | 'warn' | 'error', _message: string, _payload?: unknown) => {
    void _level;
    void _message;
    void _payload;
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const videoSpriteRef = useRef<Sprite | null>(null);
  const videoContainerRef = useRef<Container | null>(null);
  const cameraContainerRef = useRef<Container | null>(null);
  const timeUpdateAnimationRef = useRef<number | null>(null);
  const [pixiReady, setPixiReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [cameraDuration, setCameraDuration] = useState(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
  const currentTimeRef = useRef(0);
  const zoomRegionsRef = useRef<ZoomRegion[]>([]);
  const selectedZoomIdRef = useRef<string | null>(null);
  const animationStateRef = useRef({ scale: 1, focusX: DEFAULT_FOCUS.cx, focusY: DEFAULT_FOCUS.cy });
  const blurFilterRef = useRef<BlurFilter | null>(null);
  const isDraggingFocusRef = useRef(false);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const baseScaleRef = useRef(1);
  const baseOffsetRef = useRef({ x: 0, y: 0 });
  const baseMaskRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
  const maskGraphicsRef = useRef<Graphics | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isSeekingRef = useRef(false);
  const allowPlaybackRef = useRef(false);
  const lockedVideoDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const layoutVideoContentRef = useRef<(() => void) | null>(null);
  const trimRegionsRef = useRef<TrimRegion[]>([]);
  const motionBlurEnabledRef = useRef(motionBlurEnabled);
  const videoReadyRafRef = useRef<number | null>(null);
  const hasLoadedMetadataRef = useRef(false);
  const paddingRef = useRef(padding);
  const borderRadiusRef = useRef(borderRadius);
  const previewScaleRef = useRef(previewScale);
  const resizeStateRef = useRef<{
    direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
    startX: number;
    startY: number;
    startWidth: number;
    stageWidth: number;
    regionId: string;
  } | null>(null);
  const cursorTrailEnabledRef = useRef(cursorTrailEnabled);
  const inputTelemetryRef = useRef<InputTelemetryFileV1 | undefined>(inputTelemetry);
  const customCursorEnabledRef = useRef(customCursorEnabled);
  const customCursorSizeRef = useRef(customCursorSize);
  const customCursorTelemetryRef = useRef<CustomCursorTelemetry | null>(customCursorTelemetry ?? null);
  const trailGraphicsRef = useRef<Graphics | null>(null);
  const customCursorGraphicsRef = useRef<Graphics | null>(null);
  const cursorEraserGraphicsRef = useRef<Graphics | null>(null);

  const clampFocusToStage = useCallback((focus: ZoomFocus, depth: ZoomDepth) => {
    return clampFocusToStageUtil(focus, depth, stageSizeRef.current);
  }, []);

  const updateOverlayForRegion = useCallback((region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
    const overlayEl = overlayRef.current;
    const indicatorEl = focusIndicatorRef.current;
    
    if (!overlayEl || !indicatorEl) {
      return;
    }

    // Update stage size from overlay dimensions
    const stageWidth = overlayEl.clientWidth;
    const stageHeight = overlayEl.clientHeight;
    if (stageWidth && stageHeight) {
      stageSizeRef.current = { width: stageWidth, height: stageHeight };
    }

    updateOverlayIndicator({
      overlayEl,
      indicatorEl,
      region,
      focusOverride,
      videoSize: videoSizeRef.current,
      baseScale: baseScaleRef.current,
      isPlaying: isPlayingRef.current,
    });
  }, []);

  const layoutVideoContent = useCallback(() => {
    const container = containerRef.current;
    const app = appRef.current;
    const videoSprite = videoSpriteRef.current;
    const maskGraphics = maskGraphicsRef.current;
    const videoElement = videoRef.current;
    const cameraContainer = cameraContainerRef.current;

    if (!container || !app || !videoSprite || !maskGraphics || !videoElement || !cameraContainer) {
      logDebug('warn', 'layout skipped: missing required refs', {
        hasContainer: Boolean(container),
        hasApp: Boolean(app),
        hasVideoSprite: Boolean(videoSprite),
        hasMaskGraphics: Boolean(maskGraphics),
        hasVideoElement: Boolean(videoElement),
        hasCameraContainer: Boolean(cameraContainer),
      });
      return;
    }

    // Lock video dimensions on first layout to prevent resize issues
    if (!lockedVideoDimensionsRef.current && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
      lockedVideoDimensionsRef.current = {
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      };
    }

    const hasInvalidLayoutInput = !Number.isFinite(borderRadius) || !Number.isFinite(padding);
    if (hasInvalidLayoutInput) {
      logDebug('error', 'layout input has invalid number', {
        borderRadius,
        padding,
      });
    }

    let result: ReturnType<typeof layoutVideoContentUtil> = null;
    try {
      result = layoutVideoContentUtil({
        container,
        app,
        videoSprite,
        maskGraphics,
        videoElement,
        cropRegion,
        lockedVideoDimensions: lockedVideoDimensionsRef.current,
        borderRadius,
        padding,
      });
    } catch (error) {
      logDebug('error', 'layoutVideoContentUtil threw', {
        error,
        containerSize: { width: container.clientWidth, height: container.clientHeight },
        videoSize: { width: videoElement.videoWidth, height: videoElement.videoHeight },
        cropRegion,
        borderRadius,
        padding,
      });
      return;
    }

    if (result) {
      const hasInvalidResult =
        !Number.isFinite(result.stageSize.width) ||
        !Number.isFinite(result.stageSize.height) ||
        !Number.isFinite(result.baseScale) ||
        !Number.isFinite(result.baseOffset.x) ||
        !Number.isFinite(result.baseOffset.y) ||
        !Number.isFinite(result.maskRect.width) ||
        !Number.isFinite(result.maskRect.height) ||
        !Number.isFinite(result.maskRect.x) ||
        !Number.isFinite(result.maskRect.y);

      if (hasInvalidResult) {
        logDebug('error', 'layout result contains invalid numbers', {
          result,
          cropRegion,
          borderRadius,
          padding,
        });
      }

      stageSizeRef.current = result.stageSize;
      videoSizeRef.current = result.videoSize;
      baseScaleRef.current = result.baseScale;
      baseOffsetRef.current = result.baseOffset;
      baseMaskRef.current = result.maskRect;
      cropBoundsRef.current = result.cropBounds;

      // Reset camera container to identity
      cameraContainer.scale.set(1);
      cameraContainer.position.set(0, 0);

      const selectedId = selectedZoomIdRef.current;
      const activeRegion = selectedId
        ? zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null
        : null;

      updateOverlayForRegion(activeRegion);
      logDebug('log', 'layout applied', {
        stage: result.stageSize,
        mask: result.maskRect,
        baseScale: result.baseScale,
        padding,
        borderRadius,
      });
    } else {
      logDebug('warn', 'layout returned null', {
        containerSize: { width: container.clientWidth, height: container.clientHeight },
        videoSize: { width: videoElement.videoWidth, height: videoElement.videoHeight },
        lockedVideoDimensions: lockedVideoDimensionsRef.current,
        cropRegion,
        borderRadius,
        padding,
      });
    }
  }, [updateOverlayForRegion, cropRegion, borderRadius, padding, logDebug]);

  useEffect(() => {
    layoutVideoContentRef.current = layoutVideoContent;
  }, [layoutVideoContent]);

  const selectedZoom = useMemo(() => {
    if (!selectedZoomId) return null;
    return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
  }, [zoomRegions, selectedZoomId]);

  useImperativeHandle(ref, () => ({
    video: videoRef.current,
    app: appRef.current,
    videoSprite: videoSpriteRef.current,
    videoContainer: videoContainerRef.current,
    containerRef,
    play: async () => {
      const vid = videoRef.current;
      if (!vid) return;
      try {
        allowPlaybackRef.current = true;
        await vid.play();
      } catch (error) {
        allowPlaybackRef.current = false;
        throw error;
      }
    },
    pause: () => {
      const video = videoRef.current;
      allowPlaybackRef.current = false;
      if (!video) {
        return;
      }
      video.pause();
    },
  }));

  const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;

    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;

    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;

    const rect = overlayEl.getBoundingClientRect();
    const stageWidth = rect.width;
    const stageHeight = rect.height;

    if (!stageWidth || !stageHeight) {
      return;
    }

    stageSizeRef.current = { width: stageWidth, height: stageHeight };

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    const unclampedFocus: ZoomFocus = {
      cx: clamp01(localX / stageWidth),
      cy: clamp01(localY / stageHeight),
    };
    const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

    onZoomFocusChange(region.id, clampedFocus);
    updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
  };

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPlayingRef.current) return;
    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;
    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;
    onSelectZoom(region.id);
    event.preventDefault();
    isDraggingFocusRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizeStateRef.current) return;
    if (!isDraggingFocusRef.current) return;
    event.preventDefault();
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFocusRef.current) return;
    isDraggingFocusRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  const handleResizeHandlePointerDown = (
    direction: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (isPlayingRef.current) return;
    const overlayEl = overlayRef.current;
    const regionId = selectedZoomIdRef.current;
    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!overlayEl || !regionId || !region) return;

    const stageWidth = overlayEl.clientWidth;
    const zoomScale = getZoomScale(region.depth);
    const startWidth = stageWidth / zoomScale;
    resizeStateRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startWidth,
      stageWidth,
      regionId,
    };

    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const region = zoomRegionsRef.current.find((r) => r.id === state.regionId);
      if (!region) return;

      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;

      let projectedDelta = 0;
      if (state.direction === 'e') projectedDelta = deltaX;
      else if (state.direction === 'w') projectedDelta = -deltaX;
      else if (state.direction === 's') projectedDelta = deltaY * (16 / 9);
      else if (state.direction === 'n') projectedDelta = -deltaY * (16 / 9);
      else {
        const horizontal = state.direction.includes('e') ? deltaX : -deltaX;
        const vertical = state.direction.includes('s') ? deltaY * (16 / 9) : -deltaY * (16 / 9);
        projectedDelta = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
      }

      const minWidth = state.stageWidth / getZoomScale(ZOOM_DEPTH_MAX);
      const maxWidth = state.stageWidth / getZoomScale(ZOOM_DEPTH_MIN);
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, state.startWidth + projectedDelta * 1.6));
      const nextDepth = getZoomDepthFromScale(state.stageWidth / nextWidth);

      onZoomDepthChange(region.id, nextDepth);
      updateOverlayForRegion({ ...region, depth: nextDepth });
    };

    const onPointerUp = () => {
      resizeStateRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [onZoomDepthChange, updateOverlayForRegion]);

  useEffect(() => {
    zoomRegionsRef.current = zoomRegions;
  }, [zoomRegions]);

  useEffect(() => {
    selectedZoomIdRef.current = selectedZoomId;
  }, [selectedZoomId]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    trimRegionsRef.current = trimRegions;
  }, [trimRegions]);

  useEffect(() => {
    motionBlurEnabledRef.current = motionBlurEnabled;
  }, [motionBlurEnabled]);

  useEffect(() => {
    cursorTrailEnabledRef.current = cursorTrailEnabled;
  }, [cursorTrailEnabled]);

  useEffect(() => {
    inputTelemetryRef.current = inputTelemetry;
  }, [inputTelemetry]);

  useEffect(() => {
    customCursorEnabledRef.current = customCursorEnabled;
  }, [customCursorEnabled]);

  useEffect(() => {
    customCursorSizeRef.current = customCursorSize;
  }, [customCursorSize]);

  useEffect(() => {
    customCursorTelemetryRef.current = customCursorTelemetry ?? buildSmoothedCursorTelemetry(inputTelemetry);
  }, [customCursorTelemetry, inputTelemetry]);

  useEffect(() => {
    paddingRef.current = padding;
    borderRadiusRef.current = borderRadius;
    previewScaleRef.current = previewScale;
  }, [padding, borderRadius, previewScale]);

  useEffect(() => {
    logDebug('log', 'playback inputs updated', {
      padding,
      borderRadius,
      cropRegion,
      pixiReady,
      videoReady,
    });
  }, [padding, borderRadius, cropRegion, pixiReady, videoReady, logDebug]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const app = appRef.current;
    const cameraContainer = cameraContainerRef.current;
    const video = videoRef.current;

    if (!app || !cameraContainer || !video) return;

    const tickerWasStarted = app.ticker?.started || false;
    if (tickerWasStarted && app.ticker) {
      app.ticker.stop();
    }

    const wasPlaying = !video.paused;
    if (wasPlaying) {
      video.pause();
    }

    animationStateRef.current = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };

    if (blurFilterRef.current) {
      blurFilterRef.current.blur = 0;
    }

    requestAnimationFrame(() => {
      try {
        const container = cameraContainerRef.current;
        const videoStage = videoContainerRef.current;
        const sprite = videoSpriteRef.current;
        const currentApp = appRef.current;
        if (!container || !videoStage || !sprite || !currentApp) {
          logDebug('warn', 'post-reset frame skipped due to missing refs');
          return;
        }

        container.scale.set(1);
        container.position.set(0, 0);
        videoStage.scale.set(1);
        videoStage.position.set(0, 0);
        sprite.scale.set(1);
        sprite.position.set(0, 0);

        layoutVideoContentRef.current?.();

        applyZoomTransform({
          cameraContainer: container,
          blurFilter: blurFilterRef.current,
          stageSize: stageSizeRef.current,
          baseMask: baseMaskRef.current,
          zoomScale: 1,
          focusX: DEFAULT_FOCUS.cx,
          focusY: DEFAULT_FOCUS.cy,
          motionIntensity: 0,
          isPlaying: false,
          motionBlurEnabled: motionBlurEnabledRef.current,
        });

        requestAnimationFrame(() => {
          const finalApp = appRef.current;
          if (wasPlaying && video) {
            video.play().catch((error) => {
              logDebug('warn', 'video resume after reset failed', error);
            });
          }
          if (tickerWasStarted && finalApp?.ticker) {
            finalApp.ticker.start();
          }
        });
      } catch (error) {
        logDebug('error', 'post-reset frame failed', error);
      }
    });
  }, [pixiReady, videoReady, cropRegion, logDebug]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    const container = containerRef.current;
    if (!container) return;

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      try {
        layoutVideoContentRef.current?.();
      } catch (error) {
        logDebug('error', 'resize observer layout failed', error);
      }
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [pixiReady, videoReady, logDebug]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    updateOverlayForRegion(selectedZoom);
  }, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    try {
      layoutVideoContentRef.current?.();
      logDebug('log', 'applied manual relayout for style controls', {
        padding,
        borderRadius,
        cropRegion,
      });
    } catch (error) {
      logDebug('error', 'manual relayout failed', error);
    }
  }, [pixiReady, videoReady, padding, borderRadius, cropRegion, logDebug]);

  useEffect(() => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;
    if (!selectedZoom) {
      overlayEl.style.cursor = 'default';
      overlayEl.style.pointerEvents = 'none';
      return;
    }
    overlayEl.style.cursor = isPlaying ? 'not-allowed' : 'grab';
    overlayEl.style.pointerEvents = isPlaying ? 'none' : 'auto';
  }, [selectedZoom, isPlaying]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;
    let app: Application | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let handleContextLost: ((event: Event) => void) | null = null;
    let handleContextRestored: (() => void) | null = null;

    (async () => {
      try {
        app = new Application();

        const initialPreviewScale = previewScaleRef.current;
        const resolution = Math.max(0.25, (window.devicePixelRatio || 1) * initialPreviewScale);
        logDebug('log', 'initializing pixi app', {
          containerSize: { width: container.clientWidth, height: container.clientHeight },
          previewScale: initialPreviewScale,
          devicePixelRatio: window.devicePixelRatio || 1,
          resolution,
        });

        await app.init({
          width: container.clientWidth,
          height: container.clientHeight,
          backgroundAlpha: 0,
          antialias: true,
          resolution,
          autoDensity: true,
        });

        app.ticker.maxFPS = 60;

        if (!mounted) {
          app.destroy(true, { children: true, texture: true, textureSource: true });
          return;
        }

        appRef.current = app;
        container.appendChild(app.canvas);
        canvas = app.canvas as HTMLCanvasElement;
        handleContextLost = (event: Event) => {
          event.preventDefault();
          logDebug('error', 'webgl context lost', {
            padding: paddingRef.current,
            borderRadius: borderRadiusRef.current,
            previewScale: previewScaleRef.current,
            devicePixelRatio: window.devicePixelRatio || 1,
          });
        };
        handleContextRestored = () => {
          logDebug('warn', 'webgl context restored');
        };
        canvas.addEventListener('webglcontextlost', handleContextLost, { passive: false });
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        // Camera container - this will be scaled/positioned for zoom
        const cameraContainer = new Container();
        cameraContainerRef.current = cameraContainer;
        app.stage.addChild(cameraContainer);

        // Video container - holds the masked video sprite
        const videoContainer = new Container();
        videoContainerRef.current = videoContainer;
        cameraContainer.addChild(videoContainer);

        const trailGraphics = new Graphics();
        trailGraphicsRef.current = trailGraphics;
        cameraContainer.addChild(trailGraphics);

        const cursorEraserGraphics = new Graphics();
        cursorEraserGraphics.blendMode = 'erase';
        cursorEraserGraphicsRef.current = cursorEraserGraphics;
        videoContainer.addChild(cursorEraserGraphics);

        const customCursorGraphics = new Graphics();
        customCursorGraphicsRef.current = customCursorGraphics;
        cameraContainer.addChild(customCursorGraphics);
        
        setPixiReady(true);
        logDebug('log', 'pixi app initialized');
      } catch (error) {
        logDebug('error', 'pixi initialization failed', error);
      }
    })();

    return () => {
      mounted = false;
      setPixiReady(false);
      if (canvas && handleContextLost) {
        canvas.removeEventListener('webglcontextlost', handleContextLost);
      }
      if (canvas && handleContextRestored) {
        canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      }
      if (app && app.renderer) {
        app.destroy(true, { children: true, texture: true, textureSource: true });
      }
      appRef.current = null;
      cameraContainerRef.current = null;
      videoContainerRef.current = null;
      videoSpriteRef.current = null;
      trailGraphicsRef.current = null;
      customCursorGraphicsRef.current = null;
      cursorEraserGraphicsRef.current = null;
    };
  }, [logDebug]);

  useEffect(() => {
    const app = appRef.current;
    const container = containerRef.current;
    if (!app || !container) return;

    const nextResolution = Math.max(0.25, (window.devicePixelRatio || 1) * previewScale);
    const currentResolution = app.renderer.resolution;
    if (Math.abs(currentResolution - nextResolution) < 0.001) return;

    try {
      app.renderer.resolution = nextResolution;
      app.renderer.resize(container.clientWidth, container.clientHeight);
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      layoutVideoContentRef.current?.();
      logDebug('log', 'updated preview resolution in place', {
        previousResolution: currentResolution,
        nextResolution,
        previewScale,
      });
    } catch (error) {
      logDebug('error', 'failed to update preview resolution in place', error);
    }
  }, [previewScale, logDebug]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    allowPlaybackRef.current = false;
    lockedVideoDimensionsRef.current = null;
    hasLoadedMetadataRef.current = false;
    setVideoReady(false);
    if (videoReadyRafRef.current) {
      cancelAnimationFrame(videoReadyRafRef.current);
      videoReadyRafRef.current = null;
    }
  }, [videoPath]);

  useEffect(() => {
    const cameraVideo = cameraVideoRef.current;
    if (!cameraVideoPath || !cameraVideo) return;

    const offsetSeconds = Math.max(0, cameraStartOffsetMs / 1000);
    const cameraTime = currentTime - offsetSeconds;

    if (cameraTime < 0) {
      if (!cameraVideo.paused) cameraVideo.pause();
      return;
    }

    if (Math.abs(cameraVideo.currentTime - cameraTime) > 0.2) {
      cameraVideo.currentTime = Math.max(0, cameraTime);
    }

    if (isPlaying && cameraVideo.paused) {
      cameraVideo.play().catch(() => {
      });
    } else if (!isPlaying && !cameraVideo.paused) {
      cameraVideo.pause();
    }
  }, [cameraVideoPath, cameraStartOffsetMs, currentTime, isPlaying]);



  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const video = videoRef.current;
    const app = appRef.current;
    const videoContainer = videoContainerRef.current;
    
    if (!video || !app || !videoContainer) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    
    let videoTexture: Texture | null = null;
    let videoSprite: Sprite | null = null;
    let maskGraphics: Graphics | null = null;
    try {
      const source = VideoSource.from(video);
      if ('autoPlay' in source) {
        (source as { autoPlay?: boolean }).autoPlay = false;
      }
      if ('autoUpdate' in source) {
        (source as { autoUpdate?: boolean }).autoUpdate = true;
      }
      videoTexture = Texture.from(source);
      
      videoSprite = new Sprite(videoTexture);
      videoSpriteRef.current = videoSprite;
      
      maskGraphics = new Graphics();
      videoContainer.addChild(videoSprite);
      videoContainer.addChild(maskGraphics);
      videoContainer.mask = maskGraphics;
      maskGraphicsRef.current = maskGraphics;
      logDebug('log', 'video sprite + mask created', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      });
    } catch (error) {
      logDebug('error', 'failed creating video texture/sprite', {
        error,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      });
      return;
    }

    animationStateRef.current = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };

    const blurFilter = new BlurFilter();
    blurFilter.quality = 3;
    blurFilter.resolution = app.renderer.resolution;
    blurFilter.blur = 0;
    videoContainer.filters = [blurFilter];
    blurFilterRef.current = blurFilter;
    
    layoutVideoContentRef.current?.();
    video.pause();

    const { handlePlay, handlePause, handleSeeked, handleSeeking } = createVideoEventHandlers({
      video,
      isSeekingRef,
      isPlayingRef,
      allowPlaybackRef,
      currentTimeRef,
      timeUpdateAnimationRef,
      onPlayStateChange,
      onTimeUpdate,
      trimRegionsRef,
    });
    
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('seeking', handleSeeking);
    const raf = timeUpdateAnimationRef;

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('seeking', handleSeeking);

      if (raf.current) {
        cancelAnimationFrame(raf.current);
      }
      
      if (videoSprite) {
        videoContainer.removeChild(videoSprite);
        videoSprite.destroy();
      }
      if (maskGraphics) {
        videoContainer.removeChild(maskGraphics);
        maskGraphics.destroy();
      }
      videoContainer.mask = null;
      maskGraphicsRef.current = null;
      if (blurFilterRef.current) {
        videoContainer.filters = [];
        blurFilterRef.current.destroy();
        blurFilterRef.current = null;
      }
      videoTexture?.destroy(true);
      
      videoSpriteRef.current = null;
    };
  }, [pixiReady, videoReady, onTimeUpdate, updateOverlayForRegion, onPlayStateChange, logDebug]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const app = appRef.current;
    const videoSprite = videoSpriteRef.current;
    const videoContainer = videoContainerRef.current;
    if (!app || !videoSprite || !videoContainer) return;

    const applyTransform = (motionIntensity: number) => {
      const cameraContainer = cameraContainerRef.current;
      if (!cameraContainer) return;

      const state = animationStateRef.current;

      applyZoomTransform({
        cameraContainer,
        blurFilter: blurFilterRef.current,
        stageSize: stageSizeRef.current,
        baseMask: baseMaskRef.current,
        zoomScale: state.scale,
        focusX: state.focusX,
        focusY: state.focusY,
        motionIntensity,
        isPlaying: isPlayingRef.current,
        motionBlurEnabled: motionBlurEnabledRef.current,
      });
    };

    const drawCursorTrail = () => {
      const trailGraphics = trailGraphicsRef.current;
      trailGraphics?.clear();
      if (!trailGraphics || !cursorTrailEnabledRef.current) return;

      const telemetry = inputTelemetryRef.current;
      if (!telemetry) return;

      const absoluteTimeMs = telemetry.startedAtMs + currentTimeRef.current;
      const points = getCursorTrailPoints(telemetry, absoluteTimeMs, 1100, 14);
      if (points.length === 0) return;

      const lockedVideo = lockedVideoDimensionsRef.current;
      const sourceWidth = lockedVideo?.width || videoRef.current?.videoWidth || 0;
      const sourceHeight = lockedVideo?.height || videoRef.current?.videoHeight || 0;
      if (!sourceWidth || !sourceHeight) return;

      const cropBounds = cropBoundsRef.current;
      const baseScale = baseScaleRef.current;
      const baseOffset = baseOffsetRef.current;

      for (const point of points) {
        const sourceX = point.xNorm * sourceWidth;
        const sourceY = point.yNorm * sourceHeight;
        if (sourceX < cropBounds.startX || sourceX > cropBounds.endX || sourceY < cropBounds.startY || sourceY > cropBounds.endY) {
          continue;
        }

        const stageX = baseOffset.x + sourceX * baseScale;
        const stageY = baseOffset.y + sourceY * baseScale;
        const alpha = point.ageRatio * point.ageRatio * 0.4 * point.emphasis;
        const radius = Math.max(2, 4.5 * point.ageRatio * point.emphasis);
        trailGraphics.circle(stageX, stageY, radius).fill({ color: 0x34b27b, alpha });
      }
    };

    const drawCustomCursorOverlay = () => {
      const cursorGraphics = customCursorGraphicsRef.current;
      cursorGraphics?.clear();
      if (!cursorGraphics || !customCursorEnabledRef.current) return;

      const telemetry = customCursorTelemetryRef.current;
      const rawTelemetry = inputTelemetryRef.current;
      if (!telemetry || !rawTelemetry) return;

      const absoluteTimeMs = rawTelemetry.startedAtMs + currentTimeRef.current;
      const sample = getCursorSampleAtTime(telemetry, absoluteTimeMs);
      if (!sample) return;

      const lockedVideo = lockedVideoDimensionsRef.current;
      const sourceWidth = lockedVideo?.width || videoRef.current?.videoWidth || 0;
      const sourceHeight = lockedVideo?.height || videoRef.current?.videoHeight || 0;
      if (!sourceWidth || !sourceHeight) return;

      const sourceX = sample.xNorm * sourceWidth;
      const sourceY = sample.yNorm * sourceHeight;
      const cropBounds = cropBoundsRef.current;
      if (sourceX < cropBounds.startX || sourceX > cropBounds.endX || sourceY < cropBounds.startY || sourceY > cropBounds.endY) {
        return;
      }

      const baseScale = baseScaleRef.current;
      const baseOffset = baseOffsetRef.current;
      const stageX = baseOffset.x + sourceX * baseScale;
      const stageY = baseOffset.y + sourceY * baseScale;
      const prev = getCursorSampleAtTime(telemetry, absoluteTimeMs - 16);
      const prevStageX = prev ? baseOffset.x + prev.xNorm * sourceWidth * baseScale : stageX;
      const prevStageY = prev ? baseOffset.y + prev.yNorm * sourceHeight * baseScale : stageY;
      const velocityX = stageX - prevStageX;
      const velocityY = stageY - prevStageY;
      const pulse = getCursorClickPulse(telemetry.clicks, absoluteTimeMs);
      drawCustomCursor(
        cursorGraphics,
        stageX,
        stageY,
        baseScale * customCursorSizeRef.current * 22,
        sample.cursorType,
        pulse,
        velocityX,
        velocityY
      );
    };

    const eraseNativeCursor = () => {
      const eraser = cursorEraserGraphicsRef.current;
      eraser?.clear();
      if (!eraser || !customCursorEnabledRef.current) return;

      const telemetry = customCursorTelemetryRef.current;
      const rawTelemetry = inputTelemetryRef.current;
      if (!telemetry || !rawTelemetry) return;

      const absoluteTimeMs = rawTelemetry.startedAtMs + currentTimeRef.current;
      const sample = getCursorSampleAtTime(telemetry, absoluteTimeMs);
      if (!sample) return;

      const lockedVideo = lockedVideoDimensionsRef.current;
      const sourceWidth = lockedVideo?.width || videoRef.current?.videoWidth || 0;
      const sourceHeight = lockedVideo?.height || videoRef.current?.videoHeight || 0;
      if (!sourceWidth || !sourceHeight) return;

      const sourceX = sample.xNorm * sourceWidth;
      const sourceY = sample.yNorm * sourceHeight;
      const cropBounds = cropBoundsRef.current;
      if (sourceX < cropBounds.startX || sourceX > cropBounds.endX || sourceY < cropBounds.startY || sourceY > cropBounds.endY) {
        return;
      }

      const baseScale = baseScaleRef.current;
      const localX = (sourceX - cropBounds.startX) * baseScale;
      const localY = (sourceY - cropBounds.startY) * baseScale;
      const radius = Math.max(9, baseScale * customCursorSizeRef.current * 14);
      eraser.circle(localX, localY, radius).fill({ color: 0xffffff, alpha: 1 });
    };

    const ticker = () => {
      try {
        const { region, strength } = findDominantRegion(zoomRegionsRef.current, currentTimeRef.current);
      
      const defaultFocus = DEFAULT_FOCUS;
      let targetScaleFactor = 1;
      let targetFocus = defaultFocus;

      // If a zoom is selected but video is not playing, show default unzoomed view
      // (the overlay will show where the zoom will be)
      const selectedId = selectedZoomIdRef.current;
      const hasSelectedZoom = selectedId !== null;
      const shouldShowUnzoomedView = hasSelectedZoom && !isPlayingRef.current;

      if (region && strength > 0 && !shouldShowUnzoomedView) {
        const zoomScale = getZoomScale(region.depth);
        const regionFocus = clampFocusToStage(region.focus, region.depth);
        
        // Interpolate scale and focus based on region strength
        targetScaleFactor = 1 + (zoomScale - 1) * strength;
        targetFocus = {
          cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
          cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
        };
      }

      const state = animationStateRef.current;

      const prevScale = state.scale;
      const prevFocusX = state.focusX;
      const prevFocusY = state.focusY;

      const scaleDelta = targetScaleFactor - state.scale;
      const focusXDelta = targetFocus.cx - state.focusX;
      const focusYDelta = targetFocus.cy - state.focusY;

      let nextScale = prevScale;
      let nextFocusX = prevFocusX;
      let nextFocusY = prevFocusY;

      if (Math.abs(scaleDelta) > MIN_DELTA) {
        nextScale = prevScale + scaleDelta * SMOOTHING_FACTOR;
      } else {
        nextScale = targetScaleFactor;
      }

      if (Math.abs(focusXDelta) > MIN_DELTA) {
        nextFocusX = prevFocusX + focusXDelta * SMOOTHING_FACTOR;
      } else {
        nextFocusX = targetFocus.cx;
      }

      if (Math.abs(focusYDelta) > MIN_DELTA) {
        nextFocusY = prevFocusY + focusYDelta * SMOOTHING_FACTOR;
      } else {
        nextFocusY = targetFocus.cy;
      }

      state.scale = nextScale;
      state.focusX = nextFocusX;
      state.focusY = nextFocusY;

      const motionIntensity = Math.max(
        Math.abs(nextScale - prevScale),
        Math.abs(nextFocusX - prevFocusX),
        Math.abs(nextFocusY - prevFocusY)
      );

        applyTransform(motionIntensity);
        drawCursorTrail();
        eraseNativeCursor();
        drawCustomCursorOverlay();
      } catch (error) {
        logDebug('error', 'ticker loop failed', {
          error,
          currentTimeMs: currentTimeRef.current,
          selectedZoomId: selectedZoomIdRef.current,
          stageSize: stageSizeRef.current,
          baseMask: baseMaskRef.current,
          padding,
          borderRadius,
        });
      }
    };

    app.ticker.add(ticker);
    return () => {
      if (app && app.ticker) {
        app.ticker.remove(ticker);
      }
    };
  }, [pixiReady, videoReady, clampFocusToStage, logDebug, padding, borderRadius]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    hasLoadedMetadataRef.current = true;
    logDebug('log', 'video metadata loaded', {
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      networkState: video.networkState,
      videoPath,
    });
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const sourceAspectRatio = video.videoWidth / video.videoHeight;
      onSourceMetadata?.({
        width: video.videoWidth,
        height: video.videoHeight,
        aspectRatio: sourceAspectRatio,
      });
    }
    onDurationChange(video.duration);
    video.currentTime = 0;
    video.pause();
    allowPlaybackRef.current = false;
    currentTimeRef.current = 0;

    if (videoReadyRafRef.current) {
      cancelAnimationFrame(videoReadyRafRef.current);
      videoReadyRafRef.current = null;
    }

    const waitForRenderableFrame = () => {
      const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
      const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      if (hasDimensions && hasData) {
        videoReadyRafRef.current = null;
        setVideoReady(true);
        logDebug('log', 'video renderable frame ready', {
          readyState: video.readyState,
          currentTime: video.currentTime,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
        return;
      }
      videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
    };

    videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);

    window.setTimeout(() => {
      if (videoReadyRafRef.current !== null) {
        logDebug('warn', 'video not renderable after timeout', {
          readyState: video.readyState,
          networkState: video.networkState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          currentTime: video.currentTime,
          src: video.currentSrc,
        });
      }
    }, 3000);
  };

  const [resolvedWallpaper, setResolvedWallpaper] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        if (!wallpaper) {
          const def = await getAssetPath('wallpapers/wallpaper1.jpg')
          if (mounted) setResolvedWallpaper(def)
          return
        }

        if (wallpaper.startsWith('#') || wallpaper.startsWith('linear-gradient') || wallpaper.startsWith('radial-gradient')) {
          if (mounted) setResolvedWallpaper(wallpaper)
          return
        }

        // If it's a data URL (custom uploaded image), use as-is
        if (wallpaper.startsWith('data:')) {
          if (mounted) setResolvedWallpaper(wallpaper)
          return
        }

        // If it's an absolute web/http or file path, use as-is
        if (wallpaper.startsWith('http') || wallpaper.startsWith('file://') || wallpaper.startsWith('/')) {
          // If it's an absolute server path (starts with '/'), resolve via getAssetPath as well
          if (wallpaper.startsWith('/')) {
            const rel = wallpaper.replace(/^\//, '')
            const p = await getAssetPath(rel)
            if (mounted) setResolvedWallpaper(p)
            return
          }
          if (mounted) setResolvedWallpaper(wallpaper)
          return
        }
        const p = await getAssetPath(wallpaper.replace(/^\//, ''))
        if (mounted) setResolvedWallpaper(p)
      } catch (err) {
        logDebug('warn', 'wallpaper resolution failed', { wallpaper, error: err });
        if (mounted) setResolvedWallpaper(wallpaper || '/wallpapers/wallpaper1.jpg')
      }
    })()
    return () => { mounted = false }
  }, [wallpaper, logDebug])

  useEffect(() => {
    return () => {
      if (videoReadyRafRef.current) {
        cancelAnimationFrame(videoReadyRafRef.current);
        videoReadyRafRef.current = null;
      }
    };
  }, [])

  const isImageUrl = Boolean(resolvedWallpaper && (resolvedWallpaper.startsWith('file://') || resolvedWallpaper.startsWith('http') || resolvedWallpaper.startsWith('/') || resolvedWallpaper.startsWith('data:')))
  const backgroundStyle = isImageUrl
    ? { backgroundImage: `url(${resolvedWallpaper || ''})` }
    : { background: resolvedWallpaper || '' };

  const currentTimeMs = Math.round(currentTime * 1000);
  const cameraTimeMs = currentTimeMs - Math.max(0, cameraStartOffsetMs);
  const isCameraHidden = cameraHiddenRegions.some(
    (region) => cameraTimeMs >= region.startMs && cameraTimeMs < region.endMs
  );
  const canShowCameraBubble =
    Boolean(cameraVideoPath) &&
    cameraTimeMs >= 0 &&
    cameraTimeMs <= cameraDuration * 1000 &&
    !isCameraHidden;

  return (
    <div className="relative rounded-sm overflow-hidden" style={{ width: '100%', aspectRatio: formatAspectRatioForCSS(aspectRatio) }}>
      {/* Background layer - always render as DOM element with blur */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          ...backgroundStyle,
          filter: showBlur ? 'blur(2px)' : 'none',
        }}
      />
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          filter: (showShadow && shadowIntensity > 0)
            ? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
            : 'none',
        }}
      />
      {/* Only render overlay after PIXI and video are fully initialized */}
      {pixiReady && videoReady && (
        <div
          ref={overlayRef}
          className="absolute inset-0 select-none"
          style={{ pointerEvents: 'none' }}
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
          onPointerLeave={handleOverlayPointerLeave}
        >
          <div
            ref={focusIndicatorRef}
            className="absolute rounded-md border border-[#34B27B]/80 bg-[#34B27B]/20 shadow-[0_0_0_1px_rgba(52,178,123,0.35)]"
            style={{ display: 'none', pointerEvents: 'auto' }}
          >
            {([
              { dir: 'n', className: 'absolute left-1/2 -top-1 h-2 w-6 -translate-x-1/2 cursor-ns-resize' },
              { dir: 's', className: 'absolute left-1/2 -bottom-1 h-2 w-6 -translate-x-1/2 cursor-ns-resize' },
              { dir: 'e', className: 'absolute right-[-4px] top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize' },
              { dir: 'w', className: 'absolute left-[-4px] top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize' },
              { dir: 'ne', className: 'absolute right-[-4px] -top-1 h-3 w-3 cursor-nesw-resize' },
              { dir: 'nw', className: 'absolute left-[-4px] -top-1 h-3 w-3 cursor-nwse-resize' },
              { dir: 'se', className: 'absolute right-[-4px] -bottom-1 h-3 w-3 cursor-nwse-resize' },
              { dir: 'sw', className: 'absolute left-[-4px] -bottom-1 h-3 w-3 cursor-nesw-resize' },
            ] as const).map((handle) => (
              <div
                key={handle.dir}
                className={handle.className}
                onPointerDown={(event) => handleResizeHandlePointerDown(handle.dir, event)}
              />
            ))}
          </div>
          {(() => {
            const filtered = (annotationRegions || []).filter((annotation) => {
              if (typeof annotation.startMs !== 'number' || typeof annotation.endMs !== 'number') return false;
              
              if (annotation.id === selectedAnnotationId) return true;
              
              const timeMs = Math.round(currentTime * 1000);
              return timeMs >= annotation.startMs && timeMs <= annotation.endMs;
            });
            
            // Sort by z-index (lowest to highest) so higher z-index renders on top
            const sorted = [...filtered].sort((a, b) => a.zIndex - b.zIndex);
            
            // Handle click-through cycling: when clicking same annotation, cycle to next
            const handleAnnotationClick = (clickedId: string) => {
              if (!onSelectAnnotation) return;
              
              // If clicking on already selected annotation and there are multiple overlapping
              if (clickedId === selectedAnnotationId && sorted.length > 1) {
                // Find current index and cycle to next
                const currentIndex = sorted.findIndex(a => a.id === clickedId);
                const nextIndex = (currentIndex + 1) % sorted.length;
                onSelectAnnotation(sorted[nextIndex].id);
              } else {
                // First click or clicking different annotation
                onSelectAnnotation(clickedId);
              }
            };
            
            return sorted.map((annotation) => (
              <AnnotationOverlay
                key={annotation.id}
                annotation={annotation}
                isSelected={annotation.id === selectedAnnotationId}
                containerWidth={overlayRef.current?.clientWidth || 800}
                containerHeight={overlayRef.current?.clientHeight || 600}
                onPositionChange={(id, position) => onAnnotationPositionChange?.(id, position)}
                onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
                onClick={handleAnnotationClick}
                zIndex={annotation.zIndex}
                isSelectedBoost={annotation.id === selectedAnnotationId}
              />
            ));
          })()}
        </div>
      )}
      {cameraVideoPath && (
        <div
          className="absolute z-40 overflow-hidden border border-white/20 bg-black/70 shadow-2xl"
          style={{
            right: '3%',
            top: '3%',
            width: '18%',
            aspectRatio: '16 / 9',
            borderRadius: 14,
            display: canShowCameraBubble ? 'block' : 'none',
          }}
        >
          <video
            ref={cameraVideoRef}
            src={cameraVideoPath}
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setCameraDuration(e.currentTarget.duration || 0)}
          />
        </div>
      )}
      <video
        ref={videoRef}
        src={videoPath}
        className="hidden"
        preload="metadata"
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={e => {
          onDurationChange(e.currentTarget.duration);
        }}
        onError={(e) => {
          const mediaEl = e.currentTarget;
          const hasRequestedVideoPath = Boolean(videoPath && videoPath.trim().length > 0);
          const hasSrc = Boolean(mediaEl.currentSrc);
          const hasConcreteMediaError = Boolean(mediaEl.error);
          const isEmptyNetworkState = mediaEl.networkState === HTMLMediaElement.NETWORK_EMPTY;
          const hadSuccessfulLoad = hasLoadedMetadataRef.current || videoReady;

          if (!hasRequestedVideoPath || !hasSrc || (!hasConcreteMediaError && isEmptyNetworkState)) {
            logDebug('warn', 'ignoring transient video error event', {
              error: mediaEl.error,
              networkState: mediaEl.networkState,
              readyState: mediaEl.readyState,
              currentSrc: mediaEl.currentSrc,
              requestedVideoPath: videoPath,
            });
            return;
          }

          if (hadSuccessfulLoad) {
            logDebug('warn', 'ignoring post-load video error event', {
              error: mediaEl.error,
              networkState: mediaEl.networkState,
              readyState: mediaEl.readyState,
              currentSrc: mediaEl.currentSrc,
              requestedVideoPath: videoPath,
            });
            return;
          }

          logDebug('error', 'video element error event', {
            error: mediaEl.error,
            networkState: mediaEl.networkState,
            readyState: mediaEl.readyState,
            currentSrc: mediaEl.currentSrc,
            requestedVideoPath: videoPath,
          });
          onError('Failed to load video');
        }}
      />
    </div>
  );
});

VideoPlayback.displayName = 'VideoPlayback';

export default VideoPlayback;
