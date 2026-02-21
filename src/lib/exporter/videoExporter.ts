import type { ExportConfig, ExportProgress, ExportResult } from './types';
import { StreamingVideoDecoder } from './streamingDecoder';
import { FrameRenderer } from './frameRenderer';
import { VideoMuxer } from './muxer';
import type { ZoomRegion, CropRegion, TrimRegion, AnnotationRegion, CameraHiddenRegion } from '@/components/video-editor/types';
import type { InputTelemetryFileV1 } from '@/types/inputTelemetry';
import type { CustomCursorTelemetry } from '@/lib/cursor/customCursor';
import type { AudioCodec } from 'mediabunny';

interface VideoExporterConfig extends ExportConfig {
  videoUrl: string;
  cameraVideoUrl?: string;
  cameraStartOffsetMs?: number;
  cameraHiddenRegions?: CameraHiddenRegion[];
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  trimRegions?: TrimRegion[];
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
  videoPadding?: number;
  cropRegion: CropRegion;
  annotationRegions?: AnnotationRegion[];
  previewWidth?: number;
  previewHeight?: number;
  onProgress?: (progress: ExportProgress) => void;
}

export class VideoExporter {
  private config: VideoExporterConfig;
  private streamingDecoder: StreamingVideoDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: VideoMuxer | null = null;
  private cancelled = false;
  private encodeQueue = 0;
  // Increased queue size for better throughput with hardware encoding
  private readonly MAX_ENCODE_QUEUE = 120;
  private videoDescription: Uint8Array | undefined;
  private videoColorSpace: VideoColorSpaceInit | undefined;
  // Track muxing promises for parallel processing
  private muxingPromises: Promise<void>[] = [];
  private chunkCount = 0;
  private hasSourceAudio = false;

  constructor(config: VideoExporterConfig) {
    this.config = config;
  }

  async export(): Promise<ExportResult> {
    try {
      this.cleanup();
      this.cancelled = false;
      const exportStartedAtMs = Date.now();
      const estimateRemainingSeconds = (processedFrames: number, totalFrames: number): number => {
        if (processedFrames <= 0 || totalFrames <= 0) return 0;
        const elapsedSeconds = (Date.now() - exportStartedAtMs) / 1000;
        if (elapsedSeconds <= 0) return 0;
        const framesPerSecond = processedFrames / elapsedSeconds;
        if (framesPerSecond <= 0) return 0;
        return Math.max(0, Math.round((totalFrames - processedFrames) / framesPerSecond));
      };

      this.config.onProgress?.({
        currentFrame: 0,
        totalFrames: 1,
        percentage: 0,
        estimatedTimeRemaining: 0,
        phase: 'initializing',
      });

      // Initialize streaming decoder and load video metadata
      this.config.onProgress?.({
        currentFrame: 0,
        totalFrames: 1,
        percentage: 5,
        estimatedTimeRemaining: 0,
        phase: 'initializing',
      });
      this.streamingDecoder = new StreamingVideoDecoder();
      const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);
      const sourceAudioCodec = this.resolveSourceAudioCodec(videoInfo.audioCodec);
      this.hasSourceAudio = Boolean(videoInfo.hasAudio && sourceAudioCodec);
      this.config.onProgress?.({
        currentFrame: 0,
        totalFrames: 1,
        percentage: 12,
        estimatedTimeRemaining: 0,
        phase: 'initializing',
      });

      // Initialize frame renderer
      this.renderer = new FrameRenderer({
        width: this.config.width,
        height: this.config.height,
        cameraVideoUrl: this.config.cameraVideoUrl,
        cameraStartOffsetMs: this.config.cameraStartOffsetMs,
        cameraHiddenRegions: this.config.cameraHiddenRegions,
        wallpaper: this.config.wallpaper,
        zoomRegions: this.config.zoomRegions,
        showShadow: this.config.showShadow,
        shadowIntensity: this.config.shadowIntensity,
        showBlur: this.config.showBlur,
        motionBlurEnabled: this.config.motionBlurEnabled,
        cursorTrailEnabled: this.config.cursorTrailEnabled,
        customCursorEnabled: this.config.customCursorEnabled,
        customCursorSize: this.config.customCursorSize,
        inputTelemetry: this.config.inputTelemetry,
        customCursorTelemetry: this.config.customCursorTelemetry,
        borderRadius: this.config.borderRadius,
        padding: this.config.padding,
        cropRegion: this.config.cropRegion,
        videoWidth: videoInfo.width,
        videoHeight: videoInfo.height,
        annotationRegions: this.config.annotationRegions,
        previewWidth: this.config.previewWidth,
        previewHeight: this.config.previewHeight,
      });
      this.muxer = new VideoMuxer(this.config, this.hasSourceAudio, sourceAudioCodec ?? 'opus');
      this.config.onProgress?.({
        currentFrame: 0,
        totalFrames: 1,
        percentage: 18,
        estimatedTimeRemaining: 0,
        phase: 'initializing',
      });
      await Promise.all([
        this.renderer.initialize(),
        this.initializeEncoder(),
        this.muxer.initialize(),
      ]);
      this.config.onProgress?.({
        currentFrame: 0,
        totalFrames: 1,
        percentage: 22,
        estimatedTimeRemaining: 0,
        phase: 'initializing',
      });

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.streamingDecoder.getEffectiveDuration(this.config.trimRegions);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
      const safeTotalFrames = Math.max(1, totalFrames);

      console.log('[VideoExporter] Original duration:', videoInfo.duration, 's');
      console.log('[VideoExporter] Effective duration:', effectiveDuration, 's');
      console.log('[VideoExporter] Total frames to export:', totalFrames);
      console.log('[VideoExporter] Using streaming decode (web-demuxer + VideoDecoder)');

      const frameDuration = 1_000_000 / this.config.frameRate; // in microseconds
      let frameIndex = 0;
      const EXTRACT_PROGRESS_START = 22;
      const EXTRACT_PROGRESS_END = 98;
      this.config.onProgress?.({
        currentFrame: 0,
        totalFrames: safeTotalFrames,
        percentage: EXTRACT_PROGRESS_START,
        estimatedTimeRemaining: 0,
        phase: 'extracting',
      });

      // Stream decode and process frames — no seeking!
      await this.streamingDecoder.decodeAll(
        this.config.frameRate,
        this.config.trimRegions,
        async (videoFrame, _exportTimestampUs, sourceTimestampMs) => {
          if (this.cancelled) {
            videoFrame.close();
            return;
          }

          const timestamp = frameIndex * frameDuration;

          // Render the frame with all effects using source timestamp
          const sourceTimestampUs = sourceTimestampMs * 1000; // Convert to microseconds
          await this.renderer!.renderFrame(videoFrame, sourceTimestampUs);
          videoFrame.close();

          const canvas = this.renderer!.getCanvas();

          // Create VideoFrame from canvas on GPU without reading pixels
          // @ts-ignore - colorSpace not in TypeScript definitions but works at runtime
          const exportFrame = new VideoFrame(canvas, {
            timestamp,
            duration: frameDuration,
            colorSpace: {
              primaries: 'bt709',
              transfer: 'iec61966-2-1',
              matrix: 'rgb',
              fullRange: true,
            },
          });

          // Check encoder queue before encoding to keep it full
          while (this.encodeQueue >= this.MAX_ENCODE_QUEUE && !this.cancelled) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }

          if (this.encoder && this.encoder.state === 'configured') {
            this.encodeQueue++;
            this.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
          } else {
            console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`);
          }

          exportFrame.close();

          frameIndex++;

          // Update progress
          if (this.config.onProgress) {
            this.config.onProgress({
              currentFrame: frameIndex,
              totalFrames: safeTotalFrames,
              percentage: EXTRACT_PROGRESS_START + ((frameIndex / safeTotalFrames) * (EXTRACT_PROGRESS_END - EXTRACT_PROGRESS_START)),
              estimatedTimeRemaining: estimateRemainingSeconds(frameIndex, safeTotalFrames),
              phase: 'extracting',
            });
          }
        }
      );

      if (this.hasSourceAudio) {
        await this.streamingDecoder.copyAudio(
          this.config.trimRegions,
          async (audioChunk) => {
            await this.muxer!.addAudioChunk(audioChunk);
          }
        );
      }

      if (this.cancelled) {
        return { success: false, error: 'Export cancelled' };
      }

      // Finalize encoding
      this.config.onProgress?.({
        currentFrame: safeTotalFrames,
        totalFrames: safeTotalFrames,
        percentage: 99,
        estimatedTimeRemaining: 0,
        phase: 'finalizing',
      });
      if (this.encoder && this.encoder.state === 'configured') {
        await this.encoder.flush();
      }

      // Wait for all muxing operations to complete
      await Promise.all(this.muxingPromises);

      // Finalize muxer and get output blob
      const blob = await this.muxer!.finalize();
      this.config.onProgress?.({
        currentFrame: safeTotalFrames,
        totalFrames: safeTotalFrames,
        percentage: 100,
        estimatedTimeRemaining: 0,
        phase: 'finalizing',
      });

      return { success: true, blob };
    } catch (error) {
      console.error('Export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.cleanup();
    }
  }

  private async initializeEncoder(): Promise<void> {
    this.encodeQueue = 0;
    this.muxingPromises = [];
    this.chunkCount = 0;
    let videoDescription: Uint8Array | undefined;

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // Capture decoder config metadata from encoder output
        if (meta?.decoderConfig?.description && !videoDescription) {
          const desc = meta.decoderConfig.description;
          videoDescription = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as any));
          this.videoDescription = videoDescription;
        }
        // Capture colorSpace from encoder metadata if provided
        if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
          this.videoColorSpace = meta.decoderConfig.colorSpace;
        }

        // Stream chunk to muxer immediately (parallel processing)
        const isFirstChunk = this.chunkCount === 0;
        this.chunkCount++;

        const muxingPromise = (async () => {
          try {
            if (isFirstChunk && this.videoDescription) {
              // Add decoder config for the first chunk
              const colorSpace = this.videoColorSpace || {
                primaries: 'bt709',
                transfer: 'iec61966-2-1',
                matrix: 'rgb',
                fullRange: true,
              };

              const metadata: EncodedVideoChunkMetadata = {
                decoderConfig: {
                  codec: this.config.codec || 'avc1.640033',
                  codedWidth: this.config.width,
                  codedHeight: this.config.height,
                  description: this.videoDescription,
                  colorSpace,
                },
              };

              await this.muxer!.addVideoChunk(chunk, metadata);
            } else {
              await this.muxer!.addVideoChunk(chunk, meta);
            }
          } catch (error) {
            console.error('Muxing error:', error);
          }
        })();

        this.muxingPromises.push(muxingPromise);
        this.encodeQueue--;
      },
      error: (error) => {
        console.error('[VideoExporter] Encoder error:', error);
        // Stop export encoding failed
        this.cancelled = true;
      },
    });

    const codec = this.config.codec || 'avc1.640033';

    const encoderConfig: VideoEncoderConfig = {
      codec,
      width: this.config.width,
      height: this.config.height,
      bitrate: this.config.bitrate,
      framerate: this.config.frameRate,
      latencyMode: 'realtime',
      bitrateMode: 'variable',
      hardwareAcceleration: 'prefer-hardware',
    };

    // Check hardware support first
    const hardwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);

    if (hardwareSupport.supported) {
      // Use hardware encoding
      console.log('[VideoExporter] Using hardware acceleration');
      this.encoder.configure(encoderConfig);
    } else {
      // Fall back to software encoding
      console.log('[VideoExporter] Hardware not supported, using software encoding');
      encoderConfig.hardwareAcceleration = 'prefer-software';

      const softwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!softwareSupport.supported) {
        throw new Error('Video encoding not supported on this system');
      }

      this.encoder.configure(encoderConfig);
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.streamingDecoder) {
      this.streamingDecoder.cancel();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.encoder) {
      try {
        if (this.encoder.state === 'configured') {
          this.encoder.close();
        }
      } catch (e) {
        console.warn('Error closing encoder:', e);
      }
      this.encoder = null;
    }

    if (this.streamingDecoder) {
      try {
        this.streamingDecoder.destroy();
      } catch (e) {
        console.warn('Error destroying streaming decoder:', e);
      }
      this.streamingDecoder = null;
    }

    if (this.renderer) {
      try {
        this.renderer.destroy();
      } catch (e) {
        console.warn('Error destroying renderer:', e);
      }
      this.renderer = null;
    }

    this.muxer = null;
    this.encodeQueue = 0;
    this.muxingPromises = [];
    this.chunkCount = 0;
    this.videoDescription = undefined;
    this.videoColorSpace = undefined;
    this.hasSourceAudio = false;
  }

  private resolveSourceAudioCodec(codecName?: string): AudioCodec | null {
    if (!codecName) {
      return null;
    }
    const normalized = codecName.toLowerCase();
    if (normalized.includes('opus')) return 'opus';
    if (normalized.includes('aac') || normalized.includes('mp4a')) return 'aac';
    if (normalized.includes('mp3')) return 'mp3';
    if (normalized.includes('vorbis')) return 'vorbis';
    if (normalized.includes('flac')) return 'flac';
    return null;
  }
}
