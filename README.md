# DeskNote Mini 📝

一款轻量的 **Windows 桌面待办小组件**。它安静地"贴"在你的桌面上——位于壁纸之上、所有普通窗口之下，不会抢焦点、不占任务栏，打开电脑就能看见今天最重要的事。

![Tauri](https://img.shields.io/badge/Tauri-2.x-orange?logo=tauri&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3.5-brightgreen?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey?logo=windows&logoColor=white)
![Version](https://img.shields.io/badge/version-0.1.0-green)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## ✨ 功能特性

- **桌面常驻**：窗口固定在屏幕右上角，置于桌面底层（高于壁纸、低于所有普通窗口），随时可见但不打扰
- **永不抢焦点**：窗口设置为 `WS_EX_NOACTIVATE` + `WS_EX_TOOLWINDOW`，点击不影响当前工作，也不出现在任务栏
- **Explorer 崩溃自愈**：监听系统的 `TaskbarCreated` 广播消息，Explorer 重启后自动恢复窗口层级，小组件不会"消失"
- **待办管理**：添加 / 编辑（双击或点 ✎）/ 勾选完成 / 删除，待办在前、已完成在后自动排序
- **本地持久化**：任务数据通过 `localStorage` 自动保存，重启不丢失
- **卡片导出**：一键将今日待办渲染成 750×1334 的 PNG 图片（含日期、勾选状态、删除线和随机 AI 装饰插画），方便分享
- **优雅降级**：非 Tauri 环境（如纯浏览器 `vite dev` 首页）下自动跳过窗口初始化，界面照常可用

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

- 点击右上角 **＋** 添加任务，回车确认，Esc 取消
- 点击复选框切换完成状态（已完成项自动沉底并加删除线）
- 双击任务文本或点击 **✎** 进入编辑；点击 **×** 删除
- 点击 **📥** 导出 PNG 卡片并选择保存位置

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | [Tauri 2](https://tauri.app/) | Rust 后端 + 系统 WebView 前端，体积小、内存占用低 |
| 前端框架 | [Vue 3.5](https://vuejs.org/)（`<script setup>` SFC） | 组合式 API，响应式任务列表 |
| 语言 | TypeScript 5.6 | 前端类型检查（`vue-tsc`） |
| 构建 | Vite 6 | 极速 HMR 与打包 |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite` 插件） | 原子化 CSS |
| 桌面底层窗口 | [tauri-plugin-desktop-underlay](https://crates.io/crates/tauri-plugin-desktop-underlay) | 将窗口沉到桌面层 |
| 系统调用 | `windows-sys`（Win32 API） | 窗口样式、层级控制、消息循环 |
| Tauri 插件 | `plugin-dialog` / `plugin-fs` | 原生文件保存对话框与文件写入 |
| 持久化 | `localStorage` | 任务数据自动保存 |
| 卡片导出 | HTML5 Canvas | 服务端零依赖，纯前端绘制 PNG |

### 核心实现原理

1. **窗口配置**（`src-tauri/tauri.conf.json`）：无边框、透明、不可缩放、启动隐藏、跳过任务栏
2. **Rust 侧**（`src-tauri/src/lib.rs`）：
   - 通过 `SetWindowLongPtrW` 设置 `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` 扩展样式
   - 通过 `SetWindowPos` + `HWND_BOTTOM` 将窗口置于所有普通窗口之下（壁纸之上）
   - 独立线程创建隐藏窗口，注册 `TaskbarCreated` 消息监听，Explorer 重启后自动重设层级
3. **前端侧**（`src/App.vue`）：
   - `setDesktopUnderlay(true)` 调用桌面底层插件
   - 通过 `getCurrentWindow()` 精确计算并固定窗口位置（屏幕右上角）
   - `watch` 深度监听任务数组，实时同步到 `localStorage`

## 📦 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | ≥ 18（推荐 20+） | 前端构建 |
| Rust | stable（≥ 1.77） | Tauri 2 后端编译，需 [rustup](https://rustup.rs/) 安装 |
| VS Code 插件（可选） | — | [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)、[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)、[rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) |

> Windows 构建还需安装 [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 与 WebView2（Win11 已内置）。

## 🚀 快速开始

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

首次运行会编译 Rust 依赖，耗时较长；之后增量编译很快。窗口默认**不可见**（配置 `visible: false`），启动后会由 Rust 端完成层级设置再显示。

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

1. **启动**：双击运行 `desknote-mini.exe`（或安装后从开始菜单启动），小组件会自动出现在**屏幕右上角**的桌面层
2. **添加任务**：点击右上角 **＋**，输入内容后按 **Enter** 确认（**Esc** 取消）；建议只保留最紧急的 5 项，保持专注
3. **编辑任务**：**双击**任务文字，或点击右侧 **✎** 按钮，修改后 **Enter** 保存
4. **完成任务**：点击左侧方框打勾 ✓，任务自动移入"已完成"区域并显示删除线；再次点击可撤销
5. **删除任务**：点击任务右侧的 **×**
6. **导出卡片**：点击 **📥**，在弹出的保存对话框中选择位置，即得到一张包含今日日期与全部任务清单的 PNG 图片

### 数据说明

- 任务保存在 WebView 的 `localStorage`（key：`desknote_tasks_v1`）中，重启程序数据不丢失
- 卸载程序不会清除该数据；如需彻底重置，可在应用安装目录的 WebView 数据中清除，或开发模式下通过浏览器 DevTools 清除

### 常见问题

**Q：小组件被其他窗口挡住了？**
A：这是设计如此——小组件位于桌面底层，把窗口最小化或移开即可看到它，它永远不会遮挡你的工作窗口。

**Q：重启电脑 / Explorer 崩溃后小组件消失了？**
A：程序通过监听 `TaskbarCreated` 广播自动恢复。若小组件层级异常，重启程序即可。

**Q：能改位置或大小吗？**
A：当前版本固定为 390px 宽、右上角贴边。可修改 `src/App.vue` 中 `initDesktopWidget()` 的窗口尺寸与边距参数，以及 `src-tauri/src/lib.rs` 中 `set_window_to_bottom()` 的坐标计算后重新构建。

## 📁 项目结构

```
DeskNotes-Mini/
├── public/
│   └── ai-photos/            # 导出卡片使用的 AI 装饰插画
├── src/
│   ├── App.vue               # 全部界面与交互逻辑（任务 CRUD、卡片导出、窗口初始化）
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

### 修改窗口行为

- **窗口尺寸 / 位置**：`src/App.vue` → `initDesktopWidget()` 中的 `windowWidth`、`windowHeight`、`marginRight`、`marginTop`
- **窗口外观（边框、透明、任务栏）**：`src-tauri/tauri.conf.json` → `app.windows[0]`
- **Rust 侧定位逻辑**：`src-tauri/src/lib.rs` → `set_window_to_bottom()`

### 添加导出卡片装饰图

将 PNG 图片放入 `public/ai-photos/`，并把路径加入 `src/App.vue` 中的 `decorPhotos` 数组即可（导出时随机选用）。

## 🗺️ 路线图

- [ ] 支持拖拽改变位置与多屏适配
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
