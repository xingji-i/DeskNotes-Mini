import { expect, test, type Locator, type Page } from "@playwright/test";

type Point = { x: number; y: number };

async function position(page: Page): Promise<Point> {
  return page.locator(".widget-shell").evaluate((element) => {
    const { x, y } = element.getBoundingClientRect();
    return { x, y };
  });
}

async function dragFrom(page: Page, target: Locator, dx: number, dy: number) {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("The drag target is not visible");
  // The header's leading date is safe to drag; its trailing controls are not.
  const start = { x: bounds.x + Math.min(8, bounds.width / 2), y: bounds.y + bounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
  await page.mouse.up();
}

async function expectPosition(page: Page, expected: Point) {
  await expect.poll(() => position(page)).toEqual(expected);
}

test.use({ viewport: { width: 1000, height: 800 } });

test("拖动到任意位置后可钉住，刷新保留位置与状态，解锁后继续移动", async ({ page }) => {
  await page.goto("/");
  const handle = page.getByTestId("widget-drag-handle");
  await expectPosition(page, { x: 0, y: 0 });
  await dragFrom(page, handle, 180, 120);
  await expectPosition(page, { x: 180, y: 120 });
  await page.getByRole("button", { name: "钉住位置", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dragFrom(page, handle, 90, 60);
  await expectPosition(page, { x: 180, y: 120 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("desknote_browser_position_v1")!)))
    .toEqual({ x: 180, y: 120 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("desknote_pinned_v1")!))).toBe(true);

  await page.reload();
  await expectPosition(page, { x: 180, y: 120 });
  await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dragFrom(page, handle, 90, 60);
  await expectPosition(page, { x: 180, y: 120 });
  await page.getByRole("button", { name: "取消钉住", exact: true }).click();
  await dragFrom(page, handle, 90, 60);
  await expectPosition(page, { x: 270, y: 180 });
  await expect(page.getByRole("button", { name: "钉住位置", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("拖动和视口缩小时保持完整可见，导出与返回保持便签位置", async ({ page }) => {
  await page.goto("/");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 520, 280);
  await expectPosition(page, { x: 520, y: 280 });
  await page.getByTitle("导出卡片").click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  await expect(dialog).toBeVisible();
  await expectPosition(page, { x: 520, y: 280 });
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
  await expectPosition(page, { x: 520, y: 280 });

  await page.getByRole("button", { name: "钉住位置", exact: true }).click();
  await page.setViewportSize({ width: 400, height: 500 });
  await expectPosition(page, { x: 40, y: 50 });
  await page.setViewportSize({ width: 280, height: 320 });
  await expectPosition(page, { x: 0, y: 0 });
  await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toBeInViewport();
  await expect(page.getByTitle("导出卡片")).toBeInViewport();
  const overflow = await page.locator(".task-card").evaluate((element) => ({
    width: element.scrollWidth > element.clientWidth,
    height: element.getBoundingClientRect().bottom > window.innerHeight,
  }));
  expect(overflow).toEqual({ width: false, height: false });
  await page.getByRole("button", { name: "取消钉住", exact: true }).click();
  await dragFrom(page, page.getByTestId("widget-drag-handle"), -200, -100);
  await expectPosition(page, { x: 0, y: 0 });
});

test("功能按钮、输入框与任务内容不会意外拖动便签", async ({ page }) => {
  await page.goto("/");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 130, 80);
  const expected = { x: 130, y: 80 };
  await dragFrom(page, page.getByRole("button", { name: "钉住位置", exact: true }), 70, 70);
  await expectPosition(page, expected);
  await expect(page.getByRole("button", { name: "钉住位置", exact: true })).toHaveAttribute("aria-pressed", "false");

  await page.getByTitle("添加（建议只设置5件）").click();
  const input = page.getByRole("textbox", { name: "新任务", exact: true });
  await input.fill("拖动时仍可编辑的便签");
  await dragFrom(page, input, 70, 70);
  await expectPosition(page, expected);
  await expect(input).toHaveValue("拖动时仍可编辑的便签");
  await input.press("Enter");
  const checkbox = page.getByRole("checkbox", { name: "拖动时仍可编辑的便签", exact: true });
  await dragFrom(page, checkbox.locator("..").locator("span").last(), 70, 70);
  await expectPosition(page, expected);
  await checkbox.click();
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expectPosition(page, expected);
});

test("非法缓存安全回退，恢复的越界坐标会钳制到可见区域", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (localStorage.getItem("desknote_browser_position_v1") === null) {
      localStorage.setItem("desknote_browser_position_v1", JSON.stringify({ x: "120", y: -400 }));
      localStorage.setItem("desknote_pinned_v1", "not-json");
    }
  });
  await page.goto("/");
  await expectPosition(page, { x: 0, y: 0 });
  await expect(page.getByRole("button", { name: "钉住位置", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => {
    localStorage.setItem("desknote_browser_position_v1", JSON.stringify({ x: 4000, y: 4000 }));
    localStorage.setItem("desknote_pinned_v1", "true");
  });
  await page.reload();
  await expectPosition(page, { x: 640, y: 350 });
  await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("存储不可用时仍可拖动和钉住，异常不会中断便签交互", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Storage unavailable", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Storage unavailable", "SecurityError"); };
  });
  await page.goto("/");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 140, 90);
  await expectPosition(page, { x: 140, y: 90 });
  await page.getByRole("button", { name: "钉住位置", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 70, 70);
  await expectPosition(page, { x: 140, y: 90 });
  expect(errors).toEqual([]);
});

test("钉住状态保存成功不会掩盖尚未保存的位置，位置写入恢复后清除提示", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, "failPositionWrite", true);
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === "desknote_browser_position_v1" && Reflect.get(window, "failPositionWrite")) {
        throw new DOMException("Position write unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    };
  });
  await page.goto("/");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 140, 90);
  await expectPosition(page, { x: 140, y: 90 });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "钉住位置", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("desknote_pinned_v1"))).toBe("true");
  expect(await page.evaluate(() => localStorage.getItem("desknote_browser_position_v1"))).toBeNull();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByRole("button", { name: "取消钉住", exact: true }).click();
  await page.evaluate(() => Reflect.set(window, "failPositionWrite", false));
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 20, 10);
  await expectPosition(page, { x: 160, y: 100 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("desknote_browser_position_v1")!)))
    .toEqual({ x: 160, y: 100 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("钉住设置写入失败仍锁住当前窗口并提示，任务编辑保存不受影响", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("desknote_pinned_v1") === null) localStorage.setItem("desknote_pinned_v1", "false");
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === "desknote_pinned_v1") {
        throw new DOMException("Pin write unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    };
  });
  await page.goto("/");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 140, 90);
  await page.getByRole("button", { name: "钉住位置", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 70, 60);
  await expectPosition(page, { x: 140, y: 90 });
  expect(await page.evaluate(() => localStorage.getItem("desknote_pinned_v1"))).toBe("false");

  await page.getByTitle("添加（建议只设置5件）").click();
  const input = page.getByRole("textbox", { name: "新任务", exact: true });
  await input.fill("钉住期间新增的任务");
  await input.press("Enter");
  const added = page.getByRole("checkbox", { name: "钉住期间新增的任务", exact: true });
  await added.locator("..").getByRole("button", { name: "编辑", exact: true }).click();
  const edit = page.getByRole("textbox", { name: "编辑任务", exact: true });
  await edit.fill("钉住期间修改并保存");
  await edit.press("Enter");
  const edited = page.getByRole("checkbox", { name: "钉住期间修改并保存", exact: true });
  await edited.click();
  await expect(edited).toHaveAttribute("aria-checked", "true");
  await expectPosition(page, { x: 140, y: 90 });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(edited).toHaveAttribute("aria-checked", "true");
  await expectPosition(page, { x: 140, y: 90 });
  await expect(page.getByRole("button", { name: "钉住位置", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("拖动中窗口失焦或鼠标在窗口外松开不会造成粘连拖动", async ({ page }) => {
  await page.goto("/");
  const handle = page.getByTestId("widget-drag-handle");
  await handle.dispatchEvent("pointerdown", { button: 0, buttons: 1, isPrimary: true, pointerId: 7, clientX: 30, clientY: 30 });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { buttons: 1, pointerId: 7, clientX: 170, clientY: 120 }));
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new PointerEvent("pointermove", { buttons: 1, pointerId: 7, clientX: 270, clientY: 220 }));
  });
  await expectPosition(page, { x: 140, y: 90 });
  await expect(handle).not.toHaveClass(/is-dragging/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("desknote_browser_position_v1")!)))
    .toEqual({ x: 140, y: 90 });

  await handle.dispatchEvent("pointerdown", { button: 0, buttons: 1, isPrimary: true, pointerId: 8, clientX: 170, clientY: 120 });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { buttons: 1, pointerId: 8, clientX: 190, clientY: 130 }));
    // No pointerup arrives when release happens outside the browser surface.
    window.dispatchEvent(new PointerEvent("pointermove", { buttons: 0, pointerId: 8, clientX: 290, clientY: 230 }));
    window.dispatchEvent(new PointerEvent("pointermove", { buttons: 1, pointerId: 8, clientX: 390, clientY: 330 }));
  });
  await expectPosition(page, { x: 160, y: 100 });
  await expect(handle).not.toHaveClass(/is-dragging/);
  await page.reload();
  await expectPosition(page, { x: 160, y: 100 });
});

test("首次导出组件加载期间缩小窗口仍保持预览完整可见", async ({ page }) => {
  let releaseModule!: () => void;
  const moduleGate = new Promise<void>((resolve) => { releaseModule = resolve; });
  let requestSeen!: () => void;
  const moduleRequested = new Promise<void>((resolve) => { requestSeen = resolve; });
  await page.route("**/src/components/ExportPanel.vue", async (route) => {
    requestSeen();
    await moduleGate;
    await route.continue();
  });
  await page.goto("/");
  await dragFrom(page, page.getByTestId("widget-drag-handle"), 520, 280);
  await page.getByTitle("导出卡片").click();
  await moduleRequested;
  try {
    await page.setViewportSize({ width: 400, height: 500 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally {
    releaseModule();
  }
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeEnabled();
  await expectPosition(page, { x: 40, y: 50 });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(400);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
  await expectPosition(page, { x: 40, y: 50 });
});
