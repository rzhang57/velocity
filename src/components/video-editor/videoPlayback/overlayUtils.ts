import { getZoomScale, type ZoomRegion, type ZoomFocus } from "../types";
import { clampFocusToStage } from "./focusUtils";

interface OverlayUpdateParams {
  overlayEl: HTMLDivElement;
  indicatorEl: HTMLDivElement;
  region: ZoomRegion | null;
  focusOverride?: ZoomFocus;
  videoSize: { width: number; height: number };
  baseScale: number;
  isPlaying: boolean;
}

const ZOOM_WINDOW_ASPECT = 16 / 9;

export function updateOverlayIndicator(params: OverlayUpdateParams) {
  const { overlayEl, indicatorEl, region, focusOverride, videoSize, baseScale, isPlaying } = params;

  if (!region) {
    indicatorEl.style.display = 'none';
    overlayEl.style.pointerEvents = 'none';
    return;
  }

  const stageWidth = overlayEl.clientWidth;
  const stageHeight = overlayEl.clientHeight;
  
  if (!stageWidth || !stageHeight) {
    indicatorEl.style.display = 'none';
    overlayEl.style.pointerEvents = 'none';
    return;
  }

  if (!videoSize.width || !videoSize.height || baseScale <= 0) {
    indicatorEl.style.display = 'none';
    overlayEl.style.pointerEvents = isPlaying ? 'none' : 'auto';
    return;
  }

  const zoomScale = getZoomScale(region.depth);
  const focus = clampFocusToStage(
    focusOverride ?? region.focus,
    region.depth,
    { width: stageWidth, height: stageHeight }
  );

  // Zoom window shows visible area after zooming and is always 16:9.
  let indicatorWidth = stageWidth / zoomScale;
  let indicatorHeight = indicatorWidth / ZOOM_WINDOW_ASPECT;
  const maxHeight = stageHeight / zoomScale;
  if (indicatorHeight > maxHeight) {
    indicatorHeight = maxHeight;
    indicatorWidth = indicatorHeight * ZOOM_WINDOW_ASPECT;
  }

  const rawLeft = focus.cx * stageWidth - indicatorWidth / 2;
  const rawTop = focus.cy * stageHeight - indicatorHeight / 2;

  const adjustedLeft = indicatorWidth >= stageWidth
    ? (stageWidth - indicatorWidth) / 2
    : Math.max(0, Math.min(stageWidth - indicatorWidth, rawLeft));

  const adjustedTop = indicatorHeight >= stageHeight
    ? (stageHeight - indicatorHeight) / 2
    : Math.max(0, Math.min(stageHeight - indicatorHeight, rawTop));

  indicatorEl.style.display = 'block';
  indicatorEl.style.width = `${indicatorWidth}px`;
  indicatorEl.style.height = `${indicatorHeight}px`;
  indicatorEl.style.left = `${adjustedLeft}px`;
  indicatorEl.style.top = `${adjustedTop}px`;
  overlayEl.style.pointerEvents = isPlaying ? 'none' : 'auto';
}
