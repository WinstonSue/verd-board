# 青编（VerdBoard）文档中心

<div align="center">

**一体化白板工具 - 思维导图 · 流程图 · 自由绘画**

[English](./README_en.md) | 简体中文

</div>

## 📖 文档导航

### 📋 [产品概览](./product/产品概览.md)

产品定位、核心能力、形态与文档索引（面向产品与非研发读者）

### 🏗️ [架构文档](./architecture/ARCHITECTURE.md)

系统架构、技术栈和设计理念

### 👨‍💻 [开发指南](./development/README.md)

开发环境搭建、规范和贡献流程

### 📦 [包文档](./packages/README.md)

所有包的详细文档和 API

### 📚 [使用指南](./guides/)

安装配置和使用教程；[面向 AI 的画布数据生成规范](./guides/ai-canvas-data-spec.md) 覆盖全部原生元素、文件格式、约束与可直接导入的示例

### 📝 [文档维护指南](./DOCUMENTATION_GUIDE.md)

文档语言策略和维护规范

> **文档语言说明**: 主文档保持中英双语，开发文档以中文为主。详见[文档维护指南](./DOCUMENTATION_GUIDE.md)。

## 🚀 快速开始

### 环境要求

- Node.js >= 22
- pnpm >= 11.18.0

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
# 启动 Desktop 桌面应用 (默认)
pnpm start
# 或
turbo run dev --filter=desktop

# 启动 Web 开发服务器
turbo run dev --filter=web

# 启动所有应用
turbo run dev
```

### 构建

```bash
# 构建所有包和应用
pnpm build

# 仅构建 Web 应用
pnpm build:web

# 仅构建 Desktop 应用
pnpm build:desktop
```

Desktop 真实产品验收先运行 `pnpm build:desktop`，再运行 `pnpm test:e2e:desktop`。测试使用临时数据目录验证关闭保存、重启、迁移和失败重试。

## 📦 项目结构

```
verd-board/
├── apps/
│   ├── desktop/          # Electron 桌面应用
│   └── web/              # Web 应用
├── packages/
│   ├── engine/           # @sue/board-common, core, layouts, draw, mind, text, workflow
│   ├── react/            # @sue/board-react, @sue/board-react-text, @sue/board-react-mind, @sue/board-react-workflow
│   ├── converters/       # markdown-to-board, mermaid-to-board
│   └── product/          # @sue/verd-board-ui, @sue/verd-board-app
├── tests/
│   ├── consumer/         # 隔离 consumer 验收
│   ├── fixtures/         # 旧文件与文本迁移夹具
│   └── web-e2e/          # Playwright E2E 测试
├── doc/                  # 项目文档
│   ├── product/          # 产品概览
│   ├── architecture/     # 架构文档
│   ├── development/      # 开发指南
│   ├── packages/         # 包文档
│   └── guides/           # 使用指南
└── scripts/              # 构建脚本
```

## ✨ 核心特性

- **🧠 思维导图、流程图、架构图** - 领域节点保存为 Cell；React 扩展共用 FrameCanvas
- **脑图概要** - 原生括号可拖动调整首尾兄弟范围；嵌入与详情共用事务，删除覆盖主题后收缩并支持撤销
- **📊 流程图** - 丰富的几何图形库和流程图符号
- **✏️ 自由绘画** - 手绘风格线条、箭头、表格等绘图工具
- **📝 富文本编辑** - 基于 TipTap 3.16.0,支持标题、列表、表格等多种格式
- **🎨 主题系统** - 多种内置主题和自定义主题
- **⚡ 高性能** - 基于 SVG 渲染，流畅的交互体验
- **🔌 扩展** - 通过 Cell Util、注册器和 React 渲染扩展新增能力
- **🧩 Provider** - 统一 FrameCanvas 提供受控 FrameSnapshot 与第三方 adapter/onIntent；领域包提供注册和布局扩展
- **原生交互** - 组合与批量文字格式、跨 Frame 移动、清空确认、网格、容器比例和脑图字体继承共用事务与保存队列；生产入口加载 `@sue/verd-board-ui/style.css`
- **演示** - 独立只读覆盖层全屏展示当前画布内容，复用相同渲染扩展，支持点击聚焦、总览和激光笔；脑图与架构图支持结构步骤。`0` 总览、`L` 激光笔、`Esc` 退出并恢复编辑视口。状态不写入文档；不包含幻灯片编排、备注、笔迹、计时、自动播放或观众窗口

## 🛠️ 技术栈

- **前端框架**: React 19.2.0
- **构建工具**: Vite 6.4.1 + Turbo
- **包管理**: pnpm 11.18.0
- **语言**: TypeScript 6.0.3
- **画图引擎**: Board 引擎（`@sue/board-*` 分包）
- **富文本编辑器**: TipTap 3.16.0
- **图标**: lucide-react 1.47.0
- **桌面端**: Electron 28.0.0
- **样式**: SCSS + CSS Modules

## 🏗️ 架构设计

VerdBoard 使用 CellStore 作为唯一运行时数据源，白板和领域图共用 FrameCanvas：

### 核心层 (Board Engine)

- Cell/Frame 模型、事务、历史、索引与选择
- 共享几何、端口、正交路由、箭头和命中
- 按 kind 注册的 Util 基类与渲染扩展

### 领域与绘图层

- **Draw Cells** - 绘图功能
- **Mind Cells** - 思维导图
- **Text Controller** - TipTap 文本编辑
- **Frame View** - 主题持久化与内存视口

### 视图层 (React)

- React 组件封装
- 状态管理
- 用户交互

## 📝 最新更新

### 最新更新 (2026-03)

- ✅ 文本栈统一为 TipTap / ProseMirror JSON（`BoardTextDocument`）
- ✅ 目录收口为 `packages/engine`、`packages/react`、`packages/converters`、`packages/product`
- ✅ 文件格式升级为 `.verdboard` v2，旧 `.drawnix` 只读迁移

## 🙏 致谢

- [TipTap](https://tiptap.dev/) - 现代化的富文本编辑器
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架

---

<div align="center">
Made with ❤️ by VerdBoard Team
</div>

Markdown/Mermaid 直接读写 FrameSnapshot；产品文本导入使用统一画布预览。API 和保留范围见 [Frame 转换器](./packages/board/frame-converters.md)。

画布的六向对齐、等距分布、智能参考线、显式自动排列和嵌套 Group 锁定共用事务与保存；布局作用于选择或当前 Frame 直接对象，保留嵌套 Frame 内容。详见 [排列与组合](./packages/board/arrangement.md)。

属性 Sidebar 位于画布外、固定宽 300px；节点名称与画布正文独立，交互 Port 按上下文显示，支持双向箭头。详见 [Sidebar 与节点交互](./packages/react/README.md#sidebar节点名称与连接交互)。

Mind 内容自适应与最大宽度、普通节点的「根据内容调整大小」见 [节点内容适配](./packages/board/mind-features.md#节点内容适配与最大宽度)。
