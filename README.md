# DeskNote Mini 📝

一款轻量的 **Windows 桌面待办小组件**。它安静地"贴"在你的桌面上——位于壁纸之上、所有普通窗口之下，不会抢焦点、不占任务栏，打开电脑就能看见今天最重要的事。

![Tauri](https://img.shields.io/badge/Tauri-2.x-orange?logo=tauri&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3.5-brightgreen?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey?logo=windows&logoColor=white)
![Version](https://img.shields.io/badge/version-0.1.1-green)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## ✨ 功能特性

- **桌面常驻**：首次启动位于屏幕右上角，置于桌面底层（高于壁纸、低于所有普通窗口），随时可见但不打扰
- **移动与钉住**：拖动顶部日期区域移动便签，点击图钉锁定位置，再点一次解锁；自动记住位置和锁定状态
- **永不抢焦点**：窗口设置为 `WS_EX_NOACTIVATE` + `WS_EX_TOOLWINDOW`，点击不影响当前工作，也不出现在任务栏
- **Explorer 崩溃自愈**：监听系统的 `TaskbarCreated` 广播消息，Explorer 重启后自动恢复窗口层级，小组件不会"消失"
- **待办管理**：添加 / 编辑（双击或点 ✎）/ 勾选完成 / 删除，待办在前、已完成在后自动排序
- **复杂版（可选）**：点击底部 **复杂版** 开启，可拖动排序、给任务贴颜色标签（优先级 红 > 橙 > 蓝），并可一键按标签排序；再点一次回到简洁版，顺序和标签都会保留
- **本地持久化**：任务数据通过 `localStorage` 自动保存；异常记录先备份再恢复，存储失败会在界面提示
- **卡片导出**：一键将今日待办渲染成 3:4 比例的打卡卡片 PNG，每次打开导出时从 88 款原创线稿中随机搭配一张（49 款日常与自然、19 款中国建筑、20 款世界建筑），预览后即可保存
- **浏览器预览**：非 Tauri 环境自动跳过窗口初始化，任务管理与 PNG 下载照常可用

## 🖼️ 界面预览

```
┌──────────────────────────────┐
│ 09.24  建议只设置最紧急的5项  ＋ 📥 │
│ ──────────────────────────── │
│ ☐ 完成季度汇报初稿            │
│ ☐ 回复客户邮件                │
│ ☑ 旧需求评审           ✎ ×  │
│                              │
│        DESKNOTE MINI         │
└──────────────────────────────┘
```

- 点击提示文字或右上角 **＋** 添加任务，回车确认，Esc 取消
- 点击复选框切换完成状态（已完成项自动沉底并加删除线）
- 双击任务文本或点击 **✎** 进入编辑；点击 **×** 删除
- 点击底部 **复杂版**：拖动行首的 ⠿ 调整顺序（聚焦后也可用 ↑ ↓ 键），点击圆点循环切换标签 红 → 橙 → 蓝 → 无，点击 **按标签排序** 按优先级整理
- 点击 **📥** 自动随机搭配一张插画，查看卡片预览后点击 **保存 PNG**
- 按住顶部日期拖动便签，点击图钉固定位置，再次点击可继续移动

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | [Tauri 2](https://tauri.app/) | Rust 后端 + 系统 WebView 前端，体积小、内存占用低 |
| 前端框架 | [Vue 3.5](https://vuejs.org/)（`<script setup>` SFC） | 组合式 API，响应式任务列表 |
| 语言 | TypeScript 5.6 | 前端类型检查（`vue-tsc`） |
| 构建 | Vite 6 | 极速 HMR 与打包 |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite` 插件） | 原子化 CSS |
| 系统调用 | `windows-sys`（Win32 API） | 窗口样式、层级控制、消息循环 |
| Tauri 插件 | `plugin-dialog` / `plugin-fs` | 原生文件保存对话框与文件写入 |
| 持久化 | `localStorage` | 任务数据自动保存 |
| 卡片导出 | HTML5 Canvas | 服务端零依赖，纯前端绘制 PNG |

### 核心实现原理

1. **窗口配置**（`src-tauri/tauri.conf.json`）：无边框、透明、不可缩放、启动隐藏、跳过任务栏
2. **Rust 侧**（`src-tauri/src/lib.rs`）：
   - 通过 `SetWindowLongPtrW` 设置 `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` 扩展样式
   - 通过 `SetWindowPos` + `HWND_BOTTOM` 将窗口置于所有普通窗口之下，并用 `SWP_NOMOVE` 保留前端位置
   - 独立线程创建隐藏窗口，注册 `TaskbarCreated` 消息监听，Explorer 重启后自动重设层级
3. **前端侧**（`src/lib/desktop.ts`、`src/composables/useTasks.ts`）：
   - 窗口层级由 Rust 原生逻辑维护，避免重复修改 Explorer 父窗口
   - 原生窗口和卡片统一为 360×450 逻辑像素；按当前显示器工作区、缩放因子与实际窗口物理尺寸计算右上角位置，保留 24 逻辑像素边距
   - 恢复上次位置并完成定位后再显示；切换显示器、调整缩放或窗口越界时重新校正边界，较小工作区内自动收缩窗口
   - `watch` 深度监听任务数组，实时同步到 `localStorage`

## 📦 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | ≥ 18（推荐 20+） | 前端构建 |
| Rust | stable（≥ 1.77） | Tauri 2 后端编译，需 [rustup](https://rustup.rs/) 安装 |
| VS Code 插件（可选） | — | [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)、[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)、[rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) |

> Windows 构建还需安装 [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 与 WebView2（Win11 已内置）。

## 🚀 快速开始

可在 [GitHub Releases](https://github.com/xingji-i/DeskNotes-Mini/releases) 下载 Windows x64 安装包。

### 1. 克隆项目

```bash
git clone https://github.com/xingji-i/DeskNotes-Mini.git
cd DeskNotes-Mini
```

### 2. 安装依赖

```bash
npm install
```

### 3. 开发模式运行

```bash
npm run tauri dev
```

首次运行会编译 Rust 依赖，耗时较长；之后增量编译很快。窗口默认**不可见**（配置 `visible: false`），由 Rust 设置层级，前端完成尺寸与位置校正后再显示。

> 💡 直接 `npm run dev` 只启动纯浏览器预览，窗口贴桌面、位置固定等 Tauri 特性不可用（会自动降级跳过）。

### 4. 构建发布版

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/`：

- `desknote-mini.exe` — 单文件可执行程序
- `bundle/msi/*.msi` / `bundle/nsis/*.exe` — 安装包

## 📖 使用教程

### 日常使用

1. **启动**：双击运行 `desknote-mini.exe`（或安装后从开始菜单启动），小组件首次出现在**屏幕右上角**，之后恢复上次位置
2. **添加任务**：点击“建议只设置最紧急的5项”或右上角 **＋**，输入内容后按 **Enter** 确认（**Esc** 取消）
3. **编辑任务**：**双击**任务文字，或点击右侧 **✎** 按钮，修改后 **Enter** 保存
4. **完成任务**：点击左侧方框打勾 ✓，任务自动移入"已完成"区域并显示删除线；再次点击可撤销
5. **删除任务**：点击任务右侧的 **×**
6. **导出卡片**：点击 **📥**，自动随机搭配一张插画并显示完整卡片，点击 **保存 PNG** 即可保存；桌面版会选择保存位置，浏览器版直接下载。关闭预览即可返回待办；每次重新打开导出都会重新随机，当前预览内重复保存或重试会保留同一张插画
7. **移动与钉住**：按住顶部日期拖到合适位置，点击图钉锁定，再点一次解锁。钉住只锁定拖动，任务仍可编辑，也不会变成置顶窗口。位置与钉住状态会记住；屏幕布局变化时会校正位置，避免便签落在屏幕外

### 数据说明

- 任务保存在 WebView 的 `localStorage`（key：`desknote_tasks_v1`）中，重启程序数据不丢失
- 卸载程序不会清除该数据；如需彻底重置，可在应用安装目录的 WebView 数据中清除，或开发模式下通过浏览器 DevTools 清除

### 常见问题

**Q：小组件被其他窗口挡住了？**
A：这是设计如此——小组件位于桌面底层，把窗口最小化或移开即可看到它，它永远不会遮挡你的工作窗口。

**Q：重启电脑 / Explorer 崩溃后小组件消失了？**
A：程序通过监听 `TaskbarCreated` 广播自动恢复。若小组件层级异常，重启程序即可。

**Q：窗口右边按钮被裁掉或跑到屏幕外？**
A：旧版本混用了逻辑像素与物理像素，高 DPI 下可能越界。源码已统一窗口与卡片尺寸，并依据实际显示器工作区校正位置。已有 exe 不会随源码自动更新，必须重新编译并运行新 exe；浏览器验证也不能代替原生窗口定位验证。

**Q：能改位置或大小吗？**
A：可拖动顶部改变位置，并通过图钉锁定。窗口和卡片默认均为 360×450 逻辑像素，工作区较小时会收缩，待办列表可滚动，导出预览会适应窗口大小。浏览器预览支持在网页范围内移动；实际桌面拖动需使用重新构建的 exe。修改 `src/lib/desktopGeometry.ts` 中的默认尺寸与边距时，请同步 `src-tauri/tauri.conf.json` 和页面尺寸后重新构建。

## 📁 项目结构

```
DeskNotes-Mini/
├── public/                  # 静态资源
├── src/
│   ├── App.vue               # 界面与交互编排
│   ├── composables/          # 任务持久化与跨天日期刷新
│   ├── lib/                  # 数据校验、窗口定位、卡片绘制和文本换行
│   ├── main.ts               # Vue 应用入口
│   ├── style.css             # 全局样式（Tailwind 引入）
│   └── assets/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs           # 程序入口
│   │   └── lib.rs            # 核心逻辑：窗口底层设置、TaskbarCreated 监听
│   ├── tauri.conf.json       # Tauri 窗口/打包配置
│   ├── Cargo.toml            # Rust 依赖清单
│   └── icons/                # 应用图标
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## 🔧 开发指南

### 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 仅启动前端（浏览器预览，无 Tauri 特性） |
| `npm run tauri dev` | 完整桌面应用开发模式（热更新） |
| `npm run build` | 类型检查 + 前端产物构建 |
| `npm run tauri build` | 构建发布版可执行文件与安装包 |

### 回归验证与本地运行说明

测试使用 Node.js 22.18+（本次验证为 Node.js 26）与已安装的 Microsoft Edge：

```bash
npm test
npm run test:e2e
npm run build
```

- 单元测试覆盖损坏缓存保护、备份失败、重复 ID、任务排序、文本换行及日期格式。
- 浏览器测试使用独立临时数据，覆盖中文输入法、键盘编辑、持久化、长列表、PNG 下载及跨午夜日期更新；还验证 88 款线稿有效且互不相同、重新打开时随机选图、预览与下载一致、失败重试及窄窗口显示。
- 浏览器预览与桌面版使用不同的本地存储，不会自动同步任务。
- 移动与钉住测试覆盖浏览器拖动、锁定后禁止拖动、刷新后恢复、小窗口边界，以及 Tauri IPC 模拟的原生拖动调用和窗口位置恢复；IPC 模拟不能代替 Windows 实机验证。
- 目录根部已有的 `desknote-mini.exe` 是独立预编译程序，修改源码不会更新它。安装 Rust/MSVC C++ Build Tools 后运行 `npm run tauri build`，再使用 `src-tauri/target/release/desknote-mini.exe` 验证桌面改动。
- 异常任务原始备份键名前缀为 `desknote_tasks_v1_corrupt_`；初始化不会覆盖原任务记录。

### 修改窗口行为

- **窗口尺寸 / 位置**：`src/lib/desktopGeometry.ts` → `WIDGET_WIDTH`、`WIDGET_HEIGHT`、`WIDGET_MARGIN`，以及 `src/lib/desktop.ts` 的工作区边界校正
- **窗口外观（边框、透明、任务栏）**：`src-tauri/tauri.conf.json` → `app.windows[0]`
- **Rust 侧层级恢复**：`src-tauri/src/lib.rs` → `set_window_to_bottom()`，不改变窗口位置

### 自定义导出卡片

导出卡片由 Canvas 与本地 SVG 线稿绘制（无需网络图片），绘制逻辑集中在 `src/lib/exportCard.ts` 的 `renderCard()`，首次导出时才加载：

- `roundRectPath()` — 圆角矩形（卡片主体 / 复选框）
- `src/lib/sketchLife.ts` — 午后小憩、花与小书、月色入湖
- `src/lib/sketchLandscapes.ts` — 山野来信、海岸微风、林间小屋
- `src/lib/sketchChina.ts` — 四合院、水乡石桥、徽州白墙、土楼、古塔、小亭、吊脚楼、石库门、牌坊、鼓楼
- `src/lib/sketchWorld.ts` — 巴黎、伦敦、罗马、爱琴海、京都、荷兰、伊斯坦布尔、摩洛哥、阿尔卑斯、布拉格建筑灵感
- `src/lib/sketchNatureCollection.ts` — 层田、竹径、沙海、瀑布、苇岸与雪径
- `src/lib/sketchArchitectureCollection.ts` — 天坛、大理白院、廊桥、巴塞花窗、巴伐利亚城堡与峡湾渔村
- `src/lib/sketchWaterAndGarden.ts` — 水景、花园与季节风景
- `src/lib/sketchBuiltPlaces.ts` — 中国与世界建筑灵感
- `src/lib/sketchQuietHours.ts` — 日常静物与兴趣角落
- `src/lib/sketchWildNeighbors.ts` — 田野、林间和海里的野生动物
- `src/lib/sketches.ts` — 统一 660×220 画布、88 款插画目录及图片加载
- `src/components/ExportPanel.vue` — 打开时随机选图、卡片预览与 PNG 保存
- `drawPawStamp()` — 按任务 ID 固定显示的猫爪印章，重复导出与预览一致
- 布局常量（画布尺寸 900px 宽、3:4 默认高度、内边距、行高）均在 `renderCard()` 顶部，可按需调整

修改后运行 `npm run dev` 或 `npm run tauri dev`，点击 📥 按钮即可预览随机搭配的卡片并保存。当前输出为静态 PNG；SVG 本身可无损缩放。建筑作品为原创艺术概括，不是建筑测绘图。保存复用当前预览的 PNG 数据，生成失败时可重试同一张插画；关闭后重新打开才会再次随机。

新增插画时保留原有主题 ID，在 `sketches.ts` 的 `SKETCH_THEMES` 和场景目录中注册作品，即可加入同一个随机插画池。每幅使用 660×220 画布，不引用外部资源，并运行图像唯一性、导出一致性及窄窗口回归测试。

## 🗺️ 路线图

- [x] 拖动改变位置、图钉锁定和位置记忆（Windows 实机验证待完成）
- [ ] 可调节透明度 / 主题（深色模式）
- [ ] 多张便签卡片
- [ ] 系统托盘菜单
- [ ] 数据导入导出（JSON）

## 📄 许可证

本项目采用 [MIT License](./LICENSE) 开源。

## 🔗 仓库地址

<https://github.com/xingji-i/DeskNotes-Mini>

---

<p align="center">DeskNote Mini — 把最重要的事，贴在桌面上。</p>
