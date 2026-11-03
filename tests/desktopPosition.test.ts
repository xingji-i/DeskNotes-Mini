import assert from "node:assert/strict";
import test from "node:test";
import { monitorForPosition, parseDesktopPosition } from "../src/lib/desktopPosition.ts";

const display = (x: number, y: number, width = 1920, height = 1080, scaleFactor = 1.25) => ({
  position: { x, y }, size: { width, height }, scaleFactor,
  workArea: { position: { x, y }, size: { width, height: height - 40 } },
});

test("stored native positions retain negative integer coordinates and reject damaged values", () => {
  assert.deepEqual(parseDesktopPosition('{"x":-1280,"y":-200}'), { x: -1280, y: -200 });
  for (const value of [null, "null", "[]", "broken", '{"x":1.5,"y":0}', '{"x":"1","y":2}', '{"x":1e100,"y":0}', '{"x":0}']) {
    assert.equal(parseDesktopPosition(value), undefined);
  }
});

test("restoring chooses the connected display containing a negative or taskbar-area position", () => {
  const primary = display(0, 0);
  const secondary = display(-2560, -400, 2560, 1440, 2);
  assert.equal(monitorForPosition({ x: -2300, y: -200 }, [primary, secondary]), secondary);
  assert.equal(monitorForPosition({ x: 1800, y: 1070 }, [primary, secondary]), primary);
});

test("partially visible positions are recoverable while a disconnected display falls back", () => {
  const primary = display(0, 0);
  assert.equal(monitorForPosition({ x: -100, y: 100 }, [primary]), primary);
  assert.equal(monitorForPosition({ x: -2100, y: -200 }, [primary]), undefined);
  assert.equal(monitorForPosition({ x: 99999, y: 99999 }, [primary]), undefined);
  assert.equal(monitorForPosition({ x: 0, y: 0 }, []), undefined);
});
