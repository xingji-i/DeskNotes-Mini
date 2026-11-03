import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultTasks,
  createTaskId,
  loadStoredTasks,
  parseStoredTasks,
  sortTasks,
  STORAGE_KEY,
  toggleTaskStatus,
  type TaskStorage,
  type TodoItem,
} from "../src/lib/tasks.ts";

const task = (id: number, completed = false, text = `任务 ${id}`): TodoItem => ({
  id, text, completed,
});

class MemoryStorage implements TaskStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  failRead = false;
  failWrite = false;
  ignoreWrite = false;

  getItem(key: string): string | null {
    if (this.failRead) throw new Error("Storage unavailable");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error("Quota exceeded");
    this.writes.push(key);
    if (!this.ignoreWrite) this.values.set(key, value);
  }
}

test("sorting is stable and does not mutate the input", () => {
  const input = [task(1, true), task(2), task(3, true), task(4)];
  assert.deepEqual(sortTasks(input).map((item) => item.id), [2, 4, 1, 3]);
  assert.deepEqual(input.map((item) => item.id), [1, 2, 3, 4]);
});

test("completed tasks move to the start of completed, reopened tasks to the start of pending", () => {
  const input = [task(1), task(2), task(3, true), task(4, true)];
  const completed = toggleTaskStatus(input, 2);
  assert.deepEqual(completed.map((item) => item.id), [1, 2, 3, 4]);
  assert.equal(completed[1].completed, true);
  assert.equal(input[1].completed, false);
  const reopened = toggleTaskStatus(completed, 4);
  assert.deepEqual(reopened.map((item) => item.id), [4, 1, 2, 3]);
  assert.equal(reopened[0].completed, false);
});

test("toggle handles a single task, no completed tasks, and a missing ID", () => {
  assert.deepEqual(toggleTaskStatus([task(0)], 0), [task(0, true)]);
  assert.deepEqual(toggleTaskStatus([task(1), task(2)], 1), [task(2), task(1, true)]);
  const input = [task(1)];
  assert.deepEqual(toggleTaskStatus(input, 999), input);
});

test("IDs remain unique for same-millisecond additions and numeric boundaries", () => {
  const tasks = [task(100), task(101)];
  assert.equal(createTaskId(tasks, 100), 102);
  assert.equal(createTaskId([task(Number.MAX_SAFE_INTEGER), task(1)], Number.MAX_SAFE_INTEGER), 2);
  assert.equal(createTaskId([], Number.NaN), 1);
});

test("an intentionally empty saved list stays empty", () => {
  assert.deepEqual(parseStoredTasks("[]"), { tasks: [], hasInvalidData: false });
});

test("validation retains usable records, rejects invalid field types and repairs duplicate IDs", () => {
  const parsed = parseStoredTasks(JSON.stringify([
    task(1, true), task(2), task(2, false, "第二条同 ID 任务"), task(0),
    null, { id: 3, text: "bad", completed: "false" },
    task(4, false, "  "), task(-1), task(1.5), task(Number.MAX_SAFE_INTEGER + 1),
  ]));
  assert.equal(parsed.hasInvalidData, true);
  assert.equal(parsed.tasks.length, 4);
  assert.equal(new Set(parsed.tasks.map((item) => item.id)).size, 4);
  assert.deepEqual(parsed.tasks.map((item) => item.text), ["任务 2", "第二条同 ID 任务", "任务 0", "任务 1"]);
});

test("malformed JSON and non-array roots recover independent defaults", () => {
  for (const raw of ["{", "null", "{}", "0", "\"text\""]) {
    const parsed = parseStoredTasks(raw);
    assert.equal(parsed.hasInvalidData, true);
    assert.deepEqual(parsed.tasks, createDefaultTasks());
  }
  const first = createDefaultTasks();
  first[0].text = "changed";
  assert.notEqual(createDefaultTasks()[0].text, "changed");
});

test("normal startup reads without writing defaults or reordering saved data on disk", () => {
  const storage = new MemoryStorage();
  assert.equal(loadStoredTasks(storage).canPersist, true);
  assert.deepEqual(storage.writes, []);
  const raw = JSON.stringify([task(1, true), task(2)]);
  storage.values.set(STORAGE_KEY, raw);
  const loaded = loadStoredTasks(storage);
  assert.deepEqual(loaded.tasks.map((item) => item.id), [2, 1]);
  assert.equal(loaded.storageError, null);
  assert.equal(storage.values.get(STORAGE_KEY), raw);
  assert.deepEqual(storage.writes, []);
});

test("corrupt data is backed up verbatim before persistence is enabled", () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify([task(1), null]);
  storage.values.set(STORAGE_KEY, raw);
  const loaded = loadStoredTasks(storage);
  assert.deepEqual(loaded.tasks, [task(1)]);
  assert.equal(loaded.canPersist, true);
  assert.ok(loaded.storageError);
  assert.equal(storage.values.get(STORAGE_KEY), raw);
  assert.equal(storage.writes.length, 1);
  assert.notEqual(storage.writes[0], STORAGE_KEY);
  assert.equal(storage.values.get(storage.writes[0]), raw);
});

test("repeated recovery never replaces a previous backup", () => {
  const storage = new MemoryStorage();
  storage.values.set(STORAGE_KEY, "{");
  loadStoredTasks(storage);
  loadStoredTasks(storage);
  assert.equal(new Set(storage.writes).size, 2);
  for (const key of storage.writes) assert.equal(storage.values.get(key), "{");
});

test("read failure blocks persistence without writing fallback tasks", () => {
  const storage = new MemoryStorage();
  storage.values.set(STORAGE_KEY, "existing content");
  storage.failRead = true;
  const loaded = loadStoredTasks(storage);
  assert.equal(loaded.canPersist, false);
  assert.ok(loaded.storageError);
  assert.equal(storage.values.get(STORAGE_KEY), "existing content");
  assert.deepEqual(storage.writes, []);
});

test("failed or unverifiable backup blocks persistence and retains the source", () => {
  for (const failure of ["failWrite", "ignoreWrite"] as const) {
    const storage = new MemoryStorage();
    storage.values.set(STORAGE_KEY, "{");
    storage[failure] = true;
    const loaded = loadStoredTasks(storage);
    assert.equal(loaded.canPersist, false);
    assert.ok(loaded.storageError);
    assert.equal(storage.values.get(STORAGE_KEY), "{");
    assert.ok(!storage.writes.includes(STORAGE_KEY));
  }
});
