import { isTauri } from "@tauri-apps/api/core";
import {
  currentMonitor,
  primaryMonitor,
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
  type Monitor,
} from "@tauri-apps/api/window";
import { widgetPhysicalSize, widgetPosition } from "./desktopGeometry";
import { DESKTOP_POSITION_KEY, monitorForPosition, parseDesktopPosition, type DesktopPosition } from "./desktopPosition";

let disposeWidget: (() => void) | undefined;

function rememberPosition(position: DesktopPosition) {
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y)) return;
  try {
    const value = JSON.stringify({ x: position.x, y: position.y });
    if (localStorage.getItem(DESKTOP_POSITION_KEY) !== value) localStorage.setItem(DESKTOP_POSITION_KEY, value);
  } catch { /* Moving remains available if the position cannot be saved. */ }
}

export async function startDesktopDrag(pinned: boolean): Promise<void> {
  if (pinned || !isTauri()) return;
  await getCurrentWindow().startDragging();
}

export async function initDesktopWidget(): Promise<void> {
  if (!isTauri()) return;
  disposeWidget?.();
  const win = getCurrentWindow();
  const unlisten: (() => void)[] = [];
  let disposed = false;
  let correcting = false;
  let queued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fitToMonitor = async (initial = false) => {
    let savedPosition: DesktopPosition | undefined;
    if (initial) {
      try {
        savedPosition = parseDesktopPosition(localStorage.getItem(DESKTOP_POSITION_KEY));
      } catch { /* The widget also works when storage is unavailable. */ }
    }
    let savedMonitor: Monitor | undefined;
    if (savedPosition) {
      try {
        savedMonitor = monitorForPosition(savedPosition, await availableMonitors());
      } catch { /* Display enumeration can fail during a display configuration change. */ }
    }
    const monitor = savedMonitor ?? (await currentMonitor()) ?? (await primaryMonitor());
    if (disposed) return;
    const scale = monitor?.scaleFactor ?? await win.scaleFactor();
    const desiredSize = widgetPhysicalSize(scale, monitor?.workArea.size);
    // Enter the saved display while hidden, then size for its DPI. Resizing on
    // the old display first can be scaled a second time by Windows on the move.
    if (savedMonitor && savedPosition) {
      const target = widgetPosition(savedMonitor.workArea, desiredSize, scale, savedPosition);
      await win.setPosition(new PhysicalPosition(target.x, target.y));
      if (disposed) return;
    }
    const currentSize = await win.innerSize();
    if (disposed) return;
    if (currentSize.width !== desiredSize.width || currentSize.height !== desiredSize.height) {
      await win.setSize(new PhysicalSize(desiredSize.width, desiredSize.height));
    }
    if (monitor) {
      // Use the measured outer size, not a second estimate from logical pixels.
      const [size, position] = await Promise.all([win.outerSize(), win.outerPosition()]);
      if (disposed) return;
      const restoredPosition = savedMonitor ? savedPosition : undefined;
      const target = widgetPosition(monitor.workArea, size, scale, initial ? restoredPosition : position);
      if (target.x !== position.x || target.y !== position.y) {
        await win.setPosition(new PhysicalPosition(target.x, target.y));
      }
    }
    if (!disposed) {
      const position = await win.outerPosition();
      if (disposed) return;
      rememberPosition(position);
    }
  };

  const correctBounds = async () => {
    if (disposed) return;
    if (correcting) {
      queued = true;
      return;
    }
    correcting = true;
    try {
      do {
        queued = false;
        await fitToMonitor();
      } while (queued && !disposed);
    } catch (error) {
      console.error("校正挂件显示边界失败", error);
    } finally {
      correcting = false;
    }
  };
  const scheduleCorrection = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void correctBounds(); }, 80);
  };
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    unlisten.splice(0).forEach((stop) => stop());
    window.removeEventListener("focus", scheduleCorrection);
    window.removeEventListener("pagehide", dispose);
  };
  disposeWidget = dispose;

  try {
    await fitToMonitor(true);
    // Moving between monitors, changing DPI, or Windows resizing an off-screen
    // window must not leave its controls beyond the usable desktop area.
    const listeners = await Promise.allSettled([
      win.onScaleChanged(scheduleCorrection),
      win.onMoved(({ payload }) => {
        if (disposed) return;
        // Remember the last move even when the app closes before the debounce.
        rememberPosition(payload);
        scheduleCorrection();
      }),
      win.onResized(scheduleCorrection),
    ]);
    for (const result of listeners) {
      if (result.status === "fulfilled") {
        if (disposed) result.value();
        else unlisten.push(result.value);
      } else console.error("监听挂件窗口变化失败", result.reason);
    }
    if (!disposed) {
      window.addEventListener("focus", scheduleCorrection);
      window.addEventListener("pagehide", dispose, { once: true });
    }
  } finally {
    // Rust only maintains the z-order. Show after sizing/positioning, including
    // the failure case, so startup cannot strand a permanently hidden window.
    if (!disposed) await win.show();
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => disposeWidget?.());
