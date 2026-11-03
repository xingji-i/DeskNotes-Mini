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

const themes = [
  ["午后小憩", "cat"],
  ["山野来信", "mountains"],
  ["海岸微风", "coast"],
  ["林间小屋", "cabin"],
  ["花与小书", "botanical"],
  ["月色入湖", "moon"],
] as const;

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
  await page.getByTitle("添加（建议只设置5件）").click();
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

test("六款插画生成不同预览，选择会保存且关闭导出不改变任务", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 450 });
  await page.goto("/");
  await page.getByRole("checkbox").first().click();
  const savedTasks = await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"));
  const checkboxCount = await page.getByRole("checkbox").count();
  await page.getByTitle("导出卡片").click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  await expect(dialog.getByRole("button", { name: "插画：午后小憩", exact: true })).toHaveAttribute("aria-pressed", "true");
  const previews = new Set<string>();
  let finalPreviewDigest = "";
  for (const [name, value] of themes) {
    const choice = dialog.getByRole("button", { name: `插画：${name}`, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("group", { name: "插画主题", exact: true }).getByRole("button", { pressed: true })).toHaveCount(1);
    const png = await previewPng(dialog);
    await expect(choice).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate((panel) => panel.scrollHeight <= panel.clientHeight)).toBe(true);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    finalPreviewDigest = pngDigest(png);
    previews.add(finalPreviewDigest);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("desknote_export_theme_v1"))).toBe(value);
  }
  expect(previews.size).toBe(themes.length);
  await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTitle("导出卡片")).toBeFocused();
  await expect(page.getByRole("checkbox")).toHaveCount(checkboxCount);
  expect(await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"))).toBe(savedTasks);

  await page.reload();
  await page.getByTitle("导出卡片").click();
  await expect(dialog.getByRole("button", { name: "插画：月色入湖", exact: true })).toHaveAttribute("aria-pressed", "true");
  const restoredPreview = await previewPng(dialog);
  expect(pngDigest(restoredPreview)).toBe(finalPreviewDigest);
  expect(await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"))).toBe(savedTasks);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTitle("导出卡片")).toBeFocused();
});

test("快速切换时较早请求的 PNG 不会覆盖最终插画", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("导出卡片").click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  await previewPng(dialog);
  await dialog.getByRole("button", { name: "插画：月色入湖", exact: true }).click();
  const moonDigest = pngDigest(await previewPng(dialog));
  await dialog.getByRole("button", { name: "插画：午后小憩", exact: true }).click();
  expect(pngDigest(await previewPng(dialog))).not.toBe(moonDigest);

  // Keep encoders in flight, then complete them newest first to reproduce
  // an older render finishing after the user's final selection.
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
  });
  const rapidChoices = ["山野来信", "海岸微风", "月色入湖"];
  for (const [index, name] of rapidChoices.entries()) {
    await dialog.getByRole("button", { name: `插画：${name}`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.pendingCardPngs)).toBe(String(index + 1));
  }
  await page.evaluate(() => window.dispatchEvent(new Event("desknote:test-release-pngs")));
  await expect(dialog.getByRole("button", { name: "插画：月色入湖", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(pngDigest(await previewPng(dialog))).toBe(moonDigest);
});

test("26款原创线稿完整有效，PNG各不相同且重复导出保持一致", async ({ page }) => {
  await page.goto("/");
  const catalog = await themeCatalog(page);
  expect(catalog).toHaveLength(26);
  expect(new Set(catalog.map(({ id }) => id)).size).toBe(26);
  expect(new Set(catalog.map(({ name }) => name)).size).toBe(26);
  expect(catalog.filter(({ category }) => category === "nature")).toHaveLength(6);
  expect(catalog.filter(({ category }) => category === "china")).toHaveLength(10);
  expect(catalog.filter(({ category }) => category === "world")).toHaveLength(10);
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
  expect(new Set(digests.map(({ first }) => first)).size).toBe(26);
});

test("建筑分类、名称地点描述搜索及空态在紧凑窗口内可用", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 450 });
  await page.goto("/");
  const catalog = await themeCatalog(page);
  await page.getByTitle("导出卡片").click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  const categories = dialog.getByRole("group", { name: "主题分类", exact: true });
  const choices = dialog.getByRole("group", { name: "插画主题", exact: true });
  const search = dialog.getByRole("searchbox", { name: "搜索插画", exact: true });
  await previewPng(dialog);
  await expect(categories.getByRole("button", { name: "分类：全部", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(choices.getByRole("button")).toHaveCount(26);
  expect(await choices.evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);
  for (const [name, count] of [["日常风景", 6], ["中国建筑", 10], ["世界建筑", 10], ["全部", 26]] as const) {
    const category = categories.getByRole("button", { name: `分类：${name}`, exact: true });
    await category.click();
    await expect(category).toHaveAttribute("aria-pressed", "true");
    await expect(categories.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(choices.getByRole("button")).toHaveCount(count);
  }

  const architecture = catalog.find(({ category }) => category === "china")!;
  for (const term of [architecture.name, architecture.location ?? "", architecture.description]) {
    expect(term).toBeTruthy();
    await search.fill(term);
    const expected = catalog.filter((theme) => [theme.name, theme.location, theme.description]
      .some((field) => (field ?? "").toLocaleLowerCase().includes(term.toLocaleLowerCase())));
    await expect(choices.getByRole("button")).toHaveCount(expected.length);
    for (const theme of expected) {
      await expect(choices.getByRole("button", { name: `插画：${theme.name}`, exact: true })).toBeVisible();
    }
  }

  await categories.getByRole("button", { name: "分类：世界建筑", exact: true }).click();
  await search.fill("不存在的建筑xyz987");
  await expect(dialog.getByText("没有找到这幅风景", { exact: true })).toBeVisible();
  await expect(choices.getByRole("button", { name: /^插画：/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(categories.getByRole("button", { name: "分类：全部", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(choices.getByRole("button")).toHaveCount(26);
  await choices.getByRole("button").last().scrollIntoViewIfNeeded();
  await expect(choices.getByRole("button").last()).toBeInViewport({ ratio: 1 });
  await expect(search).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate((panel) => panel.scrollHeight <= panel.clientHeight && panel.scrollWidth <= panel.clientWidth)).toBe(true);
});

test("建筑主题记忆分类与预览，放大查看支持返回和Escape且不影响任务", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 450 });
  await page.goto("/");
  const catalog = await themeCatalog(page);
  const architecture = catalog.filter(({ category }) => category === "world").at(-1)!;
  const tasksBefore = await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"));
  await page.getByTitle("导出卡片").click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  await dialog.getByRole("button", { name: "分类：世界建筑", exact: true }).click();
  const choice = dialog.getByRole("button", { name: `插画：${architecture.name}`, exact: true });
  await choice.click();
  const digest = pngDigest(await previewPng(dialog));
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(choice).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
  await page.reload();
  await page.getByTitle("导出卡片").click();
  await expect(dialog.getByRole("button", { name: "分类：世界建筑", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  expect(pngDigest(await previewPng(dialog))).toBe(digest);
  await expect(choice).toBeInViewport({ ratio: 1 });

  const zoomButton = dialog.getByRole("button", { name: "放大预览", exact: true });
  await zoomButton.click();
  const enlarged = dialog.getByRole("img", { name: "放大卡片预览", exact: true });
  await expect(enlarged).toBeVisible();
  const enlargedPng = Buffer.from(await enlarged.evaluate(async (image: HTMLImageElement) => (
    Array.from(new Uint8Array(await (await fetch(image.currentSrc)).arrayBuffer()))
  )));
  expect(pngDigest(enlargedPng)).toBe(digest);
  await expect(dialog.getByRole("button", { name: "返回选图", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "保存 PNG", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate((panel) => panel.scrollHeight <= panel.clientHeight)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(enlarged).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(zoomButton).toBeFocused();
  await zoomButton.click();
  await dialog.getByRole("button", { name: "返回选图", exact: true }).click();
  await expect(enlarged).toHaveCount(0);
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTitle("导出卡片")).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("desknote_tasks_v1"))).toBe(tasksBefore);
});

test("319像素窄预览无横向溢出，建筑筛选与放大保存按钮可达", async ({ page }) => {
  await page.setViewportSize({ width: 319, height: 450 });
  await page.goto("/");
  const catalog = await themeCatalog(page);
  const architecture = catalog.find(({ category }) => category === "china")!;
  const exportButton = page.getByTitle("导出卡片");
  await expect(exportButton).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "导出卡片", exact: true });
  const categories = dialog.getByRole("group", { name: "主题分类", exact: true });
  const saveButton = dialog.getByRole("button", { name: "保存 PNG", exact: true });
  await previewPng(dialog);
  await expect(dialog.getByRole("button", { name: "返回待办", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(saveButton).toBeInViewport({ ratio: 1 });
  for (const category of await categories.getByRole("button").all()) {
    await expect(category).toBeInViewport({ ratio: 1 });
  }
  expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await categories.getByRole("button", { name: "分类：中国建筑", exact: true }).click();
  const search = dialog.getByRole("searchbox", { name: "搜索插画", exact: true });
  await search.fill(architecture.name);
  const choice = dialog.getByRole("button", { name: `插画：${architecture.name}`, exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(choice).toBeInViewport({ ratio: 1 });
  const digest = pngDigest(await previewPng(dialog));
  await dialog.getByRole("button", { name: "放大预览", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "放大卡片预览", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "返回选图", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(saveButton).toBeInViewport({ ratio: 1 });
  await expect(saveButton).toBeEnabled();
  expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth && panel.scrollHeight <= panel.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue(architecture.name);
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  expect(pngDigest(await previewPng(dialog))).toBe(digest);
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
    for (const category of await dialog.getByRole("group", { name: "主题分类", exact: true }).getByRole("button").all()) {
      await expect(category).toBeInViewport({ ratio: 1 });
    }
    const search = dialog.getByRole("searchbox", { name: "搜索插画", exact: true });
    await expect(search).toBeInViewport({ ratio: 1 });
    const choice = dialog.getByRole("group", { name: "插画主题", exact: true }).getByRole("button").last();
    await choice.click();
    await expect(choice).toBeInViewport({ ratio: 1 });
    await previewPng(dialog);
    await expect(save).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
    await assertContained();
    await dialog.getByRole("button", { name: "放大预览", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "返回选图", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(choice).toBeInViewport({ ratio: 1 });
    await dialog.getByRole("button", { name: "返回待办", exact: true }).click();
    await expect(exportButton).toBeFocused();
    await assertContained();
  });
}

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
