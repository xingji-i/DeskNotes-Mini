import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { initDesktopWidget, startDesktopDrag } from "../lib/desktop";
import { WIDGET_HEIGHT, WIDGET_WIDTH } from "../lib/desktopGeometry";

type Point = { x: number; y: number };
const PIN_KEY = "desknote_pinned_v1";
const BROWSER_POSITION_KEY = "desknote_browser_position_v1";

function readPreference(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch { return null; }
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function useWidgetPlacement(shell: Ref<HTMLElement | null>) {
  const native = isTauri();
  const pinned = ref(readPreference(PIN_KEY) === true);
  const placementError = ref<string | null>(null);
  const storedPosition = native ? null : readPreference(BROWSER_POSITION_KEY);
  const position = ref<Point>(isPoint(storedPosition) ? storedPosition : { x: 0, y: 0 });
  const dragging = ref(false);
  let drag: { pointerId: number; origin: Point; offset: Point } | undefined;

  const style = computed(() => native ? {} : {
    position: "fixed" as const,
    left: `${position.value.x}px`,
    top: `${position.value.y}px`,
  });

  const persist = (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      placementError.value = null;
    } catch {
      placementError.value = "位置设置未能保存，重启后可能恢复默认。";
    }
  };
  const clampPosition = (point: Point): Point => {
    const bounds = shell.value?.getBoundingClientRect();
    const width = bounds?.width ?? Math.min(WIDGET_WIDTH, innerWidth);
    const height = bounds?.height ?? Math.min(WIDGET_HEIGHT, innerHeight);
    return {
      x: Math.round(Math.max(0, Math.min(point.x, innerWidth - width))),
      y: Math.round(Math.max(0, Math.min(point.y, innerHeight - height))),
    };
  };
  const fitBrowser = () => {
    position.value = clampPosition(position.value);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId || pinned.value) return;
    // Releasing the pointer outside the browser may not dispatch pointerup here.
    if (!(event.buttons & 1)) { stopDragging(); return; }
    position.value = clampPosition({
      x: drag.origin.x + event.clientX - drag.offset.x,
      y: drag.origin.y + event.clientY - drag.offset.y,
    });
  };
  const stopDragging = () => {
    if (!drag) return;
    drag = undefined;
    dragging.value = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("blur", stopDragging);
    persist(BROWSER_POSITION_KEY, position.value);
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerId !== drag?.pointerId) return;
    stopDragging();
  };
  const startDragging = (event: PointerEvent) => {
    if (pinned.value || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    if (native) {
      const failureMessage = "暂时无法移动便签，请重试。";
      void startDesktopDrag(pinned.value)
        .then(() => { if (placementError.value === failureMessage) placementError.value = null; })
        .catch(() => { placementError.value = failureMessage; });
      return;
    }
    drag = {
      pointerId: event.pointerId,
      origin: { ...position.value },
      offset: { x: event.clientX, y: event.clientY },
    };
    dragging.value = true;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", stopDragging);
  };
  const togglePinned = () => {
    stopDragging();
    pinned.value = !pinned.value;
    persist(PIN_KEY, pinned.value);
  };

  onMounted(() => {
    if (!native) {
      fitBrowser();
      window.addEventListener("resize", fitBrowser);
    }
    void initDesktopWidget().catch((error) => console.error("初始化挂件失败", error));
  });
  onUnmounted(() => {
    stopDragging();
    window.removeEventListener("resize", fitBrowser);
  });

  return { pinned, dragging, style, placementError, startDragging, togglePinned };
}
