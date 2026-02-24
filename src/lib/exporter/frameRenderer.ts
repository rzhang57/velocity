import { Application, Container, Sprite, Graphics, BlurFilter, Texture } from 'pixi.js';
import type { ZoomRegion, CropRegion, AnnotationRegion, CameraHiddenRegion } from '@/components/video-editor/types';
import { getZoomScale } from '@/components/video-editor/types';
import { findDominantRegion } from '@/components/video-editor/videoPlayback/zoomRegionUtils';
import { applyZoomTransform } from '@/components/video-editor/videoPlayback/zoomTransform';
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from '@/components/video-editor/videoPlayback/constants';
import { clampFocusToStage as clampFocusToStageUtil } from '@/components/video-editor/videoPlayback/focusUtils';
import { renderAnnotations } from './annotationRenderer';
import type { InputTelemetryFileV1 } from '@/types/inputTelemetry';
import { getCursorTrailPoints } from '@/lib/autoZoom/cursorTrail';
import {
  buildSmoothedCursorTelemetry,
  drawCustomCursor,
  getCursorClickPulse,
  getCursorSampleAtTime,
  type CustomCursorTelemetry,
} from '@/lib/cursor/customCursor';

interface FrameRenderConfig {
  width: number;
  height: number;
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  cursorTrailEnabled?: boolean;
  customCursorEnabled?: boolean;
  customCursorSize?: number;
  inputTelemetry?: InputTelemetryFileV1;
  customCursorTelemetry?: CustomCursorTelemetry | null;
  borderRadius?: number;
  padding?: number;
  cropRegion: CropRegion;
  videoWidth: number;
  videoHeight: number;
  annotationRegions?: AnnotationRegion[];
  previewWidth?: number;
  previewHeight?: number;
  cameraVideoUrl?: string;
  cameraStartOffsetMs?: number;
  cameraHiddenRegions?: CameraHiddenRegion[];
}

interface AnimationState {
  scale: number;
  focusX: number;
  focusY: number;
}

interface LayoutCache {
  stageSize: { width: number; height: number };
  videoSize: { width: number; height: number };
  baseScale: number;
  baseOffset: { x: number; y: number };
  maskRect: { x: number; y: number; width: number; height: number };
}

// Renders video frames with all effects (background, zoom, crop, blur, shadow) to an offscreen canvas for export.

export class FrameRenderer {
  private app: Application | null = null;
  private cameraContainer: Container | null = null;
  private videoContainer: Container | null = null;
  private videoSprite: Sprite | null = null;
  private backgroundSprite: Sprite | null = null;
  private maskGraphics: Graphics | null = null;
  private blurFilter: BlurFilter | null = null;
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private compositeCanvas: HTMLCanvasElement | null = null;
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private config: FrameRenderConfig;
  private animationState: AnimationState;
  private layoutCache: LayoutCache | null = null;
  private currentVideoTime = 0;
  private cameraElement: HTMLVideoElement | null = null;
  private cameraReady = false;
  private shouldRenderCamera = false;
  private trailGraphics: Graphics | null = null;
  private cursorGraphics: Graphics | null = null;
  private cursorEraserGraphics: Graphics | null = null;
  private smoothedCursorTelemetry: CustomCursorTelemetry | null = null;

  constructor(config: FrameRenderConfig) {
    this.config = config;
    this.animationState = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };
    this.smoothedCursorTelemetry = config.customCursorTelemetry ?? buildSmoothedCursorTelemetry(config.inputTelemetry);
  }

  async initialize(): Promise<void> {
    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = this.config.width;
    canvas.height = this.config.height;
    
    // Try to set colorSpace if supported (may not be available on all platforms)
    try {
      if (canvas && 'colorSpace' in canvas) {
        canvas.colorSpace = 'srgb';
      }
    } catch (error) {
      // Silently ignore colorSpace errors on platforms that don't support it
      console.warn('[FrameRenderer] colorSpace not supported on this platform:', error);
    }

    // Initialize PixiJS with optimized settings for export performance
    this.app = new Application();
    await this.app.init({
      canvas,
      width: this.config.width,
      height: this.config.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: 1,
      autoDensity: true,
    });

    // Setup containers
    this.cameraContainer = new Container();
    this.videoContainer = new Container();
    this.app.stage.addChild(this.cameraContainer);
    this.cameraContainer.addChild(this.videoContainer);
    this.trailGraphics = new Graphics();
    this.cameraContainer.addChild(this.trailGraphics);
    this.cursorEraserGraphics = new Graphics();
    this.cursorEraserGraphics.blendMode = 'erase';
    this.videoContainer.addChild(this.cursorEraserGraphics);
    this.cursorGraphics = new Graphics();
    this.cameraContainer.addChild(this.cursorGraphics);

    // Setup background (render separately, not in PixiJS)
    await this.setupBackground();
    await this.setupCamera();

    // Setup blur filter for video container
    this.blurFilter = new BlurFilter();
    this.blurFilter.quality = 5;
    this.blurFilter.resolution = this.app.renderer.resolution;
    this.blurFilter.blur = 0;
    this.videoContainer.filters = [this.blurFilter];

    // Setup composite canvas for final output with shadows
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.config.width;
    this.compositeCanvas.height = this.config.height;
    this.compositeCtx = this.compositeCanvas.getContext('2d', { willReadFrequently: false });
    
    if (!this.compositeCtx) {
      throw new Error('Failed to get 2D context for composite canvas');
    }

    // Setup shadow canvas if needed
    if (this.config.showShadow) {
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = this.config.width;
      this.shadowCanvas.height = this.config.height;
      this.shadowCtx = this.shadowCanvas.getContext('2d', { willReadFrequently: false });
      
      if (!this.shadowCtx) {
        throw new Error('Failed to get 2D context for shadow canvas');
      }
    }

    // Setup mask
    this.maskGraphics = new Graphics();
    this.videoContainer.addChild(this.maskGraphics);
    this.videoContainer.mask = this.maskGraphics;
  }

  private async setupCamera(): Promise<void> {
    if (!this.config.cameraVideoUrl) {
      this.cameraElement = null;
      this.cameraReady = false;
      return;
    }

    const video = document.createElement('video');
    video.src = this.config.cameraVideoUrl;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.load();

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
        reject(new Error('Failed to load camera video'));
      };
      video.addEventListener('loadeddata', onLoaded);
      video.addEventListener('error', onError);
    });

    this.cameraElement = video;
    this.cameraReady = true;
  }

  private async prepareCameraFrame(sourceTimeMs: number): Promise<boolean> {
    if (!this.cameraElement || !this.cameraReady) {
      return false;
    }

    const cameraStartOffsetMs = this.config.cameraStartOffsetMs ?? 0;
    const cameraTimeMs = sourceTimeMs - cameraStartOffsetMs;
    if (cameraTimeMs < 0) {
      return false;
    }

    const hideRegions = this.config.cameraHiddenRegions ?? [];
    const hidden = hideRegions.some(
      (region) => cameraTimeMs >= region.startMs && cameraTimeMs < region.endMs
    );
    if (hidden) {
      return false;
    }

    const cameraTimeSec = cameraTimeMs / 1000;
    if (cameraTimeSec >= this.cameraElement.duration) {
      return false;
    }

    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        this.cameraElement?.removeEventListener('seeked', onSeeked);
        resolve();
      };

      if (Math.abs(this.cameraElement!.currentTime - cameraTimeSec) < 0.04) {
        resolve();
        return;
      }

      this.cameraElement!.addEventListener('seeked', onSeeked, { once: true });
      this.cameraElement!.currentTime = Math.max(0, cameraTimeSec);
    });

    return this.cameraElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && this.cameraElement.videoWidth > 0
      && this.cameraElement.videoHeight > 0;
  }

  private async setupBackground(): Promise<void> {
    const wallpaper = this.config.wallpaper;

    // Create background canvas for separate rendering (not affected by zoom)
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = this.config.width;
    bgCanvas.height = this.config.height;
    const bgCtx = bgCanvas.getContext('2d')!;

    try {
      // Render background based on type
      if (wallpaper.startsWith('file://') || wallpaper.startsWith('data:') || wallpaper.startsWith('/') || wallpaper.startsWith('http')) {
        // Image background
        const img = new Image();
        // Don't set crossOrigin for same-origin images to avoid CORS taint
        // Only set it for cross-origin URLs
        let imageUrl: string;
        if (wallpaper.startsWith('http')) {
          imageUrl = wallpaper;
          if (!imageUrl.startsWith(window.location.origin)) {
            img.crossOrigin = 'anonymous';
          }
        } else if (wallpaper.startsWith('file://') || wallpaper.startsWith('data:')) {
          imageUrl = wallpaper;
        } else {
          imageUrl = window.location.origin + wallpaper;
        }
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = (err) => {
            console.error('[FrameRenderer] Failed to load background image:', imageUrl, err);
            reject(new Error(`Failed to load background image: ${imageUrl}`));
          };
          img.src = imageUrl;
        });
        
        // Draw the image using cover and center positioning
        const imgAspect = img.width / img.height;
        const canvasAspect = this.config.width / this.config.height;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imgAspect > canvasAspect) {
          drawHeight = this.config.height;
          drawWidth = drawHeight * imgAspect;
          drawX = (this.config.width - drawWidth) / 2;
          drawY = 0;
        } else {
          drawWidth = this.config.width;
          drawHeight = drawWidth / imgAspect;
          drawX = 0;
          drawY = (this.config.height - drawHeight) / 2;
        }
        
        bgCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      } else if (wallpaper.startsWith('#')) {
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      } else if (wallpaper.startsWith('linear-gradient') || wallpaper.startsWith('radial-gradient')) {
        
        const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
        if (gradientMatch) {
          const [, type, params] = gradientMatch;
          const parts = params.split(',').map(s => s.trim());
          
          let gradient: CanvasGradient;
          
          if (type === 'linear') {
            gradient = bgCtx.createLinearGradient(0, 0, 0, this.config.height);
            parts.forEach((part, index) => {
              if (part.startsWith('to ') || part.includes('deg')) return;
              
              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          } else {
            const cx = this.config.width / 2;
            const cy = this.config.height / 2;
            const radius = Math.max(this.config.width, this.config.height) / 2;
            gradient = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            
            parts.forEach((part, index) => {
              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          }
          
          bgCtx.fillStyle = gradient;
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        } else {
          console.warn('[FrameRenderer] Could not parse gradient, using black fallback');
          bgCtx.fillStyle = '#000000';
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        }
      } else {
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      }
    } catch (error) {
      console.error('[FrameRenderer] Error setting up background, using fallback:', error);
      bgCtx.fillStyle = '#000000';
      bgCtx.fillRect(0, 0, this.config.width, this.config.height);
    }

    // Store the background canvas for compositing (repurposing the Sprite slot to hold an HTMLCanvasElement)
    this.backgroundSprite = bgCanvas as unknown as Sprite;
  }

  async renderFrame(videoFrame: VideoFrame, timestamp: number): Promise<void> {
    if (!this.app || !this.videoContainer || !this.cameraContainer) {
      throw new Error('Renderer not initialized');
    }

    this.currentVideoTime = timestamp / 1000000;
    this.shouldRenderCamera = await this.prepareCameraFrame(this.currentVideoTime * 1000);

    // Create or update video sprite from VideoFrame
    if (!this.videoSprite) {
      const texture = Texture.from(videoFrame as unknown as HTMLVideoElement);
      this.videoSprite = new Sprite(texture);
      this.videoContainer.addChild(this.videoSprite);
    } else {
      // Destroy old texture to avoid memory leaks, then create new one
      const oldTexture = this.videoSprite.texture;
      const newTexture = Texture.from(videoFrame as unknown as HTMLVideoElement);
      this.videoSprite.texture = newTexture;
      oldTexture.destroy(true);
    }

    // Apply layout
    this.updateLayout();

    const timeMs = this.currentVideoTime * 1000;
    const TICKS_PER_FRAME = 1;
    
    let maxMotionIntensity = 0;
    for (let i = 0; i < TICKS_PER_FRAME; i++) {
      const motionIntensity = this.updateAnimationState(timeMs);
      maxMotionIntensity = Math.max(maxMotionIntensity, motionIntensity);
    }
    
    // Apply transform once with maximum motion intensity from all ticks
    if (!this.layoutCache) return;
    applyZoomTransform({
      cameraContainer: this.cameraContainer,
      blurFilter: this.blurFilter,
      stageSize: this.layoutCache.stageSize,
      baseMask: this.layoutCache.maskRect,
      zoomScale: this.animationState.scale,
      focusX: this.animationState.focusX,
      focusY: this.animationState.focusY,
      motionIntensity: maxMotionIntensity,
      isPlaying: true,
      motionBlurEnabled: this.config.motionBlurEnabled ?? false,
    });
    this.drawCursorTrail();
    this.eraseNativeCursor();
    this.drawCustomCursor();

    // Render the PixiJS stage to its canvas (video only, transparent background)
    this.app.renderer.render(this.app.stage);

    // Composite with shadows to final output canvas
    this.compositeWithShadows();

    // Render annotations on top if present
    if (this.config.annotationRegions && this.config.annotationRegions.length > 0 && this.compositeCtx) {
      // Calculate scale factor based on export vs preview dimensions
      const previewWidth = this.config.previewWidth || 1920;
      const previewHeight = this.config.previewHeight || 1080;
      const scaleX = this.config.width / previewWidth;
      const scaleY = this.config.height / previewHeight;
      const scaleFactor = (scaleX + scaleY) / 2;

      await renderAnnotations(
        this.compositeCtx,
        this.config.annotationRegions,
        this.config.width,
        this.config.height,
        timeMs,
        scaleFactor
      );
    }
  }

  private updateLayout(): void {
    if (!this.app || !this.videoSprite || !this.maskGraphics || !this.videoContainer) return;

    const { width, height } = this.config;
    const { cropRegion, borderRadius = 0, padding = 0 } = this.config;
    const videoWidth = this.config.videoWidth;
    const videoHeight = this.config.videoHeight;

    // Calculate cropped video dimensions
    const cropStartX = cropRegion.x;
    const cropStartY = cropRegion.y;
    const cropEndX = cropRegion.x + cropRegion.width;
    const cropEndY = cropRegion.y + cropRegion.height;

    const croppedVideoWidth = videoWidth * (cropEndX - cropStartX);
    const croppedVideoHeight = videoHeight * (cropEndY - cropStartY);
    
    // Calculate scale to fit in viewport
    // Padding is a percentage (0-100), where 50% ~ 0.8 scale
    const paddingScale = 1.0 - (padding / 100) * 0.4;
    const viewportWidth = width * paddingScale;
    const viewportHeight = height * paddingScale;
    const scale = Math.min(viewportWidth / croppedVideoWidth, viewportHeight / croppedVideoHeight);

    // Position video sprite
    this.videoSprite.width = videoWidth * scale;
    this.videoSprite.height = videoHeight * scale;

    const cropPixelX = cropStartX * videoWidth * scale;
    const cropPixelY = cropStartY * videoHeight * scale;
    this.videoSprite.x = -cropPixelX;
    this.videoSprite.y = -cropPixelY;

    // Position video container
    const croppedDisplayWidth = croppedVideoWidth * scale;
    const croppedDisplayHeight = croppedVideoHeight * scale;
    const centerOffsetX = (width - croppedDisplayWidth) / 2;
    const centerOffsetY = (height - croppedDisplayHeight) / 2;
    this.videoContainer.x = centerOffsetX;
    this.videoContainer.y = centerOffsetY;

    // scale border radius by export/preview canvas ratio
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const canvasScaleFactor = Math.min(width / previewWidth, height / previewHeight);
    const scaledBorderRadius = borderRadius * canvasScaleFactor;
    
    this.maskGraphics.clear();
    this.maskGraphics.roundRect(0, 0, croppedDisplayWidth, croppedDisplayHeight, scaledBorderRadius);
    this.maskGraphics.fill({ color: 0xffffff });

    // Cache layout info
    this.layoutCache = {
      stageSize: { width, height },
      videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
      baseScale: scale,
      baseOffset: { x: centerOffsetX, y: centerOffsetY },
      maskRect: { x: 0, y: 0, width: croppedDisplayWidth, height: croppedDisplayHeight },
    };
  }

  private clampFocusToStage(focus: { cx: number; cy: number }, depth: number): { cx: number; cy: number } {
    if (!this.layoutCache) return focus;
    return clampFocusToStageUtil(focus, depth, this.layoutCache.stageSize);
  }

  private updateAnimationState(timeMs: number): number {
    if (!this.cameraContainer || !this.layoutCache) return 0;

    const { region, strength } = findDominantRegion(this.config.zoomRegions, timeMs);
    
    const defaultFocus = DEFAULT_FOCUS;
    let targetScaleFactor = 1;
    let targetFocus = { ...defaultFocus };

    if (region && strength > 0) {
      const zoomScale = getZoomScale(region.depth);
      const regionFocus = this.clampFocusToStage(region.focus, region.depth);
      
      targetScaleFactor = 1 + (zoomScale - 1) * strength;
      targetFocus = {
        cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
        cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
      };
    }

    const state = this.animationState;

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

    return Math.max(
      Math.abs(nextScale - prevScale),
      Math.abs(nextFocusX - prevFocusX),
      Math.abs(nextFocusY - prevFocusY)
    );
  }

  private compositeWithShadows(): void {
    if (!this.compositeCanvas || !this.compositeCtx || !this.app) return;

    const videoCanvas = this.app.canvas as HTMLCanvasElement;
    const ctx = this.compositeCtx;
    const w = this.compositeCanvas.width;
    const h = this.compositeCanvas.height;

    // Clear composite canvas
    ctx.clearRect(0, 0, w, h);

    // Step 1: Draw background layer (with optional blur, not affected by zoom)
    if (this.backgroundSprite) {
      const bgCanvas = this.backgroundSprite as unknown as HTMLCanvasElement;
      
      if (this.config.showBlur) {
        ctx.save();
        ctx.filter = 'blur(6px)'; // Canvas blur is weaker than CSS
        ctx.drawImage(bgCanvas, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(bgCanvas, 0, 0, w, h);
      }
    } else {
      console.warn('[FrameRenderer] No background sprite found during compositing!');
    }

    // Draw video layer with shadows on top of background
    if (this.config.showShadow && this.config.shadowIntensity > 0 && this.shadowCanvas && this.shadowCtx) {
      const shadowCtx = this.shadowCtx;
      shadowCtx.clearRect(0, 0, w, h);
      shadowCtx.save();
      
      // Calculate shadow parameters based on intensity (0-1)
      const intensity = this.config.shadowIntensity;
      const baseBlur1 = 48 * intensity;
      const baseBlur2 = 16 * intensity;
      const baseBlur3 = 8 * intensity;
      const baseAlpha1 = 0.7 * intensity;
      const baseAlpha2 = 0.5 * intensity;
      const baseAlpha3 = 0.3 * intensity;
      const baseOffset = 12 * intensity;
      
      shadowCtx.filter = `drop-shadow(0 ${baseOffset}px ${baseBlur1}px rgba(0,0,0,${baseAlpha1})) drop-shadow(0 ${baseOffset/3}px ${baseBlur2}px rgba(0,0,0,${baseAlpha2})) drop-shadow(0 ${baseOffset/6}px ${baseBlur3}px rgba(0,0,0,${baseAlpha3}))`;
      shadowCtx.drawImage(videoCanvas, 0, 0, w, h);
      shadowCtx.restore();
      ctx.drawImage(this.shadowCanvas, 0, 0, w, h);
    } else {
      ctx.drawImage(videoCanvas, 0, 0, w, h);
    }

    if (this.shouldRenderCamera && this.cameraElement) {
      const bubbleWidth = Math.round(w * 0.18);
      const bubbleHeight = Math.round(bubbleWidth * 9 / 16);
      const margin = Math.round(w * 0.03);
      const x = w - bubbleWidth - margin;
      const y = margin;
      const radius = Math.max(8, Math.round(Math.min(bubbleWidth, bubbleHeight) * 0.08));

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + bubbleWidth - radius, y);
      ctx.quadraticCurveTo(x + bubbleWidth, y, x + bubbleWidth, y + radius);
      ctx.lineTo(x + bubbleWidth, y + bubbleHeight - radius);
      ctx.quadraticCurveTo(x + bubbleWidth, y + bubbleHeight, x + bubbleWidth - radius, y + bubbleHeight);
      ctx.lineTo(x + radius, y + bubbleHeight);
      ctx.quadraticCurveTo(x, y + bubbleHeight, x, y + bubbleHeight - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(this.cameraElement, x, y, bubbleWidth, bubbleHeight);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(1, Math.round(w * 0.0012));
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + bubbleWidth - radius, y);
      ctx.quadraticCurveTo(x + bubbleWidth, y, x + bubbleWidth, y + radius);
      ctx.lineTo(x + bubbleWidth, y + bubbleHeight - radius);
      ctx.quadraticCurveTo(x + bubbleWidth, y + bubbleHeight, x + bubbleWidth - radius, y + bubbleHeight);
      ctx.lineTo(x + radius, y + bubbleHeight);
      ctx.quadraticCurveTo(x, y + bubbleHeight, x, y + bubbleHeight - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawCursorTrail(): void {
    this.trailGraphics?.clear();
    if (!this.trailGraphics || !this.config.cursorTrailEnabled || !this.config.inputTelemetry || !this.layoutCache) {
      return;
    }

    const telemetry = this.config.inputTelemetry;
    const absoluteTimeMs = telemetry.startedAtMs + this.currentVideoTime * 1000;
    const points = getCursorTrailPoints(telemetry, absoluteTimeMs, 1100, 14);
    if (points.length === 0) return;

    const crop = this.config.cropRegion;
    const cropStartX = crop.x * this.config.videoWidth;
    const cropEndX = cropStartX + crop.width * this.config.videoWidth;
    const cropStartY = crop.y * this.config.videoHeight;
    const cropEndY = cropStartY + crop.height * this.config.videoHeight;

    for (const point of points) {
      const sourceX = point.xNorm * this.config.videoWidth;
      const sourceY = point.yNorm * this.config.videoHeight;
      if (sourceX < cropStartX || sourceX > cropEndX || sourceY < cropStartY || sourceY > cropEndY) {
        continue;
      }

      const stageX = this.layoutCache.baseOffset.x + (sourceX - cropStartX) * this.layoutCache.baseScale;
      const stageY = this.layoutCache.baseOffset.y + (sourceY - cropStartY) * this.layoutCache.baseScale;
      const alpha = point.ageRatio * point.ageRatio * 0.4 * point.emphasis;
      const radius = Math.max(2, 4.5 * point.ageRatio * point.emphasis);
      this.trailGraphics.circle(stageX, stageY, radius).fill({ color: 0x34b27b, alpha });
    }
  }

  private drawCustomCursor(): void {
    this.cursorGraphics?.clear();
    if (!this.cursorGraphics || !this.config.customCursorEnabled || !this.config.inputTelemetry || !this.layoutCache) {
      return;
    }

    const telemetry = this.smoothedCursorTelemetry;
    if (!telemetry) return;

    const absoluteTimeMs = this.config.inputTelemetry.startedAtMs + this.currentVideoTime * 1000;
    const sample = getCursorSampleAtTime(telemetry, absoluteTimeMs);
    if (!sample) return;

    const crop = this.config.cropRegion;
    const sourceX = sample.xNorm * this.config.videoWidth;
    const sourceY = sample.yNorm * this.config.videoHeight;
    const cropStartX = crop.x * this.config.videoWidth;
    const cropEndX = cropStartX + crop.width * this.config.videoWidth;
    const cropStartY = crop.y * this.config.videoHeight;
    const cropEndY = cropStartY + crop.height * this.config.videoHeight;
    if (sourceX < cropStartX || sourceX > cropEndX || sourceY < cropStartY || sourceY > cropEndY) {
      return;
    }

    const stageX = this.layoutCache.baseOffset.x + (sourceX - cropStartX) * this.layoutCache.baseScale;
    const stageY = this.layoutCache.baseOffset.y + (sourceY - cropStartY) * this.layoutCache.baseScale;
    const prevSample = getCursorSampleAtTime(telemetry, absoluteTimeMs - 16);
    const prevStageX = prevSample
      ? this.layoutCache.baseOffset.x + (prevSample.xNorm * this.config.videoWidth - cropStartX) * this.layoutCache.baseScale
      : stageX;
    const prevStageY = prevSample
      ? this.layoutCache.baseOffset.y + (prevSample.yNorm * this.config.videoHeight - cropStartY) * this.layoutCache.baseScale
      : stageY;
    const velocityX = stageX - prevStageX;
    const velocityY = stageY - prevStageY;
    // Normalize cursor size to match editor preview: cap baseScale at 1 (same as layoutUtils.ts),
    // then scale up to export canvas via canvasScaleFactor.
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const croppedVideoWidth = this.config.videoWidth * this.config.cropRegion.width;
    const croppedVideoHeight = this.config.videoHeight * this.config.cropRegion.height;
    const editorBaseScale = Math.min(previewWidth / croppedVideoWidth, previewHeight / croppedVideoHeight, 1);
    const canvasScaleFactor = Math.min(this.config.width / previewWidth, this.config.height / previewHeight);
    const normalizedCursorScale = editorBaseScale * canvasScaleFactor;
    drawCustomCursor(
      this.cursorGraphics,
      stageX,
      stageY,
      normalizedCursorScale * (this.config.customCursorSize ?? 1.2) * 22,
      sample.cursorType,
      getCursorClickPulse(telemetry.clicks, absoluteTimeMs),
      velocityX,
      velocityY
    );
  }

  private eraseNativeCursor(): void {
    this.cursorEraserGraphics?.clear();
    if (!this.cursorEraserGraphics || !this.config.customCursorEnabled || !this.config.inputTelemetry || !this.layoutCache) {
      return;
    }

    const telemetry = this.smoothedCursorTelemetry;
    if (!telemetry) return;

    const absoluteTimeMs = this.config.inputTelemetry.startedAtMs + this.currentVideoTime * 1000;
    const sample = getCursorSampleAtTime(telemetry, absoluteTimeMs);
    if (!sample) return;

    const crop = this.config.cropRegion;
    const sourceX = sample.xNorm * this.config.videoWidth;
    const sourceY = sample.yNorm * this.config.videoHeight;
    const cropStartX = crop.x * this.config.videoWidth;
    const cropEndX = cropStartX + crop.width * this.config.videoWidth;
    const cropStartY = crop.y * this.config.videoHeight;
    const cropEndY = cropStartY + crop.height * this.config.videoHeight;
    if (sourceX < cropStartX || sourceX > cropEndX || sourceY < cropStartY || sourceY > cropEndY) {
      return;
    }

    const localX = (sourceX - cropStartX) * this.layoutCache.baseScale;
    const localY = (sourceY - cropStartY) * this.layoutCache.baseScale;
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const croppedVideoWidth = this.config.videoWidth * this.config.cropRegion.width;
    const croppedVideoHeight = this.config.videoHeight * this.config.cropRegion.height;
    const editorBaseScale = Math.min(previewWidth / croppedVideoWidth, previewHeight / croppedVideoHeight, 1);
    const canvasScaleFactor = Math.min(this.config.width / previewWidth, this.config.height / previewHeight);
    const normalizedCursorScale = editorBaseScale * canvasScaleFactor;
    const radius = Math.max(9, normalizedCursorScale * (this.config.customCursorSize ?? 1.2) * 14);
    this.cursorEraserGraphics.circle(localX, localY, radius).fill({ color: 0xffffff, alpha: 1 });
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.compositeCanvas) {
      throw new Error('Renderer not initialized');
    }
    return this.compositeCanvas;
  }


  destroy(): void {
    if (this.videoSprite) {
      this.videoSprite.destroy();
      this.videoSprite = null;
    }
    this.backgroundSprite = null;
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true, textureSource: true });
      this.app = null;
    }
    this.cameraContainer = null;
    this.videoContainer = null;
    this.maskGraphics = null;
    this.blurFilter = null;
    this.shadowCanvas = null;
    this.shadowCtx = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.cameraElement = null;
    this.cameraReady = false;
    this.shouldRenderCamera = false;
    this.trailGraphics = null;
    this.cursorGraphics = null;
    this.cursorEraserGraphics = null;
    this.smoothedCursorTelemetry = null;
  }
}
