<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import {
  getCurrentWindow,
  LogicalSize,
  LogicalPosition,
} from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { setDesktopUnderlay } from "tauri-plugin-desktop-underlay-api";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

const todayFull = new Date()
  .toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  .replace(/\//g, ".");

const todayShort = new Date()
  .toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  })
  .replace(/\//g, ".");

type TodoItem = {
  id: number;
  text: string;
  completed: boolean;
};

const canvasRef = ref<HTMLCanvasElement | null>(null);

// 导出卡片装饰图片（public/ai-photos 目录下的图片，每次导出随机选一张）
const decorPhotos = [
  "/ai-photos/362e4fa9-9b09-4f1d-93c1-9a2718cb244e.png",
  "/ai-photos/c3339e0e-3faf-43c3-8554-30df32085148.png",
  "/ai-photos/ea1fcb18-a697-4aac-bb7e-5addd8145bf2.png",
  "/ai-photos/f40c1acd-957c-488a-b432-6764078b96fc.png",
];

const STORAGE_KEY = "desknote_tasks_v1";

const tasks = ref<TodoItem[]>([]);

const newTaskText = ref("");
const editingId = ref<number | null>(null);
const editingText = ref("");
const showAdd = ref(false);
const addInputRef = ref<HTMLInputElement | null>(null);
const editInputRef = ref<HTMLInputElement | null>(null);

const loadTasks = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loadedTasks = JSON.parse(raw);
      // 确保加载的任务也按正确顺序排列：待完成在前，已完成在后
      const pendingTasks = loadedTasks.filter((t: TodoItem) => !t.completed);
      const completedTasks = loadedTasks.filter((t: TodoItem) => t.completed);
      tasks.value = [...pendingTasks, ...completedTasks];
      return;
    }
  } catch (e) {
    console.warn("读取任务失败，使用默认任务", e);
  }

  // fallback defaults
  tasks.value = [
    { id: 2, text: "点按这里可以触发 Vue 交互", completed: false },
    { id: 3, text: "纯白线条风格优化", completed: false },
    { id: 1, text: "方案三优雅降维完成", completed: true },
    { id: 4, text: "窗口固定在右上角", completed: true },
  ];
};

const saveTasks = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.value));
  } catch (e) {
    console.warn("保存任务失败", e);
  }
};

const toggleTask = (id: number) => {
  const idx = tasks.value.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const task = tasks.value[idx];
  task.completed = !task.completed;
  tasks.value.splice(idx, 1);
  if (task.completed) {
    // 标为已完成，移到已完成区域顶部（即所有已完成任务的前面）
    const firstCompletedIndex = tasks.value.findIndex(t => t.completed);
    if (firstCompletedIndex === -1) {
      // 没有其他已完成任务，直接添加到末尾
      tasks.value.push(task);
    } else {
      // 插入到第一个已完成任务之前
      tasks.value.splice(firstCompletedIndex, 0, task);
    }
  } else {
    // 取消完成，移到待完成区域顶部
    const firstCompletedIndex = tasks.value.findIndex(t => t.completed);
    if (firstCompletedIndex === -1) {
      // 没有已完成任务，添加到开头
      tasks.value.unshift(task);
    } else {
      // 插入到第一个已完成任务之前
      tasks.value.splice(firstCompletedIndex, 0, task);
    }
  }
};

const addTask = () => {
  const text = newTaskText.value.trim();
  if (!text) return;
  const id = Date.now();
  // 新任务添加到待完成区域最顶部（数组开头）
  tasks.value.unshift({ id, text, completed: false });
  newTaskText.value = "";
  showAdd.value = false;
};

const cancelAdd = () => {
  showAdd.value = false;
  newTaskText.value = "";
};

const deleteTask = (id: number) => {
  tasks.value = tasks.value.filter((t) => t.id !== id);
  if (editingId.value === id) {
    editingId.value = null;
    editingText.value = "";
  }
};

const startEdit = (t: TodoItem) => {
  editingId.value = t.id;
  editingText.value = t.text;
  nextTick(() => {
    const input = document.querySelector(
      `input[data-edit-id="${t.id}"]`
    ) as HTMLInputElement | null;
    input?.focus();
  });
};

const cancelEdit = () => {
  editingId.value = null;
  editingText.value = "";
};

const handleOutsideClick = () => {
  // 仅当添加输入框为空时，点击页面其他区域自动取消添加并返回首页
  if (showAdd.value && !newTaskText.value.trim()) {
    addInputRef.value?.blur();
    cancelAdd();
    return;
  }

  // 编辑输入框失焦时，退出编辑模式
  if (editingId.value !== null) {
    cancelEdit();
  }
};

const saveEdit = (id?: number) => {
  const targetId = id ?? editingId.value;
  if (!targetId) return;
  const text = editingText.value.trim();
  if (!text) {
    // 不允许空文本，直接退出编辑
    cancelEdit();
    return;
  }
  const task = tasks.value.find((t) => t.id === targetId);
  if (task) task.text = text;
  cancelEdit();
};

watch(tasks, saveTasks, { deep: true });

// 监听 showAdd 变化，进入添加模式时聚焦输入框
watch(showAdd, (newVal) => {
  if (newVal) {
    nextTick(() => {
      addInputRef.value?.focus();
    });
  }
});

// 监听 editingId 变化，进入编辑模式时聚焦输入框
watch(editingId, (newVal) => {
  if (newVal !== null) {
    nextTick(() => {
      editInputRef.value?.focus();
    });
  }
});

const exportCard = async () => {
  if (!canvasRef.value) return;
  const canvas = canvasRef.value;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 1. 填充纯白背景
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. 绘制今日日期
  ctx.fillStyle = "#000000";
  ctx.font = "32px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(todayFull, canvas.width / 2, 100);

  // 3. 遍历 TodoItem 数组，绘制任务文字和打勾状态
  const startY = 180;
  const lineHeight = 60;
  ctx.font = "24px sans-serif";
  ctx.textAlign = "left";

  tasks.value.forEach((task, index) => {
    const y = startY + index * lineHeight;
    
    // 绘制复选框
    const checkBoxX = 50;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(checkBoxX, y - 20, 30, 30);
    
    if (task.completed) {
      // 绘制打勾
      ctx.beginPath();
      ctx.moveTo(checkBoxX + 5, y - 5);
      ctx.lineTo(checkBoxX + 12, y + 2);
      ctx.lineTo(checkBoxX + 25, y - 15);
      ctx.stroke();
      
      // 绘制删除线文字
      ctx.strokeStyle = "#666666";
      ctx.fillStyle = "#666666";
    } else {
      ctx.strokeStyle = "#000000";
      ctx.fillStyle = "#000000";
    }
    
    // 绘制文字
    ctx.fillText(task.text, 100, y);
    
    if (task.completed) {
      // 添加删除线
      const textWidth = ctx.measureText(task.text).width;
      ctx.beginPath();
      ctx.moveTo(100, y - 5);
      ctx.lineTo(100 + textWidth, y - 5);
      ctx.stroke();
    }
  });

  // 4. 绘制随机装饰图片（从 ai-photos 中随机选一张）
  const randomPhoto = decorPhotos[Math.floor(Math.random() * decorPhotos.length)];
  const decorImg = new Image();
  decorImg.src = randomPhoto;

  await new Promise((resolve) => {
    decorImg.onload = resolve;
  });

  const decorWidth = 200;
  const decorHeight = 200;
  const decorX = (canvas.width - decorWidth) / 2;
  const decorY = canvas.height - decorHeight - 100;
  ctx.drawImage(decorImg, decorX, decorY, decorWidth, decorHeight);

  // 5. 调用 Tauri 文件保存 API
  try {
    const dataUrl = canvas.toDataURL("image/png");
    const base64Data = dataUrl.split(",")[1];
    const binaryData = atob(base64Data);
    const uint8Array = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      uint8Array[i] = binaryData.charCodeAt(i);
    }

    const filePath = await save({
      defaultPath: `DeskNote_${todayFull.replace(/\./g, "")}.png`,
      filters: [{
        name: "PNG Image",
        extensions: ["png"]
      }]
    });

    if (filePath) {
      await writeFile(filePath, uint8Array);
      alert("导出成功！");
    }
  } catch (error) {
    console.error("导出失败:", error);
    alert("导出失败，请重试");
  }
};

async function initDesktopWidget() {
  if (!isTauri()) {
    console.log("不是在 Tauri 环境运行，跳过窗口初始化");
    return;
  }
  
  try {
    const win = getCurrentWindow();

    const windowWidth = 390;
    const windowHeight = 490;
    const marginRight = -94; // 右边距，负值表示窗口部分超出屏幕
    const marginTop = 0;
    
    await win.setSize(new LogicalSize(windowWidth, windowHeight));

    const x = window.screen.width - windowWidth - marginRight;
    const y = marginTop;

    await win.setPosition(new LogicalPosition(x, y));
    await win.show();

    try {
      await setDesktopUnderlay(true);
    } catch (e) {
      console.warn("桌面底层插件调用失败:", e);
    }

    console.log(`DeskNote Mini 桌面底层模式初始化完成。窗口位置: (${x}, ${y})`);
  } catch (error) {
    console.error("初始化挂件失败:", error);
  }
}

onMounted(() => {
  initDesktopWidget();
  loadTasks();
});
</script>

<template>
  <div
    class="w-[360px] h-[450px] p-5 bg-white text-black flex flex-col justify-between box-border select-none rounded-2xl shadow-2xl border border-white/50"
    @click="handleOutsideClick()"
  >
    <div
      class="border-b border-black/30 pb-3 text-sm tracking-[0.3em] font-mono flex items-center justify-between gap-2" @click.stop>
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <div class="flex-shrink-0">{{ todayShort }}</div>
        <div 
          class="text-xs text-black/40 tracking-[2.6px] cursor-pointer hover:text-black/60 truncate" 
          v-show="!showAdd"
          @click.stop="showAdd = true"
        >
          建议只设置最紧急的5项
        </div>
      </div>

      <div class="flex items-center gap-1 flex-shrink-0" style="margin-right: 2px;">
        <template v-if="showAdd">
          <input
            ref="addInputRef"
            class="text-sm bg-transparent outline-none border-b border-black/10 px-2 py-1 flex-1 min-w-0 w-36 h-6"
            placeholder="输入并回车"
            v-model="newTaskText"
            @keyup.enter="addTask()"
            @keyup.esc="cancelAdd"
          />
          <button class="text-sm px-2 py-1 flex-shrink-0" @click="addTask()">✓</button>
          <button class="text-sm px-0 py-1 flex-shrink-0" @click="cancelAdd">×</button>
        </template>
        <template v-else>
          <button class="text-lg px-0.5 py-1 flex-shrink-0 hover:bg-black/10 rounded" style="font-size: 14px;" @click="showAdd = true" title="添加（建议只设置5件）">＋</button>
          <button class="px[-0.5] py-1 flex-shrink-0 hover:bg-black/10 rounded flex items-center gap-1" style="font-size: 14px;" @click="exportCard()" title="导出卡片">
            📥
          </button>
        </template>
      </div>
    </div>

    <div class="flex-1 my-3 flex flex-col gap-4">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="flex items-center gap-3 text-sm transition-colors"
        @click.stop
      >
        <div
          class="w-5 h-5 border border-black/60 flex items-center justify-center text-[10px] flex-shrink-0 cursor-pointer"
          @click.stop="toggleTask(task.id)"
        >
          <span v-if="task.completed">✓</span>
        </div>

        <div class="flex-1" @click.stop>
          <template v-if="editingId === task.id">
            <input
              ref="editInputRef"
              :data-edit-id="task.id"
              class="w-full text-sm bg-transparent outline-none"
              v-model="editingText"
              @keyup.enter="saveEdit(task.id)"
              @keyup.esc="cancelEdit()"
              @blur="cancelEdit()"
            />
          </template>
          <template v-else>
            <span
              :class="{ 'line-through opacity-50': task.completed }"
              class="cursor-text"
              @dblclick="startEdit(task)"
            >
              {{ task.text }}
            </span>
          </template>
        </div>

        <div class="flex items-center gap-2" @click.stop>
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

      <!-- 原底部添加输入已移至日期右侧 -->
    </div>

    <div
      class="border-t border-black/20 pt-3 text-center text-xs tracking-[0.2em] text-black/50"
      @click.stop
    >
      DESKNOTE MINI 
    </div>
    
    <canvas
      ref="canvasRef"
      width="750"
      height="1334"
      style="display: none;"
    ></canvas>
  </div>
</template>

<style scoped></style>
