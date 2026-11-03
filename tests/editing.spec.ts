import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("desknote_tasks_v1") === null) {
      localStorage.setItem("desknote_tasks_v1", JSON.stringify([
        { id: 101, text: "整理今天的笔记", completed: false },
        { id: 102, text: "读完一章书", completed: false },
      ]));
    }
  });
  await page.goto("/");
});

test("键盘在编辑框与保存按钮间切换不会丢失草稿，Enter 保存并持久化", async ({ page }) => {
  const row = page.getByRole("checkbox", { name: "整理今天的笔记", exact: true }).locator("..");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const edit = page.getByRole("textbox", { name: "编辑任务", exact: true });
  const save = page.getByRole("button", { name: "保存", exact: true });
  await edit.fill("整理并归档今天的笔记");
  await edit.press("Tab");
  await expect(save).toBeFocused();
  await expect(edit).toHaveValue("整理并归档今天的笔记");
  await save.press("Shift+Tab");
  await expect(edit).toBeFocused();
  await edit.press("Tab");
  await save.press("Enter");
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "整理并归档今天的笔记", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "整理并归档今天的笔记", exact: true })).toBeVisible();
});

test("编辑的 Enter 保存，Escape 取消；输入法候选词 Escape 不取消", async ({ page }) => {
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  const edit = page.getByRole("textbox", { name: "编辑任务", exact: true });
  await edit.fill("通过回车保存的任务");
  await edit.press("Enter");
  const row = page.getByRole("checkbox", { name: "通过回车保存的任务", exact: true }).locator("..");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await edit.fill("尚未保存的中文草稿");
  await edit.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(edit).toHaveValue("尚未保存的中文草稿");
  await edit.press("Escape");
  await expect(edit).toHaveCount(0);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await edit.fill("在保存按钮处取消的草稿");
  await edit.press("Tab");
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(save).toBeFocused();
  await save.press("Escape");
  await expect(edit).toHaveCount(0);
  await expect(row).toBeVisible();
});

test("同一行内保留草稿，焦点离开该行或点击卡片空白处取消", async ({ page }) => {
  const checkbox = page.getByRole("checkbox", { name: "整理今天的笔记", exact: true });
  const row = checkbox.locator("..");
  const edit = page.getByRole("textbox", { name: "编辑任务", exact: true });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await edit.fill("离开行时取消的草稿");
  await edit.press("Shift+Tab");
  await expect(checkbox).toBeFocused();
  await expect(edit).toHaveValue("离开行时取消的草稿");
  await checkbox.press("Tab");
  await expect(edit).toBeFocused();
  await edit.press("Tab");
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(save).toBeFocused();
  await save.press("Tab");
  const remove = row.getByRole("button", { name: "删除", exact: true });
  await expect(remove).toBeFocused();
  await expect(edit).toHaveValue("离开行时取消的草稿");
  await remove.press("Tab");
  await expect(page.getByRole("checkbox", { name: "读完一章书", exact: true })).toBeFocused();
  await expect(edit).toHaveCount(0);
  await expect(checkbox).toBeVisible();

  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await edit.fill("点击空白处时取消的草稿");
  await page.locator(".task-card").click({ position: { x: 20, y: 260 } });
  await expect(edit).toHaveCount(0);
  await expect(checkbox).toBeVisible();
  await page.reload();
  await expect(checkbox).toBeVisible();
});
