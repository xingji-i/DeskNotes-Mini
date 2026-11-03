import type { TodoItem } from "./tasks";
import { formatShortDate } from "./date";
import { wrapText } from "./textLayout";
import { loadSketchImage, type SketchTheme } from "./sketches";

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

// 猫爪印章
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

export async function renderCard(
  list: readonly TodoItem[],
  date: Date,
  options: { theme?: SketchTheme } = {},
): Promise<Blob> {
  const illustration = await loadSketchImage(options.theme ?? "cat");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建图片画布");

  // ===== 布局常量（3:4 竖版卡片）=====
  const W = 900;
  const cardX = 48;
  const cardY = 48;
  const cardW = W - 96;
  const radius = 40;
  const padX = 72;
  const lineHeight = 78;
  const textLineHeight = 42;
  const tasksStart = cardY + 290;
  const boxSize = 36;
  const textX = cardX + padX + boxSize + 28;
  const textMaxW = cardW - padX * 2 - boxSize - 28 - 90;
  const taskFont = "500 30px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.font = taskFont;
  let nextBaseline = tasksStart;
  const rows = list.map((task) => {
    const lines = wrapText(task.text, textMaxW, (text) => ctx.measureText(text).width);
    const baseline = nextBaseline;
    nextBaseline += lineHeight + (lines.length - 1) * textLineHeight;
    return { task, lines, baseline };
  });

  // 自适应：任务过多时自动增高卡片，为插画与页脚保留完整空间
  const lastBaseline = Math.max(tasksStart, nextBaseline - lineHeight);
  const illustrationHeight = 220;
  const minDividerY = lastBaseline + 64 + illustrationHeight;
  let cardH = 1104; // 默认 3:4（画布 900×1200）
  let dividerY = cardY + cardH - 96;
  if (dividerY < minDividerY) {
    dividerY = minDividerY;
    cardH = dividerY - cardY + 96;
  }

  if (cardY + cardH + 48 > 16384) {
    throw new Error("任务内容过多，请减少任务后再导出");
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
  ctx.fillText(formatShortDate(date), cardX + padX, cardY + 115);

  setLetterSpacing(ctx, 5);
  ctx.font = "500 24px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#B0B0B0";
  const weekday = date
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
  rows.forEach(({ task, lines, baseline }) => {
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
    ctx.font = taskFont;
    ctx.fillStyle = task.completed ? "#ABABAB" : "#262626";
    lines.forEach((line, index) => {
      const lineBaseline = baseline + index * textLineHeight;
      ctx.fillText(line, textX, lineBaseline);
      if (!task.completed) return;
      // 删除线
      const textW = ctx.measureText(line).width;
      ctx.strokeStyle = "#C0C0C0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(textX, lineBaseline - 9);
      ctx.lineTo(textX + textW, lineBaseline - 9);
      ctx.stroke();
    });
    if (task.completed) {
      // 根据任务 ID 固定印章位置，保证预览和重复导出一致。
      if ((Math.imul(task.id % 2147483647, 31) >>> 0) % 100 < 45) {
        drawPawStamp(ctx, cardX + cardW - padX - 16, baseline - 14);
      }
    }
  });

  // ===== 7. 底部分割线 + 统一风格的素描场景 =====
  ctx.strokeStyle = "#EDEDED";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + padX, dividerY);
  ctx.lineTo(cardX + cardW - padX, dividerY);
  ctx.stroke();
  ctx.drawImage(illustration, cardX + padX, dividerY - 198, 660, illustrationHeight);

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

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // 释放高分辨率画布的像素缓冲区。
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob);
      else reject(new Error("图片编码失败，任务可能过多"));
    }, "image/png");
  });
}
