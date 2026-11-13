<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref, watch, nextTick } from "vue";

import { useTasks } from "./composables/useTasks";
import { useToday } from "./composables/useToday";
import { useWidgetPlacement } from "./composables/useWidgetPlacement";
import {
  createTaskId, moveTask, moveTaskBy, nextTag, sortTasksByTag, toggleTaskStatus,
  type TaskTag, type TodoItem,
} from "./lib/tasks";

const todayShort = useToday();
const { tasks, storageError } = useTasks();
const newTaskText = ref("");
const editingId = ref<number | null>(null);
const editingText = ref("");
const showAdd = ref(false);
const addInputRef = ref<HTMLInputElement | null>(null);
const cardRef = ref<HTMLElement | null>(null);
const shellRef = ref<HTMLElement | null>(null);
const { pinned, dragging, style: placementStyle, placementError, startDragging, togglePinned } = useWidgetPlacement(shellRef);
const ExportPanel = defineAsyncComponent(() => import("./components/ExportPanel.vue"));
const showExport = ref(false);
const exportTasks = ref<TodoItem[]>([]);
const exportButtonRef = ref<HTMLButtonElement | null>(null);
const openExport = () => {
  cancelAdd();
  cancelEdit();
  exportTasks.value = tasks.value.map((task) => ({ ...task }));
  showExport.value = true;
};
const closeExport = async () => {
  showExport.value = false;
  await nextTick();
  exportButtonRef.value?.focus();
};

const toggleTask = (id: number) => {
  tasks.value = toggleTaskStatus(tasks.value, id);
};
const addTask = () => {
  const text = newTaskText.value.trim();
  if (!text) return;
  tasks.value.unshift({ id: createTaskId(tasks.value), text, completed: false });
  cancelAdd();
};
const cancelAdd = () => {
  showAdd.value = false;
  newTaskText.value = "";
};
const cancelEdit = () => {
  editingId.value = null;
  editingText.value = "";
};
const handleEditRowFocusOut = async (event: FocusEvent, id: number) => {
  if (editingId.value !== id) return;
  const row = event.currentTarget as HTMLElement;
  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && row.contains(nextTarget)) return;
  // Switching the edit button to Save briefly removes the focused button.
  // Allow startEdit to focus its input before deciding that focus left the row.
  await nextTick();
  if (editingId.value === id && !row.contains(document.activeElement)) cancelEdit();
};
const handleEditRowKey = (event: KeyboardEvent, id: number) => {
  if (editingId.value !== id || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelEdit();
  }
};
const deleteTask = (id: number) => {
  tasks.value = tasks.value.filter((task) => task.id !== id);
  if (editingId.value === id) cancelEdit();
};
const startEdit = async (task: TodoItem) => {
  editingId.value = task.id;
  editingText.value = task.text;
  await nextTick();
  cardRef.value?.querySelector<HTMLInputElement>(`input[data-edit-id="${task.id}"]`)?.focus();
};
const saveEdit = (id: number | null = editingId.value) => {
  if (id === null) return;
  const text = editingText.value.trim();
  const task = tasks.value.find((task) => task.id === id);
  if (task && text) task.text = text;
  cancelEdit();
};
const handleOutsideClick = () => {
  if (showAdd.value && !newTaskText.value.trim()) cancelAdd();
  cancelEdit();
};
const handleInputKey = (event: KeyboardEvent, submit: () => void, cancel: () => void) => {
  // 输入法确认候选词时不提交或取消表单。
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    submit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  }
};

// 复杂版：手动排序与颜色标签。切回简洁版只隐藏控件，顺序和标签都保留。
const MODE_KEY = "desknote_mode_v1";
const readComplexMode = () => {
  try {
    return window.localStorage.getItem(MODE_KEY) === "complex";
  } catch {
    return false;
  }
};
const complex = ref(readComplexMode());
watch(complex, (enabled) => {
  cancelReorder();
  try {
    window.localStorage.setItem(MODE_KEY, enabled ? "complex" : "simple");
  } catch {
    // 模式只是界面偏好，保存失败时本次仍可正常使用。
  }
});

const TAG_NAMES: Record<TaskTag, string> = { red: "红色", orange: "橙色", blue: "蓝色" };
const tagName = (tag: TaskTag | undefined) => (tag ? TAG_NAMES[tag] : "无");
const cycleTag = (task: TodoItem) => {
  const tag = nextTag(task.tag);
  if (tag) task.tag = tag;
  else delete task.tag;
};
const sortByTag = () => {
  cancelEdit();
  tasks.value = sortTasksByTag(tasks.value);
};

const reorderingId = ref<number | null>(null);
// 窗口不抢焦点且 Tauri 会接管原生拖放，所以用指针事件实现拖动排序。
const handleReorderMove = (event: PointerEvent) => {
  const id = reorderingId.value;
  if (id === null) return;
  const from = tasks.value.findIndex((task) => task.id === id);
  const rows = cardRef.value?.querySelectorAll<HTMLElement>("[data-task-id]") ?? [];
  for (const row of rows) {
    const targetId = Number(row.dataset.taskId);
    if (targetId === id) continue;
    const rect = row.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientY > rect.bottom) continue;
    // 越过目标行中线才换位，行高不同也不会来回抖动。
    const middle = rect.top + rect.height / 2;
    const to = tasks.value.findIndex((task) => task.id === targetId);
    if (to > from ? event.clientY > middle : event.clientY < middle) {
      tasks.value = moveTask(tasks.value, id, targetId);
    }
    return;
  }
};
const cancelReorder = () => {
  reorderingId.value = null;
  window.removeEventListener("pointermove", handleReorderMove);
  window.removeEventListener("pointerup", cancelReorder);
  window.removeEventListener("pointercancel", cancelReorder);
};
const startReorder = (event: PointerEvent, id: number) => {
  if (event.button !== 0) return;
  event.preventDefault();
  cancelEdit();
  reorderingId.value = id;
  window.addEventListener("pointermove", handleReorderMove);
  window.addEventListener("pointerup", cancelReorder);
  window.addEventListener("pointercancel", cancelReorder);
};
const handleGripKey = async (event: KeyboardEvent, id: number) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  tasks.value = moveTaskBy(tasks.value, id, event.key === "ArrowUp" ? -1 : 1);
  // 移动 DOM 节点会让按钮失焦，重新聚焦以便连续按键。
  await nextTick();
  cardRef.value?.querySelector<HTMLElement>(`[data-task-id="${id}"] .grip`)?.focus();
};
onBeforeUnmount(cancelReorder);

watch(showAdd, async (visible) => {
  if (visible) {
    cancelEdit();
    await nextTick();
    addInputRef.value?.focus();
  }
});

</script>

<template>
  <div ref="shellRef" class="widget-shell" :style="placementStyle">
  <ExportPanel v-if="showExport" :tasks="exportTasks" @close="closeExport" />
  <div
    v-else
    ref="cardRef"
    class="task-card bg-white text-black flex flex-col box-border select-none rounded-2xl shadow-2xl border border-white/50"
    @click="handleOutsideClick()"
  >
    <div
      class="task-header border-b border-black/30 pb-3 text-sm tracking-[0.3em] font-mono flex items-center gap-2 shrink-0" @click.stop>
      <div class="drag-handle shrink-0" :class="{ 'is-pinned': pinned, 'is-dragging': dragging }"
        data-testid="widget-drag-handle" :title="pinned ? '已钉住，点击图钉后可移动' : '拖动便签'" @pointerdown="startDragging">
        {{ todayShort }}
      </div>
      <button v-if="!showAdd" type="button"
        class="flex-1 min-w-0 text-left text-xs text-black/40 tracking-[2.6px] truncate cursor-pointer hover:text-black/60"
        @click="showAdd = true">建议只设置最紧急的5项</button>
      <div class="task-actions flex items-center gap-1" :class="showAdd ? 'flex-1 min-w-0' : 'shrink-0'">
        <template v-if="showAdd">
          <input
            ref="addInputRef"
            class="text-sm bg-transparent outline-none border-b border-black/10 px-2 py-1 flex-1 min-w-0 w-0 h-6 tracking-normal"
            placeholder="输入并回车"
            v-model="newTaskText"
            aria-label="新任务"
            @keydown="handleInputKey($event, addTask, cancelAdd)"
          />
          <button class="text-sm px-2 py-1 flex-shrink-0" aria-label="确认添加" @click="addTask()">✓</button>
          <button class="text-sm px-0 py-1 flex-shrink-0" aria-label="取消添加" @click="cancelAdd">×</button>
        </template>
        <template v-else>
          <button class="pin-button" :class="{ pinned }" :aria-pressed="pinned"
            :aria-label="pinned ? '取消钉住' : '钉住位置'" :title="pinned ? '取消钉住' : '钉住位置'" @click="togglePinned">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 3h6M10 3v7l-4 4v2h12v-2l-4-4V3M12 16v5" />
            </svg>
          </button>
          <button class="text-lg px-0.5 py-1 flex-shrink-0 hover:bg-black/10 rounded" style="font-size: 14px;" @click="showAdd = true" title="添加（建议只设置5件）">＋</button>
          <button class="px-0.5 py-1 flex-shrink-0 hover:bg-black/10 rounded flex items-center gap-1 disabled:opacity-40" style="font-size: 14px;" ref="exportButtonRef" @click="openExport" title="导出卡片">
            📥
          </button>
        </template>
      </div>
    </div>

    <p v-if="storageError || placementError" role="alert" class="shrink-0 max-h-12 overflow-y-auto text-xs text-red-700 mt-2">{{ storageError || placementError }}</p>
    <div class="flex-1 min-h-0 overflow-y-auto my-3 flex flex-col gap-4" aria-label="任务列表">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="task-row flex items-center text-sm transition-colors shrink-0"
        :class="[complex ? 'gap-2' : 'gap-3', { 'is-reordering': reorderingId === task.id }]"
        :data-task-id="task.id"
        @click.stop
        @focusout="handleEditRowFocusOut($event, task.id)"
        @keydown="handleEditRowKey($event, task.id)"
      >
        <button
          v-if="complex"
          class="grip"
          :aria-label="`拖动排序：${task.text}`"
          title="拖动排序（聚焦后可用 ↑ ↓ 键）"
          @pointerdown="startReorder($event, task.id)"
          @keydown="handleGripKey($event, task.id)"
        >
          <svg viewBox="0 0 8 14" width="8" height="14" fill="currentColor" aria-hidden="true">
            <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
          </svg>
        </button>
        <button
          class="w-5 h-5 border border-black/60 flex items-center justify-center text-[10px] flex-shrink-0 cursor-pointer"
          role="checkbox"
          :aria-checked="task.completed"
          :aria-label="task.text"
          @click.stop="toggleTask(task.id)"
        >
          <span v-if="task.completed">✓</span>
        </button>

        <button
          v-if="complex"
          class="tag-dot"
          :class="[task.tag ? `tag-${task.tag}` : 'tag-none', { 'opacity-50': task.completed }]"
          :aria-label="`标签：${tagName(task.tag)}，点击切换`"
          :title="`标签：${tagName(task.tag)}（点击切换 红 → 橙 → 蓝 → 无）`"
          @click.stop="cycleTag(task)"
        ></button>

        <div class="flex-1 min-w-0" @click.stop>
          <template v-if="editingId === task.id">
            <input
              :data-edit-id="task.id"
              class="w-full text-sm bg-transparent outline-none"
              v-model="editingText"
              aria-label="编辑任务"
              @keydown="handleInputKey($event, () => saveEdit(task.id), cancelEdit)"
            />
          </template>
          <template v-else>
            <span
              :class="{ 'line-through opacity-50': task.completed }"
              class="cursor-text [overflow-wrap:anywhere]"
              @dblclick="startEdit(task)"
            >
              {{ task.text }}
            </span>
          </template>
        </div>

        <div class="flex items-center gap-2 shrink-0" @click.stop>
          <button
            v-if="editingId === task.id"
            class="text-sm text-black px-1 leading-none"
            @mousedown.prevent
            @click="saveEdit(task.id)"
            title="保存"
            aria-label="保存"
          >
            ✔
          </button>
          <button
            v-else
            class="text-sm text-black/50 hover:text-black px-1 leading-none"
            @click="startEdit(task)"
            title="编辑"
            aria-label="编辑"
          >
            ✎
          </button>
          <button
            class="text-sm text-black px-1 leading-none"
            @click="deleteTask(task.id)"
            title="删除"
            aria-label="删除"
          >
            ×
          </button>
        </div>
      </div>

      <p v-if="tasks.length === 0" class="text-sm text-black/40 text-center py-8">点击 ＋，记下今天最重要的事</p>
    </div>

    <div
      class="task-footer border-t border-black/20 pt-3 text-xs text-black/50 shrink-0"
      @click.stop
    >
      <div class="justify-self-start">
        <button v-if="complex" class="footer-button" title="按标签整理：红 → 橙 → 蓝 → 无标签" @click="sortByTag">按标签排序</button>
      </div>
      <span class="tracking-[0.2em] whitespace-nowrap">DESKNOTE MINI</span>
      <button
        class="footer-button justify-self-end"
        :class="{ active: complex }"
        :aria-pressed="complex"
        :title="complex ? '切换回简洁版' : '切换到复杂版：可排序、贴标签'"
        @click="complex = !complex"
      >复杂版</button>
    </div>
    
  </div>
  </div>
</template>

<style scoped>
.widget-shell { width: min(360px, 100vw); height: min(450px, 100dvh); }
.task-card { width: min(360px, 100vw); height: min(450px, 100dvh); padding: clamp(12px, 5.5vw, 20px); overflow: hidden; }
.task-actions { margin-right: 2px; }
.drag-handle { cursor: grab; touch-action: none; }
.drag-handle.is-dragging { cursor: grabbing; }
.drag-handle.is-pinned { cursor: default; }
.pin-button { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 24px; height: 26px; border-radius: 4px; color: #888; cursor: pointer; }
.pin-button svg { transform: rotate(35deg); }
.pin-button:hover { background: #0000000d; color: #333; }
.pin-button.pinned { background: #0000000d; color: #222; }
.pin-button.pinned svg { transform: none; }
.task-footer { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 4px; }
.footer-button { padding: 1px 6px; border-radius: 4px; font-size: 11px; white-space: nowrap; cursor: pointer; }
.footer-button:hover { background: #0000000d; color: #333; }
.footer-button.active { background: #00000014; color: #222; }
.grip { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 12px; height: 20px; margin-left: -4px; color: #0000004d; cursor: grab; touch-action: none; }
.grip:hover { color: #000000b3; }
.task-row.is-reordering { background: #0000000d; border-radius: 4px; }
.task-row.is-reordering .grip { color: #000000b3; cursor: grabbing; }
.tag-dot { flex-shrink: 0; width: 12px; height: 12px; border-radius: 50%; cursor: pointer; }
.tag-none { border: 1px dashed #00000059; }
.tag-red { background: #dc2626; }
.tag-orange { background: #f97316; }
.tag-blue { background: #2563eb; }
.grip:focus-visible, .tag-dot:focus-visible, .footer-button:focus-visible { outline: 2px solid #96836a; outline-offset: 1px; }
.pin-button:focus-visible { outline: 2px solid #96836a; outline-offset: 1px; }
@media (max-height: 380px) {
  .task-card { padding-top: 12px; padding-bottom: 12px; }
  .task-header { padding-bottom: 8px; }
}
</style>
