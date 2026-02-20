export type ZoomDepth = number;

export interface ZoomFocus {
  cx: number; // normalized horizontal center (0-1)
  cy: number; // normalized vertical center (0-1)
}

export interface ZoomRegion {
  id: string;
  startMs: number;
  endMs: number;
  depth: ZoomDepth;
  focus: ZoomFocus;
}

export interface TrimRegion {
  id: string;
  startMs: number;
  endMs: number;
}

export interface CameraHiddenRegion {
  id: string;
  startMs: number;
  endMs: number;
}

export type AnnotationType = 'text' | 'image' | 'figure';

export type ArrowDirection = 'up' | 'down' | 'left' | 'right' | 'up-right' | 'up-left' | 'down-right' | 'down-left';

export interface FigureData {
  arrowDirection: ArrowDirection;
  color: string;
  strokeWidth: number;
}

export interface AnnotationPosition {
  x: number;
  y: number;
}

export interface AnnotationSize {
  width: number;
  height: number;
}

export interface AnnotationTextStyle {
  color: string;
  backgroundColor: string;
  fontSize: number; // pixels
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline';
  textAlign: 'left' | 'center' | 'right';
}

export interface AnnotationRegion {
  id: string;
  startMs: number;
  endMs: number;
  type: AnnotationType;
  content: string; // Legacy - still used for current type
  textContent?: string; // Separate storage for text
  imageContent?: string; // Separate storage for image data URL
  position: AnnotationPosition;
  size: AnnotationSize;
  style: AnnotationTextStyle;
  zIndex: number;
  figureData?: FigureData;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
  x: 50,
  y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
  width: 30,
  height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
  color: '#ffffff',
  backgroundColor: 'transparent',
  fontSize: 32,
  fontFamily: 'Inter',
  fontWeight: 'bold',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'center',
};

export const DEFAULT_FIGURE_DATA: FigureData = {
  arrowDirection: 'right',
  color: '#34B27B',
  strokeWidth: 4,
};



export interface CropRegion {
  x: number; 
  y: number; 
  width: number; 
  height: number; 
}

export const DEFAULT_CROP_REGION: CropRegion = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export const ZOOM_DEPTH_MIN = 1;
export const ZOOM_DEPTH_MAX = 6;
export const ZOOM_DEPTH_STEP = 0.1;

export const ZOOM_DEPTH_KEYFRAMES: Array<{ depth: number; scale: number }> = [
  { depth: 1, scale: 1.25 },
  { depth: 2, scale: 1.5 },
  { depth: 3, scale: 1.8 },
  { depth: 4, scale: 2.2 },
  { depth: 5, scale: 3.5 },
  { depth: 6, scale: 5.0 },
];

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;

export function clampZoomDepth(depth: number): ZoomDepth {
  const clamped = clamp(depth, ZOOM_DEPTH_MIN, ZOOM_DEPTH_MAX);
  return Math.round(clamped / ZOOM_DEPTH_STEP) * ZOOM_DEPTH_STEP;
}

export function getZoomScale(depth: ZoomDepth): number {
  const clampedDepth = clampZoomDepth(depth);
  const keyframes = ZOOM_DEPTH_KEYFRAMES;

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (clampedDepth >= a.depth && clampedDepth <= b.depth) {
      const t = (clampedDepth - a.depth) / (b.depth - a.depth);
      return a.scale + (b.scale - a.scale) * t;
    }
  }

  return keyframes[keyframes.length - 1].scale;
}

export function getZoomDepthFromScale(scale: number): ZoomDepth {
  const keyframes = ZOOM_DEPTH_KEYFRAMES;
  const minScale = keyframes[0].scale;
  const maxScale = keyframes[keyframes.length - 1].scale;
  const clampedScale = clamp(scale, minScale, maxScale);

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (clampedScale >= a.scale && clampedScale <= b.scale) {
      const t = (clampedScale - a.scale) / (b.scale - a.scale);
      return clampZoomDepth(a.depth + (b.depth - a.depth) * t);
    }
  }

  return clampZoomDepth(keyframes[keyframes.length - 1].depth);
}

export function clampFocusToDepth(focus: ZoomFocus, depth: ZoomDepth): ZoomFocus {
  void depth;
  return {
    cx: clamp(focus.cx, 0, 1),
    cy: clamp(focus.cy, 0, 1),
  };
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}
