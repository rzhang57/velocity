import { getZoomScale, clampFocusToDepth, type ZoomFocus, type ZoomDepth } from "../types";

interface StageSize {
  width: number;
  height: number;
}

const ZOOM_WINDOW_ASPECT = 16 / 9;

export function clampFocusToStage(
  focus: ZoomFocus,
  depth: ZoomDepth,
  stageSize: StageSize
): ZoomFocus {
  if (!stageSize.width || !stageSize.height) {
    return clampFocusToDepth(focus, depth);
  }

  const zoomScale = getZoomScale(depth);
  let windowWidth = stageSize.width / zoomScale;
  let windowHeight = windowWidth / ZOOM_WINDOW_ASPECT;
  const maxHeight = stageSize.height / zoomScale;
  if (windowHeight > maxHeight) {
    windowHeight = maxHeight;
    windowWidth = windowHeight * ZOOM_WINDOW_ASPECT;
  }
  
  const marginX = windowWidth / (2 * stageSize.width);
  const marginY = windowHeight / (2 * stageSize.height);

  const baseFocus = clampFocusToDepth(focus, depth);

  return {
    cx: Math.max(marginX, Math.min(1 - marginX, baseFocus.cx)),
    cy: Math.max(marginY, Math.min(1 - marginY, baseFocus.cy)),
  };
}

export function stageFocusToVideoSpace(
  focus: ZoomFocus,
  stageSize: StageSize,
  videoSize: { width: number; height: number },
  baseScale: number,
  baseOffset: { x: number; y: number }
): ZoomFocus {
  if (!stageSize.width || !stageSize.height || !videoSize.width || !videoSize.height || baseScale <= 0) {
    return focus;
  }

  const stageX = focus.cx * stageSize.width;
  const stageY = focus.cy * stageSize.height;

  const videoNormX = (stageX - baseOffset.x) / (videoSize.width * baseScale);
  const videoNormY = (stageY - baseOffset.y) / (videoSize.height * baseScale);

  return {
    cx: videoNormX,
    cy: videoNormY,
  };
}
