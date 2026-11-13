import { expect, test, type Page } from "@playwright/test";

const A = "点按这里可以触发 Vue 交互";
const B = "纯白线条风格优化";

const order = (page: Page) => page.getByRole("checkbox").evaluateAll(
  (boxes) => boxes.map((box) => box.getAttribute("aria-label")),
);
const tagButton = (page: Page, text: string) =>
  page.getByRole("checkbox", { name: text }).locator("..").getByRole("button", { name: /^标签：/ });
const grip = (page: Page, text: string) => page.getByRole("button", { name: `拖动排序：${text}` });

test("简洁版默认隐藏排序与标签，复杂版开关会被记住", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "复杂版", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /^拖动排序：/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^标签：/ })).toHaveCount(0);
  await toggle.click();
  await expect(page.getByRole("button", { name: /^拖动排序：/ })).toHaveCount(4);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^标签：/ })).toHaveCount(4);
});

test("标签按红、橙、蓝循环，按标签排序并持久化", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "复杂版", exact: true }).click();
  await tagButton(page, A).click();
  await tagButton(page, A).click();
  await expect(tagButton(page, A)).toHaveAccessibleName("标签：橙色，点击切换");
  await tagButton(page, B).click();
  await expect(tagButton(page, B)).toHaveAccessibleName("标签：红色，点击切换");
  await page.getByRole("button", { name: "按标签排序", exact: true }).click();
  expect((await order(page)).slice(0, 2)).toEqual([B, A]);
  await page.reload();
  expect((await order(page)).slice(0, 2)).toEqual([B, A]);
  await expect(tagButton(page, B)).toHaveAccessibleName("标签：红色，点击切换");
  // 切回简洁版后标签数据仍保留。
  await page.getByRole("button", { name: "复杂版", exact: true }).click();
  await page.getByRole("button", { name: "复杂版", exact: true }).click();
  await expect(tagButton(page, A)).toHaveAccessibleName("标签：橙色，点击切换");
});

test("拖动或方向键排序，且不会越过已完成分组", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "复杂版", exact: true }).click();
  const initial = await order(page);
  expect(initial.slice(0, 2)).toEqual([A, B]);

  await grip(page, A).focus();
  await page.keyboard.press("ArrowDown");
  expect((await order(page)).slice(0, 2)).toEqual([B, A]);
  await expect(grip(page, A)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  expect(await order(page)).toEqual([B, A, initial[2], initial[3]]);

  const from = (await grip(page, A).boundingBox())!;
  const to = (await grip(page, B).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 5 });
  await page.mouse.up();
  expect(await order(page)).toEqual(initial);
  await page.reload();
  expect(await order(page)).toEqual(initial);
});
