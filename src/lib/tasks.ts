/** Priority order: red first, then orange, then blue. */
export const TASK_TAGS = ["red", "orange", "blue"] as const;
export type TaskTag = (typeof TASK_TAGS)[number];

export type TodoItem = {
  id: number;
  text: string;
  completed: boolean;
  /** Only set in the complex view; absent means untagged. */
  tag?: TaskTag;
};

const isTaskTag = (value: unknown): value is TaskTag =>
  TASK_TAGS.includes(value as TaskTag);

export const STORAGE_KEY = "desknote_tasks_v1";

export type TaskStorage = Pick<Storage, "getItem" | "setItem">;

export type ParsedTasks = {
  tasks: TodoItem[];
  hasInvalidData: boolean;
};

export type LoadedTasks = {
  tasks: TodoItem[];
  storageError: string | null;
  canPersist: boolean;
};

export const createDefaultTasks = (): TodoItem[] => [
  { id: 2, text: "点按这里可以触发 Vue 交互", completed: false },
  { id: 3, text: "纯白线条风格优化", completed: false },
  { id: 1, text: "方案三优雅降维完成", completed: true },
  { id: 4, text: "窗口固定在右上角", completed: true },
];

/** Preserve the order within each group without changing the caller's array. */
export function sortTasks(tasks: readonly TodoItem[]): TodoItem[] {
  const pending: TodoItem[] = [];
  const completed: TodoItem[] = [];
  for (const task of tasks) {
    (task.completed ? completed : pending).push(task);
  }
  return [...pending, ...completed];
}

function nextAvailableId(usedIds: ReadonlySet<number>, now: number): number {
  let id = Number.isSafeInteger(now) && now > 0 ? now : 1;
  while (usedIds.has(id)) {
    id = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
  }
  return id;
}

/** Date-based IDs remain compatible with existing numeric task IDs. */
export function createTaskId(tasks: readonly TodoItem[], now = Date.now()): number {
  return nextAvailableId(new Set(tasks.map((task) => task.id)), now);
}

/** Take the target's slot. Tasks never cross the pending/completed boundary. */
export function moveTask(tasks: readonly TodoItem[], id: number, targetId: number): TodoItem[] {
  const from = tasks.findIndex((task) => task.id === id);
  const to = tasks.findIndex((task) => task.id === targetId);
  const result = [...tasks];
  if (from === -1 || to === -1 || from === to) return result;
  if (tasks[from].completed !== tasks[to].completed) return result;
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
}

/** Move one step up (-1) or down (+1) within the task's own group. */
export function moveTaskBy(tasks: readonly TodoItem[], id: number, delta: -1 | 1): TodoItem[] {
  const target = tasks[tasks.findIndex((task) => task.id === id) + delta];
  return target ? moveTask(tasks, id, target.id) : [...tasks];
}

/** Next tag in the cycle: none → red → orange → blue → none. */
export function nextTag(tag: TaskTag | undefined): TaskTag | undefined {
  return tag === undefined ? TASK_TAGS[0] : TASK_TAGS[TASK_TAGS.indexOf(tag) + 1];
}

/** Red, orange, blue, then untagged; stable, and pending stays before completed. */
export function sortTasksByTag(tasks: readonly TodoItem[]): TodoItem[] {
  const rank = (task: TodoItem) => (task.tag ? TASK_TAGS.indexOf(task.tag) : TASK_TAGS.length);
  return sortTasks(tasks)
    .map((task, index) => ({ task, index }))
    .sort((a, b) =>
      Number(a.task.completed) - Number(b.task.completed) || rank(a.task) - rank(b.task) || a.index - b.index)
    .map(({ task }) => task);
}

/** Newly completed tasks lead the completed group; reopened tasks lead pending. */
export function toggleTaskStatus(tasks: readonly TodoItem[], id: number): TodoItem[] {
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return [...tasks];

  const updated = { ...tasks[index], completed: !tasks[index].completed };
  const remaining = sortTasks(tasks.filter((_, taskIndex) => taskIndex !== index));
  if (!updated.completed) return [updated, ...remaining];

  const firstCompleted = remaining.findIndex((task) => task.completed);
  remaining.splice(firstCompleted === -1 ? remaining.length : firstCompleted, 0, updated);
  return remaining;
}

function isTodoItem(value: unknown): value is TodoItem {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === "number" &&
    Number.isSafeInteger(task.id) &&
    task.id >= 0 &&
    typeof task.text === "string" &&
    task.text.trim().length > 0 &&
    typeof task.completed === "boolean"
  );
}

/** Retain usable records and repair duplicate IDs; callers must back up bad input. */
export function parseStoredTasks(raw: string): ParsedTasks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tasks: createDefaultTasks(), hasInvalidData: true };
  }
  if (!Array.isArray(parsed)) {
    return { tasks: createDefaultTasks(), hasInvalidData: true };
  }

  const validTasks = parsed.filter(isTodoItem);
  let hasInvalidData = validTasks.length !== parsed.length;
  const reservedIds = new Set(validTasks.map((task) => task.id));
  const seenIds = new Set<number>();
  const tasks = validTasks.map((task) => {
    let id = task.id;
    if (seenIds.has(id)) {
      hasInvalidData = true;
      id = nextAvailableId(reservedIds, Date.now());
      reservedIds.add(id);
    }
    seenIds.add(id);
    const repaired: TodoItem = { id, text: task.text, completed: task.completed };
    if (isTaskTag(task.tag)) repaired.tag = task.tag;
    // An unknown tag is dropped, but the original record is still backed up.
    else if (task.tag !== undefined) hasInvalidData = true;
    return repaired;
  });
  return { tasks: sortTasks(tasks), hasInvalidData };
}

/** Never modify the source record during initialization, even after recovery. */
export function loadStoredTasks(storage: TaskStorage): LoadedTasks {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return {
      tasks: createDefaultTasks(),
      storageError: "无法读取本地任务，已暂停保存以保护原数据。请恢复存储权限后重启应用。",
      canPersist: false,
    };
  }
  if (raw === null) {
    return { tasks: createDefaultTasks(), storageError: null, canPersist: true };
  }

  const parsed = parseStoredTasks(raw);
  if (!parsed.hasInvalidData) {
    return { tasks: parsed.tasks, storageError: null, canPersist: true };
  }

  try {
    const prefix = `${STORAGE_KEY}_corrupt_${Date.now()}`;
    let backupKey = prefix;
    let suffix = 1;
    while (storage.getItem(backupKey) !== null) {
      backupKey = `${prefix}_${suffix++}`;
    }
    storage.setItem(backupKey, raw);
    if (storage.getItem(backupKey) !== raw) throw new Error("Backup verification failed");
    return {
      tasks: parsed.tasks,
      storageError: "检测到异常任务数据，已保留原始备份并恢复可用内容。",
      canPersist: true,
    };
  } catch {
    return {
      tasks: parsed.tasks,
      storageError: "任务数据异常且备份失败，已暂停保存以保护原数据。请检查存储空间后重启应用。",
      canPersist: false,
    };
  }
}
