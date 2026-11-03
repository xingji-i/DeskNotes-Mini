<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { renderCard } from "../lib/exportCard";
import { formatFileDate } from "../lib/date";
import { SKETCH_THEMES } from "../lib/sketches";
import type { TodoItem } from "../lib/tasks";

const props = defineProps<{ tasks: TodoItem[] }>();
const emit = defineEmits<{ close: [] }>();
const panelRef = ref<HTMLElement | null>(null);
const backRef = ref<HTMLButtonElement | null>(null);
const date = new Date();
// Pick once per export so retries and saves always match the visible card.
const selectedTheme = SKETCH_THEMES[Math.floor(Math.random() * SKETCH_THEMES.length)].id;
const previewUrl = ref("");
const previewBlob = ref<Blob | null>(null);
const isRendering = ref(false);
const isSaving = ref(false);
const status = ref("");
const error = ref("");
let disposed = false;

const renderPreview = async () => {
  isRendering.value = true;
  error.value = "";
  try {
    const blob = await renderCard(props.tasks, date, { theme: selectedTheme });
    if (disposed) return;
    previewBlob.value = blob;
    previewUrl.value = URL.createObjectURL(blob);
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : "预览生成失败，请重试";
  } finally {
    if (!disposed) isRendering.value = false;
  }
};

const download = async () => {
  if (!previewBlob.value || isRendering.value || isSaving.value) return;
  const blob = previewBlob.value;
  isSaving.value = true;
  error.value = "";
  status.value = "";
  try {
    const filename = `DeskNote_${formatFileDate(date)}.png`;
    if (isTauri()) {
      const path = await save({ defaultPath: filename, filters: [{ name: "PNG Image", extensions: ["png"] }] });
      if (!path) return;
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      status.value = "卡片已保存";
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.value = "卡片已下载";
    }
  } catch (cause) {
    error.value = cause instanceof Error ? `保存失败：${cause.message}` : "保存失败，请重试";
  } finally {
    isSaving.value = false;
  }
};

const close = () => { if (!isSaving.value) emit("close"); };
const handleKey = (event: KeyboardEvent) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "Tab") {
    const controls = panelRef.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
};

onMounted(() => {
  backRef.value?.focus();
  void renderPreview();
});
onUnmounted(() => {
  disposed = true;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
</script>

<template>
  <section ref="panelRef" class="export-panel" role="dialog" aria-modal="true" aria-label="导出卡片" @keydown="handleKey">
    <header class="export-header">
      <h1>导出卡片</h1>
      <button ref="backRef" class="back-button" :disabled="isSaving" aria-label="返回待办" @click="close">×</button>
    </header>

    <div class="preview-stage" :aria-busy="isRendering">
      <img v-if="previewUrl" :src="previewUrl" alt="导出卡片预览" :data-theme="selectedTheme" />
      <span v-else class="preview-loading">{{ isRendering ? '正在描绘…' : '预览未生成' }}</span>
    </div>

    <footer class="export-footer">
      <div v-if="error" class="export-error-row">
        <p class="export-error" role="alert">{{ error }}</p>
        <button v-if="!previewBlob && !isRendering" class="retry-button" @click="renderPreview">重试预览</button>
      </div>
      <p v-else-if="status" class="export-status" role="status">{{ status }}</p>
      <button class="save-button" :disabled="isRendering || isSaving || !previewBlob" :aria-busy="isSaving" @click="download">
        {{ isSaving ? "正在保存…" : "保存 PNG" }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.export-panel { box-sizing: border-box; width: min(360px, 100vw); height: min(450px, 100dvh); padding: 16px clamp(12px, 5.5vw, 20px); display: flex; flex-direction: column; gap: 12px; color: #3e3a35; background: #fffefa; border: 1px solid #eeeae2; border-radius: 16px; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; box-shadow: 0 14px 36px #302b2420; overflow: hidden; }
.export-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.export-header h1 { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: 1px; margin: 0; }
.back-button { flex-shrink: 0; width: 28px; height: 28px; border: 1px solid #e6e0d7; border-radius: 50%; font-size: 20px; line-height: 1; background: transparent; color: #81776b; cursor: pointer; }
.preview-stage { display: flex; flex: 1; min-height: 0; align-items: center; justify-content: center; padding: 8px; border-radius: 10px; background: #f0ede7; overflow: hidden; }
.preview-stage img { display: block; width: 100%; height: 100%; object-fit: contain; }
.preview-loading { font-size: 11px; color: #8c8173; }
.export-footer { flex-shrink: 0; }
.export-error-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.export-error-row .export-error { flex: 1; min-width: 0; margin: 0; }
.retry-button { flex-shrink: 0; height: 26px; padding: 0 7px; border: 1px solid #e8e1d6; border-radius: 6px; background: #faf8f3; color: #847969; font-size: 10px; cursor: pointer; }
.export-status, .export-error { margin: 0 0 6px; line-height: 14px; font-size: 10px; color: #9c917f; text-align: center; }
.export-error { color: #a64736; max-height: 28px; overflow-y: auto; }
.save-button { width: 100%; height: 36px; border: 0; border-radius: 7px; color: #fffdf8; background: #514939; font-size: 12px; letter-spacing: 1px; cursor: pointer; }
.save-button:hover { background: #3d372c; }
button:disabled { cursor: default; opacity: .45; }
button:focus-visible { outline: 2px solid #96836a; outline-offset: 1px; }
@media (max-height: 340px) { .export-panel { padding-block: 10px; gap: 8px; } }
</style>
