export interface ExportConfig {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  codec?: string;
}

export interface ExportProgress {
  currentFrame: number;
  totalFrames: number;
  percentage: number;
  estimatedTimeRemaining: number; // in seconds
  phase?: 'initializing' | 'extracting' | 'finalizing'; // Phase of export
  renderProgress?: number; // 0-100, progress of GIF rendering phase
}

export interface ExportResult {
  success: boolean;
  blob?: Blob;
  error?: string;
}

export interface VideoFrameData {
  frame: VideoFrame;
  timestamp: number; // in microseconds
  duration: number; // in microseconds
}

export type ExportQuality = 'medium' | 'good' | 'source';

// GIF Export Types
export type ExportFormat = 'mp4' | 'gif';
export type Mp4FrameRate = 30 | 60 | 120;
export type Mp4ResolutionPreset = 720 | 1080 | 1440 | 2160;

export type GifFrameRate = 10 | 15 | 20 | 25 | 30;

export type GifSizePreset = 'small' | 'medium' | 'large' | 'original';

export interface GifExportConfig {
  frameRate: GifFrameRate;
  loop: boolean;
  sizePreset: GifSizePreset;
  width: number;
  height: number;
}

export interface ExportSettings {
  format: ExportFormat;
  // Legacy MP4 quality setting (kept for backward compatibility).
  quality?: ExportQuality;
  // MP4 settings
  mp4Config?: {
    frameRate: Mp4FrameRate;
    resolution: Mp4ResolutionPreset;
  };
  // GIF settings
  gifConfig?: GifExportConfig;
}

export const GIF_SIZE_PRESETS: Record<GifSizePreset, { maxHeight: number; label: string }> = {
  small: { maxHeight: 480, label: 'Small (480p)' },
  medium: { maxHeight: 720, label: 'Medium (720p)' },
  large: { maxHeight: 1080, label: 'Large (1080p)' },
  original: { maxHeight: Infinity, label: 'Original' },
};

export const GIF_FRAME_RATES: { value: GifFrameRate; label: string }[] = [
  { value: 10, label: '10 FPS - Smaller file' },
  { value: 15, label: '15 FPS - Balanced' },
  { value: 20, label: '20 FPS - Smooth' },
  { value: 25, label: '25 FPS - Very smooth' },
  { value: 30, label: '30 FPS - Maximum' },
];

// Valid frame rates for validation
export const VALID_GIF_FRAME_RATES: readonly GifFrameRate[] = [10, 15, 20, 25, 30] as const;
export const MP4_FRAME_RATES: { value: Mp4FrameRate; label: string }[] = [
  { value: 30, label: '30 FPS' },
  { value: 60, label: '60 FPS' },
  { value: 120, label: '120 FPS' },
];
export const MP4_RESOLUTION_PRESETS: { value: Mp4ResolutionPreset; label: string }[] = [
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 1440, label: '1440p' },
  { value: 2160, label: '2160p' },
];

export function isValidGifFrameRate(rate: number): rate is GifFrameRate {
  return VALID_GIF_FRAME_RATES.includes(rate as GifFrameRate);
}
