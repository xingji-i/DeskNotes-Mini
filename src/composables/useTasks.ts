import { ref, watch } from "vue";
import {
  createDefaultTasks,
  loadStoredTasks,
  STORAGE_KEY,
  type LoadedTasks,
  type TaskStorage,
  type TodoItem,
} from "../lib/tasks";

export function useTasks() {
  let storage: TaskStorage | undefined;
  let loaded: LoadedTasks;
  try {
    storage = window.localStorage;
    loaded = loadStoredTasks(storage);
  } catch {
    loaded = {
      tasks: createDefaultTasks(),
      storageError: "无法访问本地存储，本次修改不能保存。请恢复存储权限后重启应用。",
      canPersist: false,
    };
  }

  // Read before watching so defaults or recovered data cannot overwrite the source.
  const tasks = ref<TodoItem[]>(loaded.tasks);
  const storageError = ref<string | null>(loaded.storageError);
  watch(tasks, (value) => {
    if (!loaded.canPersist || !storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(value));
      storageError.value = null;
    } catch {
      storageError.value = "保存任务失败，本次修改尚未保存。请检查存储空间或权限。";
    }
  }, { deep: true });

  return { tasks, storageError };
}
