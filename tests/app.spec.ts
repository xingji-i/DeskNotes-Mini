import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";

type ThemeMetadata = {
  id: string;
  name: string;
  description: string;
  location?: string;
  category: "nature" | "china" | "world";
};

async function themeCatalog(page: Page): Promise<ThemeMetadata[]> {
  return page.evaluate(async () => {
    const modulePath = "/src/lib/sketches.ts";
    const { SKETCH_THEMES } = await import(modulePath);
    return SKETCH_THEMES;
  });
}

async function previewPng(dialog: Locator): Promise<Buffer> {
  const preview = dialog.getByRole("img", { name: "导出卡片预览" });
  await expect(preview).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeEnabled();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => (
    image.complete && image.naturalWidth === 900 && image.naturalHeight >= 1200
  ))).toBe(true);
  return Buffer.from(await preview.evaluate(async (image: HTMLImageElement) => (
    Array.from(new Uint8Array(await (await fetch(image.currentSrc)).arrayBuffer()))
  )));
}

function pngDigest(png: Buffer): string {
  return createHash("sha256").update(png).digest("hex");
}

test("中文输入、编辑聚焦、完成排序、持久化及删除", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "建议只设置最紧急的5项", exact: true }).click();
  const input = page.getByRole("textbox", { name: "新任务" });
  await expect(input).toBeFocused();
  await input.fill("中文候选词");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(input).toBeVisible();
  await input.press("Enter");
  await expect(page.getByRole("checkbox").first()).toHaveAccessibleName("中文候选词");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  const edit = page.getByRole("textbox", { name: "编辑任务" });
  await expect(edit).toBeFocused();
  await edit.fill("已修改的测试任务");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("checkbox", { name: "已修改的测试任务" }).click();
  await expect(page.getByRole("checkbox", { name: "已修改的测试任务" })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "已修改的测试任务" })).toHaveAttribute("aria-checked", "true");
  const row = page.getByRole("checkbox", { name: "已修改的测试任务" }).locator("..");
  await row.getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("checkbox", { name: "已修改的测试任务" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("长列表可滚动，长文本不挤出按钮，浏览器导出有效 PNG", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("desknote_tasks_v1", JSON.stringify(Array.from({ length: 20 }, (_, i) => ({
      id: i, text: `${i}这是一条需要换行的很长的任务内容用于检查中文排版abcdefghijk`, completed: i % 2 === 0,
    }))));
  });
  await page.goto("/");
  const list = page.getByLabel("任务列表");
  const bounds = await list.evaluate((el) => ({
    scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
  }));
  expect(bounds.scrollHeight).toBeGreaterThan(bounds.clientHeight);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  await page.getByRole("checkbox").last().scrollIntoViewIfNeeded();
  await expect(page.getByRole("checkbox").last()).toBeInViewport();
  await page.getByTitle("导出卡片").click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  const preview = await previewPng(dialog);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "保存 PNG", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^DeskNote_\d{8}\.png$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(900);
  expect(png.readUInt32BE(20)).toBeGreaterThan(1200);
  expect(pngDigest(png)).toBe(pngDigest(preview));
  await expect(page.getByRole("status")).toHaveText("卡片已下载");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeEnabled();
});

test("每次打开随机选画，忽略旧偏好并保持待办不变", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("desknote_export_theme_v1", "moon"));
  await page.goto("/");
  const catalog = await themeCatalog(page);
  await page.getByRole("checkbox").first().click();
  const savedTasks = await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"));
  const checkboxCount = await page.getByRole("checkbox").count();
  const exportButton = page.getByTitle("导出卡片");
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  const digests = new Set<string>();
  // Cover both ends of the random range, a middle entry, and both new collections.
  for (const value of [0, 0.5, 26.5 / catalog.length, 32.5 / catalog.length, 0.999999]) {
    await page.evaluate((random) => { Math.random = () => random; }, value);
    await exportButton.click();
    const png = await previewPng(dialog);
    await expect(dialog.getByRole("img", { name: "导出卡片预览", exact: true }))
      .toHaveAttribute("data-theme", catalog[Math.floor(value * catalog.length)].id);
    await expect(dialog.getByRole("button")).toHaveCount(2);
    await expect(dialog.getByRole("searchbox")).toHaveCount(0);
    await expect(dialog.getByRole("group")).toHaveCount(0);
    digests.add(pngDigest(png));
    await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(exportButton).toBeFocused();
  }
  expect(digests.size).toBe(5);
  await expect(page.getByRole("checkbox")).toHaveCount(checkboxCount);
  expect(await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"))).toBe(savedTasks);
  expect(await page.evaluate(() => localStorage.getItem("desknote_export_theme_v1"))).toBe("moon");
});

test("关闭后未完成的预览不会覆盖重新打开的随机插画", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const catalog = await themeCatalog(page);
  const exportButton = page.getByTitle("导出卡片");
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  await page.evaluate(() => { Math.random = () => 0.999999; });
  await exportButton.click();
  const expectedDigest = pngDigest(await previewPng(dialog));
  await dialog.getByRole("button", { name: "返回待办", exact: true }).click();

  // Finish the old, unmounted panel's encoding after the new panel's encoding.
  await page.evaluate(() => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    const pending: Array<() => void> = [];
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      originalToBlob.call(this, (blob) => {
        pending.push(() => callback(blob));
        document.documentElement.dataset.pendingCardPngs = String(pending.length);
      }, type, quality);
    };
    window.addEventListener("desknote:test-release-pngs", () => {
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
      for (const complete of pending.reverse()) complete();
      delete document.documentElement.dataset.pendingCardPngs;
    }, { once: true });
    Math.random = () => 0;
  });
  await exportButton.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.pendingCardPngs)).toBe("1");
  await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
  await page.evaluate(() => { Math.random = () => 0.999999; });
  await exportButton.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.pendingCardPngs)).toBe("2");
  await page.evaluate(() => window.dispatchEvent(new Event("desknote:test-release-pngs")));
  expect(pngDigest(await previewPng(dialog))).toBe(expectedDigest);
  await expect(dialog.getByRole("img", { name: "导出卡片预览", exact: true }))
    .toHaveAttribute("data-theme", catalog.at(-1)!.id);
  expect(errors).toEqual([]);
});

test("38款原创线稿完整有效，PNG各不相同且重复导出保持一致", async ({ page }) => {
  await page.goto("/");
  const catalog = await themeCatalog(page);
  expect(catalog).toHaveLength(38);
  expect(new Set(catalog.map(({ id }) => id)).size).toBe(38);
  expect(new Set(catalog.map(({ name }) => name)).size).toBe(38);
  expect(catalog.filter(({ category }) => category === "nature")).toHaveLength(12);
  expect(catalog.filter(({ category }) => category === "china")).toHaveLength(13);
  expect(catalog.filter(({ category }) => category === "world")).toHaveLength(13);
  const digests = await page.evaluate(async (themeValues) => {
    const modulePath = "/src/lib/exportCard.ts";
    const sketchModulePath = "/src/lib/sketches.ts";
    const { renderCard } = await import(modulePath);
    const { createSketchSvg } = await import(sketchModulePath);
    await document.fonts.ready;
    const tasks = [
      { id: 1, text: "看书与散步", completed: true },
      { id: 2, text: "完成今天的设计", completed: true },
      { id: 3, text: "给明天留一点空白", completed: false },
    ];
    const date = new Date("2026-11-02T12:00:00+08:00");
    const digest = async (blob: Blob) => Array.from(new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    )).map((value) => value.toString(16).padStart(2, "0")).join("");
    const originalRandom = Math.random;
    const result: Array<{ theme: string; first: string; second: string; svgValid: boolean }> = [];
    try {
      for (const theme of themeValues) {
        const source = createSketchSvg(theme);
        const svg = new DOMParser().parseFromString(source, "image/svg+xml");
        const svgValid = !svg.querySelector("parsererror, script, foreignObject, image, use")
          && svg.documentElement.getAttribute("viewBox") === "0 0 660 220"
          && !!svg.querySelector("path, line, polyline, polygon, circle, ellipse, rect")
          && !/\b(?:href|url\s*\()|undefined|NaN/.test(source);
        Math.random = () => 0;
        const first = await digest(await renderCard(tasks, date, { theme }));
        Math.random = () => 1;
        const second = await digest(await renderCard(tasks, date, { theme }));
        result.push({ theme, first, second, svgValid });
      }
    } finally {
      Math.random = originalRandom;
    }
    return result;
  }, catalog.map(({ id }) => id));
  for (const { theme, first, second, svgValid } of digests) {
    expect(svgValid, `${theme} should be a self-contained valid SVG`).toBe(true);
    expect(second, theme).toBe(first);
  }
  expect(new Set(digests.map(({ first }) => first)).size).toBe(38);
});

for (const viewport of [{ width: 360, height: 450 }, { width: 319, height: 400 }, { width: 280, height: 360 }, { width: 280, height: 320 }]) {
  test(`紧凑视口${viewport.width}×${viewport.height}添加、滚动与导出操作完整可见`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem("desknote_tasks_v1", JSON.stringify(Array.from({ length: 16 }, (_, index) => ({
        id: index + 1, text: `待办${index + 1}：这是一条需要换行的任务，检查窄窗口仍能编辑和删除`, completed: false,
      }))));
    });
    await page.goto("/");
    const assertContained = async () => expect(await page.evaluate(() => ({
      width: document.documentElement.scrollWidth <= innerWidth,
      height: document.documentElement.scrollHeight <= innerHeight,
    }))).toEqual({ width: true, height: true });
    const add = page.getByTitle("添加（建议只设置5件）");
    const exportButton = page.getByTitle("导出卡片");
    await expect(add).toBeInViewport({ ratio: 1 });
    await expect(exportButton).toBeInViewport({ ratio: 1 });
    await expect(page.getByText("DESKNOTE MINI", { exact: true })).toBeInViewport({ ratio: 1 });
    await add.click();
    const input = page.getByRole("textbox", { name: "新任务", exact: true });
    const confirm = page.getByRole("button", { name: "确认添加", exact: true });
    const cancel = page.getByRole("button", { name: "取消添加", exact: true });
    for (const control of [input, confirm, cancel]) await expect(control).toBeInViewport({ ratio: 1 });
    expect((await input.boundingBox())!.width).toBeGreaterThan(50);
    await input.fill("窗口内可以添加任务");
    await confirm.click();
    await expect(page.getByRole("checkbox", { name: "窗口内可以添加任务", exact: true })).toBeVisible();
    await add.click();
    await cancel.click();
    const list = page.getByLabel("任务列表", { exact: true });
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
    const lastTask = page.getByRole("checkbox").last().locator("..");
    await lastTask.scrollIntoViewIfNeeded();
    await expect(lastTask.getByRole("button", { name: "编辑", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(lastTask.getByRole("button", { name: "删除", exact: true })).toBeInViewport({ ratio: 1 });
    await assertContained();

    await exportButton.click();
    const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
    const save = dialog.getByRole("button", { name: "保存 PNG", exact: true });
    await previewPng(dialog);
    await expect(dialog.getByRole("button", { name: "返回待办", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("img", { name: "导出卡片预览", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
    await assertContained();
    await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
    await expect(exportButton).toBeFocused();
    await assertContained();
  });
}

test("导出页键盘焦点循环，输入法 Escape 不会误关闭", async ({ page }) => {
  await page.goto("/");
  const exportButton = page.getByTitle("导出卡片");
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  const back = dialog.getByRole("button", { name: "返回待办", exact: true });
  const save = dialog.getByRole("button", { name: "保存 PNG", exact: true });
  await previewPng(dialog);
  await expect(back).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(back).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(back).toBeFocused();
  await back.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(dialog).toBeVisible();
  await back.dispatchEvent("keydown", { key: "Escape", keyCode: 229 });
  await expect(dialog).toBeVisible();
  await back.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(exportButton).toBeFocused();
});

test("预览失败可重试，重试和重复保存都保持同一随机插画", async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 320 });
  await page.goto("/");
  const catalog = await themeCatalog(page);
  await page.evaluate((count) => {
    Math.random = () => 1.5 / count;
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      HTMLCanvasElement.prototype.toBlob = original;
      setTimeout(() => callback(null), 0);
    };
  }, catalog.length);
  await page.getByTitle("导出卡片").click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  const preview = dialog.getByRole("img", { name: "导出卡片预览", exact: true });
  const save = dialog.getByRole("button", { name: "保存 PNG", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("图片编码失败");
  await expect(preview).toHaveCount(0);
  await expect(save).toBeDisabled();
  const retry = dialog.getByRole("button", { name: "重试预览", exact: true });
  await expect(retry).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => { Math.random = () => 0.999999; });
  await retry.click();
  const restored = await previewPng(dialog);
  await expect(preview).toHaveAttribute("data-theme", catalog[1].id);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    const downloadPromise = page.waitForEvent("download");
    await save.click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(pngDigest(Buffer.concat(chunks))).toBe(pngDigest(restored));
    await expect(preview).toHaveAttribute("data-theme", catalog[1].id);
    expect(pngDigest(await previewPng(dialog))).toBe(pngDigest(restored));
  }
});

test("打开损坏缓存不会覆盖原记录，编辑后保留备份", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("desknote_tasks_v1", "{broken"));
  await page.goto("/");
  expect(await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"))).toBe("{broken");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("checkbox").first().click();
  const result = await page.evaluate(() => ({
    current: JSON.parse(localStorage.getItem("desknote_tasks_v1")!),
    backup: Object.keys(localStorage).filter((key) => key.startsWith("desknote_tasks_v1_corrupt_")).map((key) => localStorage.getItem(key)),
  }));
  expect(Array.isArray(result.current)).toBe(true);
  expect(result.backup).toContain("{broken");
});

test("跨午夜自动更新日期", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-02T23:59:59+08:00") });
  await page.goto("/");
  await expect(page.getByText("11.02", { exact: true })).toBeVisible();
  await page.clock.fastForward(2000);
  await expect(page.getByText("11.03", { exact: true })).toBeVisible();
});
