import { expect, test, type Page } from "@playwright/test";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Monitor = {
  name: string;
  position: Point;
  size: Size;
  workArea: { position: Point; size: Size };
  scaleFactor: number;
};
type WindowSnapshot = { size: Size; position: Point };
type IpcCall = { command: string; args: unknown };
type MockState = WindowSnapshot & {
  monitor: Monitor;
  calls: IpcCall[];
  shown: WindowSnapshot[];
};
type HarnessWindow = Window & {
  isTauri: boolean;
  desktopHarness: {
    state: MockState;
    emit: (event: string, payload: unknown) => Promise<void>;
  };
};

const primary: Monitor = {
  name: "125% primary display",
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  scaleFactor: 1.25,
};

async function startMockedDesktop(
  page: Page,
  monitor = primary,
  outerPadding = { width: 0, height: 0 },
  currentMonitorUnavailable = false,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.goto("/");
  // The normal browser mount has already taken the non-Tauri path. Invoke the
  // production initializer again with the official SDK's IPC and event mocks.
  await page.evaluate(async ({ monitor, outerPadding, currentMonitorUnavailable }) => {
    const mocksPath = "/node_modules/@tauri-apps/api/mocks.js";
    const eventsPath = "/node_modules/@tauri-apps/api/event.js";
    const initializerPath = "/src/lib/desktop.ts";
    const { mockIPC, mockWindows } = await import(mocksPath);
    const { emit } = await import(eventsPath);
    const testWindow = window as unknown as HarnessWindow;
    const state: MockState = {
      monitor,
      size: { width: 390, height: 450 },
      position: { x: 1900, y: 1000 },
      calls: [],
      shown: [],
    };
    const snapshot = (): WindowSnapshot => ({ size: { ...state.size }, position: { ...state.position } });
    mockWindows("main");
    mockIPC(async (command: string, args: unknown) => {
      const serialized = args === undefined ? undefined : JSON.parse(JSON.stringify(args));
      state.calls.push({ command, args: serialized });
      switch (command) {
        case "plugin:window|current_monitor":
          return currentMonitorUnavailable ? null : state.monitor;
        case "plugin:window|primary_monitor":
          return state.monitor;
        case "plugin:window|scale_factor":
          return state.monitor.scaleFactor;
        case "plugin:window|inner_size":
          return { ...state.size };
        case "plugin:window|outer_size":
          return { width: state.size.width + outerPadding.width, height: state.size.height + outerPadding.height };
        case "plugin:window|outer_position":
          return { ...state.position };
        case "plugin:window|set_size":
          if (!serialized.value.Physical) throw new Error("set_size must use physical pixels");
          // A delayed response catches code that shows or measures the window
          // before the native resize has actually completed.
          await new Promise((resolve) => setTimeout(resolve, 15));
          state.size = { ...serialized.value.Physical };
          await emit("tauri://resize", state.size);
          return;
        case "plugin:window|set_position":
          if (!serialized.value.Physical) throw new Error("set_position must use physical pixels");
          await new Promise((resolve) => setTimeout(resolve, 15));
          state.position = { ...serialized.value.Physical };
          await emit("tauri://move", state.position);
          return;
        case "plugin:window|show":
          state.shown.push(snapshot());
          return;
        default:
          throw new Error(`Unexpected desktop IPC command: ${command}`);
      }
    }, { shouldMockEvents: true });
    testWindow.desktopHarness = { state, emit };
    testWindow.isTauri = true;
    const { initDesktopWidget } = await import(initializerPath);
    await initDesktopWidget();
  }, { monitor, outerPadding, currentMonitorUnavailable });
  return errors;
}

async function readState(page: Page): Promise<MockState> {
  return page.evaluate(() => (window as unknown as HarnessWindow).desktopHarness.state);
}

test("原生初始化在 125% DPI 下先完成尺寸与坐标设置，再显示完整挂件", async ({ page }) => {
  const errors = await startMockedDesktop(page);
  const state = await readState(page);
  expect(state.size).toEqual({ width: 450, height: 563 });
  expect(state.position).toEqual({ x: 1440, y: 30 });
  expect(state.shown).toEqual([{ size: state.size, position: state.position }]);
  expect(state.calls.filter(({ command }) => /\|(set_size|set_position|show)$/.test(command))).toEqual([
    { command: "plugin:window|set_size", args: { label: "main", value: { Physical: { width: 450, height: 563 } } } },
    { command: "plugin:window|set_position", args: { label: "main", value: { Physical: { x: 1440, y: 30 } } } },
    { command: "plugin:window|show", args: { label: "main" } },
  ]);
  expect(errors).toEqual([]);
});

test("原生初始化以负坐标副屏工作区和实际外框尺寸定位，当前屏幕缺失时回退主屏", async ({ page }) => {
  const secondary: Monitor = {
    name: "200% display to the upper left",
    position: { x: -2560, y: -400 },
    size: { width: 2560, height: 1440 },
    workArea: { position: { x: -2500, y: -400 }, size: { width: 2500, height: 1400 } },
    scaleFactor: 2,
  };
  const errors = await startMockedDesktop(page, secondary, { width: 1, height: 2 }, true);
  const state = await readState(page);
  expect(state.size).toEqual({ width: 720, height: 900 });
  expect(state.position).toEqual({ x: -769, y: -352 });
  expect(state.shown).toEqual([{ size: state.size, position: state.position }]);
  expect(state.calls.some(({ command }) => command === "plugin:window|primary_monitor")).toBe(true);
  expect(state.position.x + state.size.width + 1).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("真实 Tauri 移动、DPI 和尺寸事件会将越界窗口校正回工作区", async ({ page }) => {
  const errors = await startMockedDesktop(page);
  await page.evaluate(async () => {
    const { state, emit } = (window as unknown as HarnessWindow).desktopHarness;
    state.position = { x: 1900, y: 1100 };
    await emit("tauri://move", state.position);
  });
  await expect.poll(async () => (await readState(page)).position).toEqual({ x: 1470, y: 477 });

  await page.evaluate(async () => {
    const { state, emit } = (window as unknown as HarnessWindow).desktopHarness;
    state.monitor = {
      name: "150% display on the left",
      position: { x: -1280, y: 0 },
      size: { width: 1280, height: 960 },
      workArea: { position: { x: -1280, y: 40 }, size: { width: 1280, height: 880 } },
      scaleFactor: 1.5,
    };
    state.position = { x: 1000, y: 2000 };
    await emit("tauri://scale-change", { scaleFactor: 1.5, size: state.size });
  });
  await expect.poll(async () => {
    const { size, position } = await readState(page);
    return { size, position };
  }).toEqual({ size: { width: 540, height: 675 }, position: { x: -540, y: 245 } });
  await page.evaluate(async () => {
    const { state, emit } = (window as unknown as HarnessWindow).desktopHarness;
    state.size = { width: 600, height: 700 };
    state.position = { x: -1280, y: 800 };
    await emit("tauri://resize", state.size);
  });
  await expect.poll(async () => {
    const { size, position } = await readState(page);
    return { size, position };
  }).toEqual({ size: { width: 540, height: 675 }, position: { x: -1280, y: 245 } });
  const finalState = await readState(page);
  expect(finalState.shown).toHaveLength(1);
  expect(errors).toEqual([]);
});
