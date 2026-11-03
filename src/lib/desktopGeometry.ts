export const WIDGET_WIDTH = 360;
export const WIDGET_HEIGHT = 450;
export const WIDGET_MARGIN = 24;

type Point = { x: number; y: number };
type Size = { width: number; height: number };
export type WorkArea = { position: Point; size: Size };

/** Monitor work areas, window sizes and positions are all physical pixels. */
export function widgetPhysicalSize(scaleFactor: number, available?: Size): Size {
  return {
    width: Math.max(1, Math.min(Math.round(WIDGET_WIDTH * scaleFactor), available?.width ?? Infinity)),
    height: Math.max(1, Math.min(Math.round(WIDGET_HEIGHT * scaleFactor), available?.height ?? Infinity)),
  };
}

export function widgetPosition(
  workArea: WorkArea,
  windowSize: Size,
  scaleFactor: number,
  currentPosition?: Point,
): Point {
  const left = workArea.position.x;
  const top = workArea.position.y;
  const right = left + Math.max(0, workArea.size.width - windowSize.width);
  const bottom = top + Math.max(0, workArea.size.height - windowSize.height);
  const margin = Math.round(WIDGET_MARGIN * scaleFactor);
  return {
    x: Math.round(Math.min(right, Math.max(left, currentPosition?.x ?? right - margin))),
    y: Math.round(Math.min(bottom, Math.max(top, currentPosition?.y ?? top + margin))),
  };
}
