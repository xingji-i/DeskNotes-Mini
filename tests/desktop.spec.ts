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
  monitors?: Monitor[];
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
  options: { savedPosition?: Point; monitors?: Monitor[]; monitorEnumerationFails?: boolean } = {},
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
  await page.evaluate(async ({ monitor, outerPadding, currentMonitorUnavailable, options }) => {
    const mocksPath = "/node_modules/@tauri-apps/api/mocks.js";
    const eventsPath = "/node_modules/@tauri-apps/api/event.js";
    const initializerPath = "/src/lib/desktop.ts";
    const { mockIPC, mockWindows } = await import(mocksPath);
    const { emit } = await import(eventsPath);
    const testWindow = window as unknown as HarnessWindow;
    const state: MockState = {
      monitor,
      monitors: options.monitors,
      size: { width: 390, height: 450 },
      position: { x: 1900, y: 1000 },
      calls: [],
      shown: [],
    };
    if (options.savedPosition) localStorage.setItem("desknote_position_v1", JSON.stringify(options.savedPosition));
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
        case "plugin:window|available_monitors":
          if (options.monitorEnumerationFails) throw new Error("Monitor configuration is changing");
          return state.monitors ?? [state.monitor];
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
          state.monitor = state.monitors?.find((candidate) =>
            state.position.x >= candidate.position.x && state.position.x < candidate.position.x + candidate.size.width &&
            state.position.y >= candidate.position.y && state.position.y < candidate.position.y + candidate.size.height,
          ) ?? state.monitor;
          await emit("tauri://move", state.position);
          return;
        case "plugin:window|start_dragging":
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
  }, { monitor, outerPadding, currentMonitorUnavailable, options });
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

test("Tauri IPC 模拟的移动、DPI 和尺寸事件会将越界窗口校正回工作区", async ({ page }) => {
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

test("移动后的物理位置会保存，重新初始化不再重置到右上角", async ({ page }) => {
  const errors = await startMockedDesktop(page);
  const savedImmediately = await page.evaluate(async () => {
    const { state, emit } = (window as unknown as HarnessWindow).desktopHarness;
    state.position = { x: 240, y: 180 };
    await emit("tauri://move", state.position);
    return localStorage.getItem("desknote_position_v1");
  });
  expect(savedImmediately).toBe('{"x":240,"y":180}');
  await page.evaluate(async () => {
    const { state } = (window as unknown as HarnessWindow).desktopHarness;
    state.position = { x: 0, y: 0 };
    const initializerPath = "/src/lib/desktop.ts";
    const { initDesktopWidget } = await import(initializerPath);
    await initDesktopWidget();
  });
  const state = await readState(page);
  expect(state.position).toEqual({ x: 240, y: 180 });
  expect(state.shown.at(-1)?.position).toEqual({ x: 240, y: 180 });
  expect(state.shown).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("重启时找到保存位置所属的负坐标副屏，并按该屏 DPI 和工作区恢复", async ({ page }) => {
  const secondary: Monitor = {
    name: "200% display to the upper left",
    position: { x: -2560, y: -400 },
    size: { width: 2560, height: 1440 },
    workArea: { position: { x: -2500, y: -400 }, size: { width: 2500, height: 1400 } },
    scaleFactor: 2,
  };
  const errors = await startMockedDesktop(page, primary, { width: 0, height: 0 }, false, {
    savedPosition: { x: -100, y: 800 }, monitors: [primary, secondary],
  });
  const state = await readState(page);
  expect(state.size).toEqual({ width: 720, height: 900 });
  expect(state.position).toEqual({ x: -720, y: 100 });
  expect(state.calls.filter(({ command }) => /\|(set_position|set_size)$/.test(command))).toEqual([
    { command: "plugin:window|set_position", args: { label: "main", value: { Physical: { x: -720, y: 100 } } } },
    { command: "plugin:window|set_size", args: { label: "main", value: { Physical: { width: 720, height: 900 } } } },
  ]);
  expect(state.shown).toEqual([{ size: state.size, position: state.position }]);
  expect(await page.evaluate(() => localStorage.getItem("desknote_position_v1"))).toBe('{"x":-720,"y":100}');
  expect(errors).toEqual([]);
});

test("保存位置所在的副屏被断开时回到可见屏幕，再显示挂件", async ({ page }) => {
  const errors = await startMockedDesktop(page, primary, { width: 0, height: 0 }, false, {
    savedPosition: { x: -2200, y: -200 }, monitors: [primary],
  });
  const state = await readState(page);
  expect(state.position).toEqual({ x: 1440, y: 30 });
  expect(state.shown).toEqual([{ size: state.size, position: state.position }]);
  expect(await page.evaluate(() => localStorage.getItem("desknote_position_v1"))).toBe('{"x":1440,"y":30}');
  expect(errors).toEqual([]);
});

test("钉住时和浏览器环境不调用原生拖动，解除钉住后只发送拖动命令", async ({ page }) => {
  const errors = await startMockedDesktop(page);
  const callsBefore = (await readState(page)).calls.length;
  await page.evaluate(async () => {
    const initializerPath = "/src/lib/desktop.ts";
    const { startDesktopDrag } = await import(initializerPath);
    await startDesktopDrag(true);
    (window as unknown as HarnessWindow).isTauri = false;
    await startDesktopDrag(false);
    (window as unknown as HarnessWindow).isTauri = true;
  });
  expect((await readState(page)).calls).toHaveLength(callsBefore);
  await page.evaluate(async () => {
    const initializerPath = "/src/lib/desktop.ts";
    const { startDesktopDrag } = await import(initializerPath);
    await startDesktopDrag(false);
  });
  expect((await readState(page)).calls.slice(callsBefore)).toEqual([
    { command: "plugin:window|start_dragging", args: { label: "main" } },
  ]);
  expect(errors).toEqual([]);
});

test("枚举显示器暂时失败仍按当前工作区定位并显示", async ({ page }) => {
  const errors = await startMockedDesktop(page, primary, { width: 0, height: 0 }, false, {
    savedPosition: { x: -2200, y: -200 }, monitorEnumerationFails: true,
  });
  const state = await readState(page);
  expect(state.position).toEqual({ x: 1440, y: 30 });
  expect(state.shown).toEqual([{ size: state.size, position: state.position }]);
  expect(errors).toEqual([]);
});
