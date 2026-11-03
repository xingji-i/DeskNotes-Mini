import { widgetPhysicalSize, type WorkArea } from "./desktopGeometry.ts";

export const DESKTOP_POSITION_KEY = "desknote_position_v1";
export type DesktopPosition = { x: number; y: number };
type Display = {
  position: DesktopPosition;
  size: { width: number; height: number };
  workArea: WorkArea;
  scaleFactor: number;
};

/** Persist physical coordinates, including negative origins on secondary displays. */
export function parseDesktopPosition(value: string | null): DesktopPosition | undefined {
  try {
    const position: unknown = JSON.parse(value ?? "null");
    if (!position || typeof position !== "object" || Array.isArray(position)) return;
    const { x, y } = position as DesktopPosition;
    if (Number.isSafeInteger(x) && Number.isSafeInteger(y)) return { x, y };
  } catch {
    // A damaged setting should never prevent the note from opening.
  }
}

/** Restore only onto a connected display; otherwise use the normal initial placement. */
export function monitorForPosition<T extends Display>(position: DesktopPosition, monitors: T[]): T | undefined {
  const containing = monitors.find((monitor) =>
    position.x >= monitor.position.x && position.x < monitor.position.x + monitor.size.width &&
    position.y >= monitor.position.y && position.y < monitor.position.y + monitor.size.height,
  );
  if (containing) return containing;

  let best: T | undefined;
  let largestOverlap = 0;
  for (const monitor of monitors) {
    const { position: origin, size: area } = monitor.workArea;
    const size = widgetPhysicalSize(monitor.scaleFactor, area);
    const width = Math.max(0, Math.min(position.x + size.width, origin.x + area.width) - Math.max(position.x, origin.x));
    const height = Math.max(0, Math.min(position.y + size.height, origin.y + area.height) - Math.max(position.y, origin.y));
    if (width * height > largestOverlap) {
      largestOverlap = width * height;
      best = monitor;
    }
  }
  return best;
}
