import { landscapeScenes } from "./sketchLandscapes";
import { lifeScenes } from "./sketchLife";
import { CHINA_THEMES } from "./sketchChina";
import { WORLD_THEMES } from "./sketchWorld";

const NATURE_THEMES = [
  { id: "cat", name: "午后小憩", description: "把忙碌放一放，和小猫一起伸个懒腰。" },
  { id: "mountains", name: "山野来信", description: "山的那一边，是慢慢亮起来的新一天。" },
  { id: "coast", name: "海岸微风", description: "听风经过灯塔，让心事随小船走远。" },
  { id: "cabin", name: "林间小屋", description: "沿着松林的小路，回到自己的节奏。" },
  { id: "botanical", name: "花与小书", description: "一枝花、几页书，留一点时间给自己。" },
  { id: "moon", name: "月色入湖", description: "月亮落在水面，今天也可以安心收尾。" },
] as const;

export const SKETCH_THEMES = [
  ...NATURE_THEMES.map((theme) => ({ ...theme, category: "nature" as const, location: "日常与自然" })),
  ...CHINA_THEMES.map(({ scene: _scene, ...theme }) => theme),
  ...WORLD_THEMES.map(({ scene: _scene, ...theme }) => theme),
] as const;

export const SKETCH_CATEGORIES = [
  { id: "all", name: "全部" },
  { id: "nature", name: "日常风景" },
  { id: "china", name: "中国建筑" },
  { id: "world", name: "世界建筑" },
] as const;
export type SketchCategory = typeof SKETCH_CATEGORIES[number]["id"];
export type SketchTheme = typeof SKETCH_THEMES[number]["id"];
export const THEME_STORAGE_KEY = "desknote_export_theme_v1";

export const isSketchTheme = (value: unknown): value is SketchTheme =>
  SKETCH_THEMES.some((theme) => theme.id === value);

const scenes: Record<string, string> = {
  ...landscapeScenes,
  ...lifeScenes,
  ...Object.fromEntries(CHINA_THEMES.map((theme) => [theme.id, theme.scene])),
  ...Object.fromEntries(WORLD_THEMES.map((theme) => [theme.id, theme.scene])),
};

/** 内联素材均为本地原创线稿，预览与导出使用同一份绘图。 */
export function createSketchSvg(theme: SketchTheme, thumbnail = false): string {
  const selected = SKETCH_THEMES.find((item) => item.id === theme) ?? SKETCH_THEMES[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="220" viewBox="0 0 660 220" fill="none" stroke="#45413e" stroke-width="${thumbnail ? 2.8 : 1.65}" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${selected.name}">
    <title>${selected.name}</title>
    ${scenes[selected.id]}
  </svg>`;
}

export async function loadSketchImage(theme: SketchTheme): Promise<HTMLImageElement> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([createSketchSvg(theme)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("插画加载失败，请重试"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
