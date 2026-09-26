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

// ===== 打卡卡片导出 =====

// 设置字间距（Chromium 内核支持 ctx.letterSpacing）
const setLetterSpacing = (ctx: CanvasRenderingContext2D, px: number) => {
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
};

// 圆角矩形路径
const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// 猫爪 "Done" 印章（完成项旁随机出现）
const drawPawStamp = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.18);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  // 肉垫
  ctx.beginPath();
  ctx.ellipse(0, 7, 8, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 三只脚趾
  [[-8, -5, 3.2], [0, -8, 3.5], [8, -5, 3.2]].forEach(([tx, ty, r]) => {
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

// 趴在分割线上睡觉的小猫（纯矢量线条，前爪搭在线上）
const drawSleepingCat = (ctx: CanvasRenderingContext2D, left: number, lineY: number) => {
  const X = (dx: number) => left + dx;
  const Y = (dy: number) => lineY + dy;
  ctx.save();
  ctx.strokeStyle = "#2F2F2F";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 尾巴（左后方向上卷起）
  ctx.beginPath();
  ctx.moveTo(X(40), Y(-12));
  ctx.bezierCurveTo(X(0), Y(-44), X(15), Y(-98), X(58), Y(-86));
  ctx.stroke();

  // 身体 → 头 → 耳朵 → 搭过线的前爪（一笔轮廓）
  ctx.beginPath();
  ctx.moveTo(X(40), Y(-12));
  ctx.bezierCurveTo(X(30), Y(-64), X(75), Y(-97), X(130), Y(-94));
  ctx.bezierCurveTo(X(165), Y(-92), X(185), Y(-84), X(200), Y(-62));
  ctx.lineTo(X(208), Y(-110)); // 左耳
  ctx.bezierCurveTo(X(220), Y(-94), X(230), Y(-90), X(238), Y(-88));
  ctx.lineTo(X(246), Y(-114)); // 右耳
  ctx.bezierCurveTo(X(260), Y(-98), X(270), Y(-92), X(276), Y(-86));
  ctx.bezierCurveTo(X(282), Y(-72), X(284), Y(-57), X(282), Y(-46));
  ctx.bezierCurveTo(X(278), Y(-30), X(265), Y(-22), X(250), Y(-20));
  ctx.lineTo(X(246), Y(10)); // 前爪 1 越过线
  ctx.bezierCurveTo(X(242), Y(16), X(234), Y(16), X(230), Y(10));
  ctx.lineTo(X(226), Y(-10));
  ctx.lineTo(X(216), Y(-10));
  ctx.lineTo(X(212), Y(10)); // 前爪 2
  ctx.bezierCurveTo(X(208), Y(16), X(200), Y(16), X(196), Y(10));
  ctx.lineTo(X(192), Y(-8));
  ctx.bezierCurveTo(X(170), Y(-4), X(90), Y(-4), X(40), Y(-12));
  ctx.stroke();

  // 闭眼
  ctx.beginPath();
  ctx.moveTo(X(234), Y(-56));
  ctx.quadraticCurveTo(X(240), Y(-50), X(248), Y(-56));
  ctx.stroke();

  // 胡须
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(X(256), Y(-44));
  ctx.lineTo(X(295), Y(-48));
  ctx.moveTo(X(256), Y(-38));
  ctx.lineTo(X(293), Y(-33));
  ctx.stroke();

  // zzZ
  ctx.fillStyle = "#B9B9B9";
  ctx.textAlign = "left";
  ctx.font = "600 20px 'Segoe UI', sans-serif";
  ctx.fillText("z", X(300), Y(-88));
  ctx.font = "600 26px 'Segoe UI', sans-serif";
  ctx.fillText("z", X(318), Y(-112));
  ctx.font = "600 32px 'Segoe UI', sans-serif";
  ctx.fillText("Z", X(340), Y(-140));
  ctx.restore();
};

// 导出 3:4 社交打卡卡片
const exportCard = async () => {
  if (!canvasRef.value) return;
  const canvas = canvasRef.value;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // ===== 布局常量（3:4 竖版卡片）=====
  const W = 900;
  const cardX = 48;
  const cardY = 48;
  const cardW = W - 96;
  const radius = 40;
  const padX = 72;
  const lineHeight = 78;
  const tasksStart = cardY + 290;
  const list = tasks.value;

  // 自适应：任务过多时自动增高卡片，避免与猫 / 页脚重叠
  const lastBaseline = tasksStart + Math.max(list.length - 1, 0) * lineHeight;
  const minDividerY = lastBaseline + lineHeight + 130;
  let cardH = 1104; // 默认 3:4（画布 900×1200）
  let dividerY = cardY + cardH - 96;
  if (dividerY < minDividerY) {
    dividerY = minDividerY;
    cardH = dividerY - cardY + 96;
  }

  canvas.width = W;
  canvas.height = cardY + cardH + 48;

  // ===== 1. 柔和外背景 =====
  ctx.fillStyle = "#F4F4F6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ===== 2. 白色圆角卡片主体（悬浮弥散阴影）=====
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.07)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.restore();

  // ===== 3. Header：大日期 + 星期 =====
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 76px 'Segoe UI', 'PingFang SC', sans-serif";
  ctx.fillStyle = "#1F1F1F";
  ctx.fillText(todayShort, cardX + padX, cardY + 115);

  setLetterSpacing(ctx, 5);
  ctx.font = "500 24px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#B0B0B0";
  const weekday = new Date()
    .toLocaleDateString("en-US", { weekday: "long" })
    .toUpperCase();
  ctx.fillText(weekday, cardX + padX, cardY + 158);
  setLetterSpacing(ctx, 0);

  // ===== 4. Header：完成度进度环 =====
  const total = list.length;
  const doneCount = list.filter((t) => t.completed).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const ringR = 56;
  const ringX = cardX + cardW - padX - ringR;
  const ringY = cardY + 122;
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#EFEFEF";
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
  ctx.stroke();
  if (pct > 0) {
    ctx.strokeStyle = "#2A2A2A";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  setLetterSpacing(ctx, 1);
  ctx.font = "600 10px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#B0B0B0";
  ctx.fillText("COMPLETED", ringX, ringY - 12);
  setLetterSpacing(ctx, 0);
  ctx.font = "700 30px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#1F1F1F";
  ctx.fillText(`${pct}%`, ringX, ringY + 26);

  // ===== 5. Header 底部细分割线 =====
  ctx.strokeStyle = "#EFEFEF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + padX, cardY + 215);
  ctx.lineTo(cardX + cardW - padX, cardY + 215);
  ctx.stroke();

  // ===== 6. 任务列表（复选框 + 删除线 + 猫爪印章）=====
  ctx.textAlign = "left";
  const boxSize = 36;
  const textX = cardX + padX + boxSize + 28;
  const textMaxW = cardW - padX * 2 - boxSize - 28 - 90;
  list.forEach((task, i) => {
    const baseline = tasksStart + i * lineHeight;
    const boxX = cardX + padX;
    const boxY = baseline - 10 - boxSize / 2;

    // 复选框
    ctx.strokeStyle = task.completed ? "#C4C4C4" : "#2E2E2E";
    ctx.lineWidth = 2.5;
    roundRectPath(ctx, boxX, boxY, boxSize, boxSize, 10);
    ctx.stroke();
    if (task.completed) {
      ctx.strokeStyle = "#2E2E2E";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(boxX + 9, boxY + 19);
      ctx.lineTo(boxX + 15, boxY + 25);
      ctx.lineTo(boxX + 27, boxY + 11);
      ctx.stroke();
    }

    // 文字
    ctx.font = "500 30px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = task.completed ? "#ABABAB" : "#262626";
    ctx.fillText(task.text, textX, baseline, textMaxW);
    if (task.completed) {
      // 删除线
      const textW = Math.min(ctx.measureText(task.text).width, textMaxW);
      ctx.strokeStyle = "#C0C0C0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(textX, baseline - 9);
      ctx.lineTo(textX + textW, baseline - 9);
      ctx.stroke();
      // 猫爪 Done 印章（随机出现）
      if (Math.random() < 0.45) {
        drawPawStamp(ctx, cardX + cardW - padX - 16, baseline - 14);
      }
    }
  });

  // ===== 7. 底部分割线 + 趴线小猫 =====
  ctx.strokeStyle = "#EDEDED";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + padX, dividerY);
  ctx.lineTo(cardX + cardW - padX, dividerY);
  ctx.stroke();
  drawSleepingCat(ctx, cardX + cardW / 2 - 50, dividerY);

  // ===== 8. Footer：品牌 Logo + 标语 =====
  const footerY = dividerY + 50;
  const penX = cardX + padX;
  const penY = footerY - 18;
  ctx.strokeStyle = "#262626";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(penX + 1, penY + 16);
  ctx.lineTo(penX + 14, penY + 3);
  ctx.moveTo(penX + 9, penY + 1);
  ctx.lineTo(penX + 16, penY + 8);
  ctx.moveTo(penX + 1, penY + 16);
  ctx.lineTo(penX + 5, penY + 12);
  ctx.stroke();

  ctx.textAlign = "left";
  setLetterSpacing(ctx, 3);
  ctx.font = "700 19px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#262626";
  ctx.fillText("DESKNOTE MINI", penX + 26, footerY);
  setLetterSpacing(ctx, 0);

  ctx.textAlign = "right";
  setLetterSpacing(ctx, 2);
  ctx.font = "500 15px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#B8B8B8";
  ctx.fillText("#DailyFocus", cardX + cardW - padX, footerY);
  setLetterSpacing(ctx, 0);

  // ===== 9. 调用 Tauri 文件保存 API =====
  try {
    const dataUrl = canvas.toDataURL("image/png");
    const base64Data = dataUrl.split(",")[1];
    const binaryData = atob(base64Data);
    const uint8Array = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      uint8Array[i] = binaryData.charCodeAt(i);
    }

    const filePath = await save({
      defaultPath: `DeskNote_${todayShort.replace(/\./g, "")}.png`,
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
      width="900"
      height="1200"
      style="display: none;"
    ></canvas>
  </div>
</template>

<style scoped></style>
