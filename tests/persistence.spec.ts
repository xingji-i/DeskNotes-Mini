import { mkdir } from "node:fs/promises";
import { chromium, expect, test, type Page } from "@playwright/test";

const TASK_KEY = "desknote_tasks_v1";
const initialTasks = [
  { id: 301, text: "确认今天的安排", completed: false },
  { id: 302, text: "已经完成的事项", completed: true },
];

async function addTask(page: Page, text: string) {
  await page.getByTitle("添加（建议只设置5件）").click();
  const input = page.getByRole("textbox", { name: "新任务", exact: true });
  await input.fill(text);
  await input.press("Enter");
}

async function readTasks(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), TASK_KEY);
}

test("独立浏览器进程关闭后重开同一测试配置，任务、位置和钉住状态仍保留", async ({ baseURL }, testInfo) => {
  test.setTimeout(60_000);
  // A dedicated temporary profile exercises disk persistence without touching a user's browser profile.
  const profile = testInfo.outputPath("persistent-profile");
  await mkdir(profile, { recursive: true });
  const launch = () => chromium.launchPersistentContext(profile, {
    channel: "msedge", headless: true, viewport: { width: 1000, height: 800 }, timezoneId: "Asia/Shanghai",
  });
  const position = (page: Page) => page.locator(".widget-shell").evaluate((element) => {
    const { x, y } = element.getBoundingClientRect();
    return { x, y };
  });
  const drag = async (page: Page, dx: number, dy: number) => {
    const bounds = await page.getByTestId("widget-drag-handle").boundingBox();
    expect(bounds).not.toBeNull();
    const start = { x: bounds!.x + 8, y: bounds!.y + bounds!.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
    await page.mouse.up();
  };
  let savedTasks: Awaited<ReturnType<typeof readTasks>>;
  const first = await launch();
  try {
    const page = first.pages()[0] ?? await first.newPage();
    await page.goto(baseURL!);
    await addTask(page, "关闭浏览器前新增的事项");
    const row = page.getByRole("checkbox", { name: "关闭浏览器前新增的事项", exact: true }).locator("..");
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const edit = page.getByRole("textbox", { name: "编辑任务", exact: true });
    await edit.fill("重开浏览器后保留的事项 🌿");
    await edit.press("Enter");
    const checkbox = page.getByRole("checkbox", { name: "重开浏览器后保留的事项 🌿", exact: true });
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    savedTasks = await readTasks(page);
    await drag(page, 180, 120);
    await expect.poll(() => position(page)).toEqual({ x: 180, y: 120 });
    await page.getByRole("button", { name: "钉住位置", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    // Closing a persistent context closes its browser process, not just its tab.
    await first.close();
  }

  const second = await launch();
  try {
    const page = second.pages()[0] ?? await second.newPage();
    await page.goto(baseURL!);
    await expect(page.getByRole("checkbox", { name: "重开浏览器后保留的事项 🌿", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    expect(await readTasks(page)).toEqual(savedTasks);
    await expect.poll(() => position(page)).toEqual({ x: 180, y: 120 });
    await expect(page.getByRole("button", { name: "取消钉住", exact: true })).toHaveAttribute("aria-pressed", "true");
    await drag(page, 60, 40);
    await expect.poll(() => position(page)).toEqual({ x: 180, y: 120 });
  } finally {
    await second.close();
  }
});

test("每次增改、完成与重开都可重启恢复，删除到空列表不会恢复示例任务", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ key, tasks }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(tasks));
  }, { key: TASK_KEY, tasks: initialTasks });
  await page.goto("/");

  await addTask(page, "  预约明天散步 🌿  ");
  await page.reload();
  const added = page.getByRole("checkbox", { name: "预约明天散步 🌿", exact: true });
  await expect(added).toBeVisible();
  await added.locator("..").getByRole("button", { name: "编辑", exact: true }).click();
  const edit = page.getByRole("textbox", { name: "编辑任务", exact: true });
  await edit.fill('约好“周末散步”与 café ☕');
  await edit.press("Enter");
  await page.reload();
  const updated = page.getByRole("checkbox", { name: '约好“周末散步”与 café ☕', exact: true });
  await expect(updated).toHaveAttribute("aria-checked", "false");
  await updated.click();
  await page.reload();
  await expect(updated).toHaveAttribute("aria-checked", "true");
  await updated.click();
  await page.reload();
  await expect(updated).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("checkbox").first()).toHaveAccessibleName('约好“周末散步”与 café ☕');

  await updated.locator("..").getByRole("button", { name: "删除", exact: true }).click();
  await page.reload();
  await expect(updated).toHaveCount(0);
  expect(await readTasks(page)).toEqual(initialTasks);
  while (await page.getByRole("button", { name: "删除", exact: true }).count()) {
    await page.getByRole("button", { name: "删除", exact: true }).first().click();
  }
  await page.reload();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("点击 ＋，记下今天最重要的事", { exact: true })).toBeVisible();
  expect(await readTasks(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("存储空间不足时明确提示并保留磁盘原值，恢复后下一次操作保存所有内存变更", async ({ page }) => {
  await page.addInitScript(({ key, tasks }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(tasks));
  }, { key: TASK_KEY, tasks: initialTasks });
  await page.goto("/");
  const original = await page.evaluate((key) => localStorage.getItem(key), TASK_KEY);
  await page.evaluate((key) => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (this === localStorage && itemKey === key) throw new DOMException("Quota exceeded", "QuotaExceededError");
      originalSet.call(this, itemKey, value);
    };
    window.addEventListener("desknote:test-restore-task-storage", () => {
      Storage.prototype.setItem = originalSet;
    }, { once: true });
  }, TASK_KEY);

  await addTask(page, "保存失败时新增的事项");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("保存任务失败，本次修改尚未保存");
  await expect(page.getByRole("checkbox", { name: "保存失败时新增的事项", exact: true })).toBeVisible();
  const row = page.getByRole("checkbox", { name: "确认今天的安排", exact: true }).locator("..");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const edit = page.getByRole("textbox", { name: "编辑任务", exact: true });
  await edit.fill("保存失败时修改的安排");
  await edit.press("Enter");
  await page.getByRole("checkbox", { name: "保存失败时修改的安排", exact: true }).click();
  await page.getByRole("checkbox", { name: "已经完成的事项", exact: true })
    .locator("..").getByRole("button", { name: "删除", exact: true }).click();
  await expect(alert).toContainText("保存任务失败");
  expect(await page.evaluate((key) => localStorage.getItem(key), TASK_KEY)).toBe(original);

  await page.evaluate(() => window.dispatchEvent(new Event("desknote:test-restore-task-storage")));
  await addTask(page, "存储恢复后新增的事项");
  await expect(alert).toHaveCount(0);
  const saved = await readTasks(page);
  expect(saved.map(({ text, completed }: { text: string; completed: boolean }) => ({ text, completed }))).toEqual([
    { text: "存储恢复后新增的事项", completed: false },
    { text: "保存失败时新增的事项", completed: false },
    { text: "保存失败时修改的安排", completed: true },
  ]);
  await page.reload();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByRole("checkbox", { name: "保存失败时修改的安排", exact: true }))
    .toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: "已经完成的事项", exact: true })).toHaveCount(0);
  expect(await readTasks(page)).toEqual(saved);
});

for (const failure of ["read", "backup-write", "backup-verification"] as const) {
  test(`启动${failure}失败后禁止覆盖原始数据，即使用户继续修改或存储恢复`, async ({ page }) => {
    const raw = failure === "read" ? JSON.stringify(initialTasks) : JSON.stringify([initialTasks[0], null]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ key, source, mode }) => {
      localStorage.setItem(key, source);
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (itemKey) {
        if (this === localStorage && itemKey === key && mode === "read") {
          throw new DOMException("Access denied", "SecurityError");
        }
        return originalGet.call(this, itemKey);
      };
      Storage.prototype.setItem = function (itemKey, value) {
        if (this === localStorage && itemKey.startsWith(`${key}_corrupt_`)) {
          if (mode === "backup-write") throw new DOMException("Quota exceeded", "QuotaExceededError");
          if (mode === "backup-verification") return;
        }
        originalSet.call(this, itemKey, value);
      };
      window.addEventListener("desknote:test-restore-task-storage", () => {
        Storage.prototype.getItem = originalGet;
        Storage.prototype.setItem = originalSet;
      }, { once: true });
    }, { key: TASK_KEY, source: raw, mode: failure });
    await page.goto("/");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("已暂停保存以保护原数据");
    await addTask(page, "暂停保存期间的临时事项");
    await expect(page.getByRole("checkbox", { name: "暂停保存期间的临时事项", exact: true })).toBeVisible();
    await page.getByRole("checkbox").first().click();
    await page.evaluate(() => window.dispatchEvent(new Event("desknote:test-restore-task-storage")));
    expect(await page.evaluate((key) => localStorage.getItem(key), TASK_KEY)).toBe(raw);
    // A failed initial read/backup must stay protected until a clean restart.
    await addTask(page, "恢复权限后仍需重启的事项");
    await expect(alert).toContainText("已暂停保存以保护原数据");
    expect(await page.evaluate((key) => localStorage.getItem(key), TASK_KEY)).toBe(raw);
    expect(errors).toEqual([]);
  });
}
