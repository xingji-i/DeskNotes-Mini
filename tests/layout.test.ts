import assert from "node:assert/strict";
import test from "node:test";
import { wrapText } from "../src/lib/textLayout.ts";
import { formatShortDate, formatFileDate } from "../src/lib/date.ts";

test("长文本按可用宽度换行，不丢字符或拆开 emoji 码点", () => {
  const text = "明天完成报告🙂abcdef";
  const lines = wrapText(text, 4, (value) => [...value].length);
  assert.equal(lines.join(""), text);
  assert.ok(lines.every((line) => [...line].length <= 4));
  assert.deepEqual(wrapText("第一行\n第二行", 10, (value) => value.length), ["第一行", "第二行"]);
});

test("日期及导出文件名使用同一个本地日期，包含年份", () => {
  const date = new Date(2026, 0, 2, 23, 59);
  assert.equal(formatShortDate(date), "01.02");
  assert.equal(formatFileDate(date), "20260102");
});
