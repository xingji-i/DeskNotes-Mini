import { isTauri } from "@tauri-apps/api/core";
import {
  currentMonitor,
  primaryMonitor,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { widgetPhysicalSize, widgetPosition } from "./desktopGeometry";

let disposeWidget: (() => void) | undefined;

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
    const monitor = (await currentMonitor()) ?? (await primaryMonitor());
    if (disposed) return;
    const scale = monitor?.scaleFactor ?? await win.scaleFactor();
    const desiredSize = widgetPhysicalSize(scale, monitor?.workArea.size);
    const currentSize = await win.innerSize();
    if (disposed) return;
    if (currentSize.width !== desiredSize.width || currentSize.height !== desiredSize.height) {
      await win.setSize(new PhysicalSize(desiredSize.width, desiredSize.height));
    }
    if (monitor) {
      // Use the measured outer size, not a second estimate from logical pixels.
      const [size, position] = await Promise.all([win.outerSize(), win.outerPosition()]);
      if (disposed) return;
      const target = widgetPosition(monitor.workArea, size, scale, initial ? undefined : position);
      if (target.x !== position.x || target.y !== position.y) {
        await win.setPosition(new PhysicalPosition(target.x, target.y));
      }
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
      win.onMoved(scheduleCorrection),
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
