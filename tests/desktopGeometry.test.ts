import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { widgetPhysicalSize, widgetPosition, WIDGET_WIDTH, WIDGET_HEIGHT } from "../src/lib/desktopGeometry.ts";

test("125% DPI keeps the complete widget inside the physical desktop work area", () => {
  const area = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } };
  const size = widgetPhysicalSize(1.25, area.size);
  assert.deepEqual(size, { width: 450, height: 563 });
  assert.deepEqual(widgetPosition(area, size, 1.25), { x: 1440, y: 30 });
});

test("secondary displays with negative origins and a left taskbar retain all edges", () => {
  const area = { position: { x: -2500, y: -400 }, size: { width: 2500, height: 1400 } };
  const size = widgetPhysicalSize(2, area.size);
  assert.deepEqual(widgetPosition(area, size, 2), { x: -768, y: -352 });
  assert.deepEqual(widgetPosition(area, size, 2, { x: 100, y: -1000 }), { x: -720, y: -400 });
});

test("measured window size, including rounding differences, determines the right boundary", () => {
  const area = { position: { x: 100, y: 50 }, size: { width: 1280, height: 960 } };
  assert.deepEqual(widgetPosition(area, { width: 541, height: 676 }, 1.5), { x: 803, y: 86 });
});

test("a work area smaller than the widget reduces the native window instead of clipping it offscreen", () => {
  const area = { position: { x: 40, y: 60 }, size: { width: 320, height: 400 } };
  const size = widgetPhysicalSize(1.5, area.size);
  assert.deepEqual(size, area.size);
  assert.deepEqual(widgetPosition(area, size, 1.5), area.position);
});

test("moving a window preserves its position unless an edge leaves the usable desktop", () => {
  const area = { position: { x: 0, y: 32 }, size: { width: 1280, height: 688 } };
  const size = widgetPhysicalSize(1);
  assert.deepEqual(widgetPosition(area, size, 1, { x: 150, y: 100 }), { x: 150, y: 100 });
  assert.deepEqual(widgetPosition(area, size, 1, { x: 1100, y: 500 }), { x: 920, y: 270 });
});

test("Tauri starts hidden with the same logical dimensions used by the rendered card", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const main = config.app.windows.find((window: { label: string }) => window.label === "main");
  assert.equal(main.width, WIDGET_WIDTH);
  assert.equal(main.height, WIDGET_HEIGHT);
  assert.equal(main.visible, false);
});
