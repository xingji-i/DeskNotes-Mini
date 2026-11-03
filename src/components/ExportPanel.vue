<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { renderCard } from "../lib/exportCard";
import { formatFileDate } from "../lib/date";
import { createSketchSvg, isSketchTheme, SKETCH_CATEGORIES, SKETCH_THEMES, THEME_STORAGE_KEY, type SketchCategory, type SketchTheme } from "../lib/sketches";
import type { TodoItem } from "../lib/tasks";

const props = defineProps<{ tasks: TodoItem[] }>();
const emit = defineEmits<{ close: [] }>();
const panelRef = ref<HTMLElement | null>(null);
const backRef = ref<HTMLButtonElement | null>(null);
const themeGridRef = ref<HTMLElement | null>(null);
const zoomButtonRef = ref<HTMLButtonElement | null>(null);
const activeCategory = ref<SketchCategory>("all");
const searchText = ref("");
const showFullPreview = ref(false);
const date = new Date();
const selectedTheme = ref<SketchTheme>("cat");
try {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (isSketchTheme(saved)) {
    selectedTheme.value = saved;
    activeCategory.value = SKETCH_THEMES.find((theme) => theme.id === saved)!.category;
  }
} catch { /* 主题偏好不可用时仍可正常预览和导出。 */ }

const selected = computed(() => SKETCH_THEMES.find((theme) => theme.id === selectedTheme.value)!);
const selectedIndex = computed(() => String(SKETCH_THEMES.findIndex((theme) => theme.id === selectedTheme.value) + 1).padStart(2, "0"));
const categories = SKETCH_CATEGORIES.map((category) => ({
  ...category,
  count: SKETCH_THEMES.filter((theme) => category.id === "all" || theme.category === category.id).length,
}));
const filteredThemes = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase();
  return SKETCH_THEMES.filter((theme) =>
    (activeCategory.value === "all" || theme.category === activeCategory.value) &&
    (!query || `${theme.name} ${theme.location} ${theme.description}`.toLocaleLowerCase().includes(query)),
  );
});
const clearFilters = () => { activeCategory.value = "all"; searchText.value = ""; };
watch([activeCategory, searchText], async () => {
  await nextTick();
  if (themeGridRef.value) themeGridRef.value.scrollTop = 0;
});
const previewUrl = ref("");
const previewBlob = ref<Blob | null>(null);
const isRendering = ref(false);
const isSaving = ref(false);
const status = ref("");
const error = ref("");
let renderVersion = 0;
let disposed = false;

watch(selectedTheme, async (theme) => {
  const version = ++renderVersion;
  isRendering.value = true;
  previewBlob.value = null;
  status.value = "";
  error.value = "";
  try {
    const blob = await renderCard(props.tasks, date, { theme });
    if (disposed || version !== renderVersion) return;
    const oldUrl = previewUrl.value;
    previewBlob.value = blob;
    previewUrl.value = URL.createObjectURL(blob);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* 仅忽略偏好写入失败。 */ }
  } catch (cause) {
    if (!disposed && version === renderVersion) {
      error.value = cause instanceof Error ? cause.message : "预览生成失败，请重新选择插画";
    }
  } finally {
    if (!disposed && version === renderVersion) isRendering.value = false;
  }
}, { immediate: true });

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

const close = async () => {
  if (isSaving.value) return;
  if (showFullPreview.value) {
    showFullPreview.value = false;
    await nextTick();
    zoomButtonRef.value?.focus();
    themeGridRef.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  } else emit("close");
};
const zoomPreview = async () => {
  showFullPreview.value = true;
  await nextTick();
  backRef.value?.focus();
};
const handleKey = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "Tab") {
    const controls = panelRef.value?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
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

onMounted(async () => {
  await nextTick();
  backRef.value?.focus();
  themeGridRef.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
});
onUnmounted(() => {
  disposed = true;
  renderVersion++;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
</script>

<template>
  <section ref="panelRef" class="export-panel" role="dialog" aria-modal="true" aria-label="导出卡片" @keydown="handleKey">
    <header class="export-header">
      <div><h1>{{ showFullPreview ? '卡片预览' : '给今天，留一张画' }}</h1><p>DAILY SKETCH · {{ SKETCH_THEMES.length }} SCENES</p></div>
      <button ref="backRef" class="back-button" :disabled="isSaving" :aria-label="showFullPreview ? '返回选图' : '返回待办'" @click="close">{{ showFullPreview ? '‹' : '×' }}</button>
    </header>

    <div v-if="showFullPreview" class="full-preview-scroll" role="region" aria-label="卡片大图" tabindex="0">
      <img :src="previewUrl" alt="放大卡片预览" />
    </div>
    <template v-else>
    <div class="preview-stage" :aria-busy="isRendering">
      <button ref="zoomButtonRef" class="card-preview" aria-label="放大预览" :disabled="!previewBlob || isRendering" @click="zoomPreview">
        <img v-if="previewUrl" :src="previewUrl" alt="导出卡片预览" :data-theme="selectedTheme" />
        <span v-else class="preview-loading">正在描绘…</span>
        <span class="zoom-hint">点击放大</span>
      </button>
      <div class="preview-caption">
        <span class="edition">{{ selectedIndex }} / {{ SKETCH_THEMES.length }} · {{ selected.location }}</span>
        <h2>{{ selected.name }}</h2>
        <p>{{ selected.description }}</p>
        <span class="format-note">黑白线稿 · PNG</span>
      </div>
    </div>

    <div class="theme-library">
      <div class="category-tabs" role="group" aria-label="主题分类">
        <button v-for="category in categories" :key="category.id" :aria-label="`分类：${category.name}`"
          :aria-pressed="activeCategory === category.id" @click="activeCategory = category.id">
          {{ category.name }} <span>{{ category.count }}</span>
        </button>
      </div>
      <div class="search-row">
        <input v-model="searchText" type="search" aria-label="搜索插画" placeholder="搜建筑、地区或名称" />
        <span>{{ filteredThemes.length }} 款</span>
      </div>
      <div ref="themeGridRef" class="theme-grid" role="group" aria-label="插画主题">
      <button v-for="theme in filteredThemes" :key="theme.id" class="theme-button"
        :class="{ selected: selectedTheme === theme.id }" :aria-label="`插画：${theme.name}`"
        :aria-pressed="selectedTheme === theme.id" :disabled="isSaving" @click="selectedTheme = theme.id">
        <span class="theme-sketch" aria-hidden="true" v-html="createSketchSvg(theme.id, true)"></span>
        <span>{{ theme.name }}</span>
      </button>
      <div v-if="filteredThemes.length === 0" class="empty-themes">
        <p>没有找到这幅风景</p><button @click="clearFilters">清除筛选</button>
      </div>
      </div>
    </div>
    </template>

    <footer class="export-footer">
      <p v-if="error" class="export-error" role="alert">{{ error }}</p>
      <p v-else class="export-status" role="status">{{ status || (isRendering ? '正在生成预览…' : '保存的卡片与预览一致') }}</p>
      <button class="save-button" :disabled="isRendering || isSaving || !previewBlob" :aria-busy="isSaving" @click="download">
        {{ isSaving ? "正在保存…" : "保存 PNG" }} <span aria-hidden="true">↓</span>
      </button>
    </footer>
  </section>
</template>

<style scoped>
.export-panel { box-sizing: border-box; width: min(360px, 100vw); height: min(450px, 100dvh); padding: 16px clamp(12px, 5.5vw, 20px); display: flex; flex-direction: column; gap: 8px; color: #3e3a35; background: #fffefa; border: 1px solid #eeeae2; border-radius: 16px; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; box-shadow: 0 14px 36px #302b2420; overflow: hidden; }
.export-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.export-header h1 { font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: 1px; margin: 0; }
.export-header p { margin: 3px 0 0; font-size: 8px; line-height: 10px; letter-spacing: 2px; color: #999084; }
.back-button { flex-shrink: 0; width: 28px; height: 28px; border: 1px solid #e6e0d7; border-radius: 50%; font-size: 20px; line-height: 1; background: transparent; color: #81776b; cursor: pointer; }
.preview-stage { display: flex; gap: 12px; align-items: center; padding: 8px 12px; height: clamp(72px, calc(100dvh - 322px), 128px); flex-shrink: 0; border-radius: 10px; background: #f0ede7; overflow: hidden; }
.card-preview { position: relative; width: 84px; height: 100%; max-height: 110px; padding: 0; border: 0; background: transparent; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: zoom-in; }
.card-preview img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 5px; box-shadow: 0 4px 12px #4b43301a; }
.zoom-hint { position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%); padding: 2px 6px; white-space: nowrap; border-radius: 4px; background: #fffefbea; color: #8b7f6e; font-size: 8px; }
.preview-loading { font-size: 11px; color: #8c8173; }
.preview-caption { min-width: 0; }
.edition { display: block; font-size: 8px; letter-spacing: .6px; color: #978d7e; }
.preview-caption h2 { font-family: "Noto Serif SC", "SimSun", serif; font-size: 18px; line-height: 22px; font-weight: 400; letter-spacing: 2px; margin: 6px 0; }
.preview-caption p { margin: 0; font-size: 10px; line-height: 1.6; color: #83786a; }
.format-note { display: block; margin-top: 7px; font-size: 8px; letter-spacing: 1px; color: #a39786; }
.theme-library { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 6px; }
.category-tabs { display: grid; grid-template-columns: .7fr repeat(3, 1fr); flex-shrink: 0; align-items: center; height: 26px; gap: 3px; border-bottom: 1px solid #ece6dc; }
.category-tabs button { height: 26px; white-space: nowrap; border: 0; border-bottom: 2px solid transparent; padding: 0 3px; background: transparent; color: #958a78; font-size: 10px; cursor: pointer; }
.category-tabs button[aria-pressed="true"] { border-bottom-color: #78664d; color: #514534; }
.category-tabs span { color: #a79d8b; font-size: 8px; }
.search-row { position: relative; display: flex; align-items: center; flex-shrink: 0; height: 26px; }
.search-row input { box-sizing: border-box; width: 100%; height: 26px; min-width: 0; border: 1px solid #e8e1d6; border-radius: 6px; padding: 3px 45px 3px 9px; background: #faf8f3; color: #625746; font-size: 10px; }
.search-row input::placeholder { color: #b0a592; }
.search-row span { position: absolute; right: 8px; pointer-events: none; font-size: 9px; color: #a29580; }
.theme-grid { display: grid; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 56px; align-content: start; gap: 6px; padding: 2px 4px 2px 2px; scrollbar-width: thin; scrollbar-color: #d5cbbd transparent; }
.theme-button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 0; height: 56px; padding: 3px 4px 4px; background: #fffefa; border: 1px solid #e8e3da; border-radius: 7px; font-size: 9px; color: #847969; cursor: pointer; transition: border-color .15s, background .15s; }
.theme-button:hover { border-color: #aaa08f; background: #f7f4ee; }
.theme-button.selected { border-color: #796b57; background: #f1ece3; color: #4d4336; }
.theme-sketch { display: block; width: 100%; height: 31px; }
.theme-sketch :deep(svg) { display: block; width: 100%; height: 100%; }
.empty-themes { grid-column: 1 / -1; align-self: center; text-align: center; font-size: 11px; color: #a19582; }
.empty-themes p { margin: 5px 0; }
.empty-themes button { border: 0; background: transparent; color: #77654d; font-size: 10px; text-decoration: underline; cursor: pointer; }
.full-preview-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; border-radius: 8px; background: #f0ede7; }
.full-preview-scroll img { display: block; width: 100%; height: auto; }
.export-footer { flex-shrink: 0; }
.export-status, .export-error { margin: 0 0 4px; min-height: 12px; line-height: 12px; font-size: 9px; color: #9c917f; text-align: center; }
.export-error { color: #a64736; max-height: 24px; overflow-y: auto; }
.save-button { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 32px; border: 0; border-radius: 7px; color: #fffdf8; background: #514939; font-size: 11px; letter-spacing: 1px; cursor: pointer; }
.save-button:hover { background: #3d372c; }
button:disabled { cursor: default; opacity: .45; }
button:focus-visible, input:focus-visible { outline: 2px solid #96836a; outline-offset: 1px; }
@media (max-height: 420px) {
  .format-note { display: none; }
}
@media (max-height: 400px) {
  .preview-caption p { display: none; }
  .preview-caption h2 { margin: 4px 0 0; font-size: 16px; }
}
@media (max-width: 300px) {
  .preview-stage { gap: 8px; padding-inline: 8px; }
  .card-preview { width: 64px; }
  .category-tabs { gap: 1px; }
  .category-tabs button { padding-inline: 1px; }
}
@media (max-height: 340px) {
  .export-panel { padding-block: 10px; gap: 6px; }
  .preview-stage { height: 56px; }
  .theme-grid { grid-auto-rows: 48px; }
  .theme-button { height: 48px; }
  .theme-sketch { height: 25px; }
}
@media (prefers-reduced-motion: reduce) { .theme-button { transition: none; } }
</style>
