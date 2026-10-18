# 青编（VerdBoard）

画布与文档共存的本地工作区，支持白板、思维导图、流程图、架构图与独立文字稿。

## 📖 文档

项目文档和架构图直接保存在仓库根 [`workspace/`](workspace/)；桌面端开发默认打开该目录。文档正文使用 `.verd-doc.json`，画布使用 `.verd.json`，两者均可在产品中直接编辑。

- **[文档导航](workspace/文档/文档导航.verd-doc.json)** / **[English](workspace/文档/Documentation.verd-doc.json)**
- **[产品概览](workspace/文档/产品/产品概览.verd-doc.json)** / **[系统架构](workspace/文档/架构/系统架构.verd-doc.json)**
- **[开发指南](workspace/文档/开发/开发指南.verd-doc.json)** / **[桌面安装与使用](workspace/文档/指南/桌面安装与使用.verd-doc.json)**
- **[包索引](workspace/文档/包/包索引.verd-doc.json)** / **[React 接入](workspace/文档/包/React接入.verd-doc.json)**
- **[AI 画布数据规范](workspace/文档/指南/AI画布数据规范.verd-doc.json)** / 配套输入 [`tests/fixtures/ai-canvas/`](tests/fixtures/ai-canvas/)
- **[文档维护指南](workspace/文档/开发/文档维护指南.verd-doc.json)**

Open the root `workspace/` folder in Desktop to read and edit native documentation and architecture diagrams. Native files are the maintained source; Markdown remains an optional import/export format.

## 🚀 快速开始

```bash
# 安装依赖（会同步 Cursor skills）
pnpm install

# 启动开发环境（桌面端）
pnpm start

# 构建公开包和 Web（不含 Desktop）
pnpm build

# 构建 Desktop
pnpm build:desktop

# 校验项目工作区
pnpm workspace:check
```

## 📦 项目结构

```
verd-board/
├── apps/              # 应用层（web / desktop）
├── packages/          # 核心包（engine / react / converters / product）
├── tests/             # E2E 与 consumer 验收
├── workspace/         # 原生项目文档与可编辑架构图
└── scripts/           # 构建脚本
```

## 🛠️ 技术栈

- **框架**: React
- **构建工具**: Vite + Turbo
- **包管理**: pnpm 11.18.0
- **语言**: TypeScript
- **画图引擎**: Board 引擎（`@sue/board-*` 分包）
- **富文本**: TipTap
- **图标**: lucide-react

依赖版本以各层 `package.json`、`pnpm-workspace.yaml` 的 overrides 和 `pnpm-lock.yaml` 为准。

## AI 配置

本项目用 `@ylib/ai-config-manager` 管理 Cursor skills。行业通识不进 skill，只保留本仓口径：

- **项目 skill**: [`.agents/skills/verd-board-dev`](.agents/skills/verd-board-dev)
- **自动同步**: `pnpm install` 会执行 `node scripts/sync-skills.mjs`，按 [`.ai-config-manager/project.json`](.ai-config-manager/project.json) 对齐 `.agents/skills/`，并软链到 `.cursor/skills`
- **手动同步**: `pnpm skills:sync`
- **查看状态**: `pnpm skills:status`
- **常驻规则**: `.cursor/rules/`（`base.mdc`、`doc-guide.mdc`）
- CI 环境跳过同步

统一画布和转换器使用 Cell/Frame API。详见 [Frame 转换器](workspace/文档/包/格式转换器.verd-doc.json)。

旧元素运行时和领域文档 API 已删除，旧格式转换仅在应用迁移模块内保留。完整交付状态见 [迁移验收](workspace/文档/架构/系统架构.verd-doc.json)。

The shared canvas and converters use the Cell/Frame API. See [Frame converters](workspace/文档/包/格式转换器.verd-doc.json).

原生画布保留组合与批量文字格式、跨 Frame 移动、清空确认、网格、容器比例和脑图字体继承。生产入口加载 `@sue/verd-board-ui/style.css`。

The native canvas supports groups, batch typography, transfers between Frames, clear confirmation, grids, aspect presets and inherited mind topic typography. Product entrypoints load `@sue/verd-board-ui/style.css`.

Desktop 产品验收：先 `pnpm build:desktop`，再 `pnpm test:e2e:desktop`，在临时数据目录中验证保存、迁移及重启恢复。

Desktop acceptance: run `pnpm build:desktop` then `pnpm test:e2e:desktop` to verify saves, migration and restart recovery with temporary data.

画布支持六向对齐、等距分布、拖动参考线和显式自动排列；嵌套 Group 可整体操作、逐层编辑与独立锁定。规则与 API 见 [排列与组合](workspace/文档/包/排列与组合.verd-doc.json)。

The canvas supports six-way alignment, equal-gap distribution, drag snapping, explicit layouts, nested groups and independent group locking. Layouts affect the selection or the current Frame’s direct objects and preserve nested Frame contents.

产品属性使用画布外 300px Sidebar；节点名称与富文本正文独立，Port 按交互上下文显示，连线菜单支持双向箭头。语义与 API 见 [Sidebar 与节点交互](workspace/文档/包/React接入.verd-doc.json)。

Product properties use a separate 300px Sidebar. Node names are independent of rich-text bodies, ports follow interaction context, and connectors support bidirectional arrows. See [Sidebar and node interactions](workspace/文档/包/React接入.verd-doc.json).

Mind 节点按内容自适应，默认最大外框宽度为 240，长内容换行、高度不限；设置页提供全局默认，各图可单独覆盖。普通节点可通过「根据内容调整大小」适配选中内容。

Mind topics fit their content with a default maximum outer width of 240 and unlimited height. Application settings define the default, and each map can override it. Other supported nodes offer “Fit size to content” for the selection.

工作区文件夹可整体移入回收站并还原；回收站支持确认后永久删除单项或清空。侧栏底部和画布「更多」菜单打开「我的」管理个人偏好；顶部工作区名称菜单打开工作区设置，分为基本设置和当前工作区回收站，Desktop 目录切换也位于此菜单。文件树完整显示真实目录，所属画布下另列图表快捷入口，两处共用源文件。

Workspace folders move to trash and restore as complete subtrees. Confirm before permanently deleting an item or emptying trash. My opens from the sidebar or canvas More menu for device preferences. Workspace settings have separate General and Trash sections. Workspace settings and Desktop folder actions are grouped under the workspace name at the top of the sidebar. The file tree shows actual paths and marked owner-canvas shortcuts, both opening the same source.

当前画布内容可在独立只读覆盖层中全屏演示，复用相同渲染扩展，支持点击聚焦、总览和激光笔；脑图与架构图提供结构步骤。`0` 总览、`L` 激光笔、`Esc` 退出并恢复编辑视口。演示状态只在内存中，不再生成或保存幻灯片稿，也不提供观众窗口。范围见 [画布模式](workspace/文档/包/画布模式.verd-doc.json)。

Present current canvas content in a separate read-only fullscreen overlay using the same render extensions, with click-to-focus, overview and a laser pointer; mind maps and architecture diagrams provide structural steps. Use `0` for overview, `L` for laser and `Esc` to exit and restore the editing viewport. Presentation state stays in memory, with no persisted slide deck or audience window. See [canvas modes](workspace/文档/包/画布模式.verd-doc.json).
