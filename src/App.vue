<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted, watch, nextTick } from "vue";

import { useTasks } from "./composables/useTasks";
import { useToday } from "./composables/useToday";
import { createTaskId, toggleTaskStatus, type TodoItem } from "./lib/tasks";

import { initDesktopWidget } from "./lib/desktop";

const todayShort = useToday();
const { tasks, storageError } = useTasks();
const newTaskText = ref("");
const editingId = ref<number | null>(null);
const editingText = ref("");
const showAdd = ref(false);
const addInputRef = ref<HTMLInputElement | null>(null);
const cardRef = ref<HTMLElement | null>(null);
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

watch(showAdd, async (visible) => {
  if (visible) {
    cancelEdit();
    await nextTick();
    addInputRef.value?.focus();
  }
});

onMounted(() => {
  initDesktopWidget().catch((error) => console.error("初始化挂件失败", error));
});
</script>

<template>
  <ExportPanel v-if="showExport" :tasks="exportTasks" @close="closeExport" />
  <div
    v-else
    ref="cardRef"
    class="task-card bg-white text-black flex flex-col box-border select-none rounded-2xl shadow-2xl border border-white/50"
    @click="handleOutsideClick()"
  >
    <div
      class="task-header border-b border-black/30 pb-3 text-sm tracking-[0.3em] font-mono flex items-center gap-2 shrink-0" @click.stop>
        <div class="shrink-0">{{ todayShort }}</div>
        <div 
          class="flex-1 min-w-0 text-xs text-black/40 tracking-[2.6px] cursor-pointer hover:text-black/60 truncate"
          v-show="!showAdd"
          @click.stop="showAdd = true"
        >
          建议只设置最紧急的5项
        </div>
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
          <button class="text-lg px-0.5 py-1 flex-shrink-0 hover:bg-black/10 rounded" style="font-size: 14px;" @click="showAdd = true" title="添加（建议只设置5件）">＋</button>
          <button class="px-0.5 py-1 flex-shrink-0 hover:bg-black/10 rounded flex items-center gap-1 disabled:opacity-40" style="font-size: 14px;" ref="exportButtonRef" @click="openExport" title="导出卡片">
            📥
          </button>
        </template>
      </div>
    </div>

    <p v-if="storageError" role="alert" class="shrink-0 max-h-12 overflow-y-auto text-xs text-red-700 mt-2">{{ storageError }}</p>
    <div class="flex-1 min-h-0 overflow-y-auto my-3 flex flex-col gap-4" aria-label="任务列表">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="flex items-center gap-3 text-sm transition-colors shrink-0"
        @click.stop
        @focusout="handleEditRowFocusOut($event, task.id)"
        @keydown="handleEditRowKey($event, task.id)"
      >
        <button
          class="w-5 h-5 border border-black/60 flex items-center justify-center text-[10px] flex-shrink-0 cursor-pointer"
          role="checkbox"
          :aria-checked="task.completed"
          :aria-label="task.text"
          @click.stop="toggleTask(task.id)"
        >
          <span v-if="task.completed">✓</span>
        </button>

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
      class="border-t border-black/20 pt-3 text-center text-xs tracking-[0.2em] text-black/50 shrink-0"
      @click.stop
    >
      DESKNOTE MINI 
    </div>
    
  </div>
</template>

<style scoped>
.task-card { width: min(360px, 100vw); height: min(450px, 100dvh); padding: clamp(12px, 5.5vw, 20px); overflow: hidden; }
.task-actions { margin-right: 2px; }
@media (max-height: 380px) {
  .task-card { padding-top: 12px; padding-bottom: 12px; }
  .task-header { padding-bottom: 8px; }
}
</style>
