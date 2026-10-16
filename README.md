# 青编（VerdBoard）

一体化白板工具，支持思维导图、流程图、自由绘画等多种功能。

## 📖 文档

项目文档已迁移到 `doc/` 目录，请查看以下文档：

- **[产品概览](doc/product/产品概览.md)** - 定位、能力与文档索引
- **[项目架构](doc/architecture/ARCHITECTURE.md)** - 系统架构和技术栈
- **[开发指南](doc/development/)** - 开发环境搭建和规范
- **[包文档](doc/packages/)** - 各个包的详细文档
- **[使用指南](doc/guides/)** - 使用教程和示例
- **[面向 AI 的画布数据生成规范](doc/guides/ai-canvas-data-spec.md)** - AI 生成可导入画布数据的完整规范与示例

## 🚀 快速开始

```bash
# 安装依赖（会同步 Cursor skills）
pnpm install

# 启动开发环境（桌面端）
pnpm start

# 构建项目
pnpm build
```

## 📦 项目结构

```
verd-board/
├── apps/              # 应用层（web / desktop）
├── packages/          # 核心包（engine / react / converters / product）
├── tests/             # E2E 与 consumer 验收
├── doc/               # 项目文档
└── scripts/           # 构建脚本
```

## 🛠️ 技术栈

- **框架**: React 19.2.0
- **构建工具**: Vite 6.4.1 + Turbo
- **包管理**: pnpm 11.18.0
- **语言**: TypeScript 6.0.3
- **画图引擎**: Board 引擎（`@sue/board-*` 分包）
- **富文本**: TipTap 3.16.0
- **图标**: lucide-react 1.47.0

## AI 配置

本项目用 `@ylib/ai-config-manager` 管理 Cursor skills。行业通识不进 skill，只保留本仓口径：

- **项目 skill**: [`.agents/skills/verd-board-dev`](.agents/skills/verd-board-dev)
- **自动同步**: `pnpm install` 会执行 `node scripts/sync-skills.mjs`，按 [`.ai-config-manager/project.json`](.ai-config-manager/project.json) 对齐 `.agents/skills/`，并软链到 `.cursor/skills`
- **手动同步**: `pnpm skills:sync`
- **查看状态**: `pnpm skills:status`
- **常驻规则**: `.cursor/rules/`（`base.mdc`、`doc-guide.mdc`）
- CI 环境跳过同步

统一画布和转换器使用 Cell/Frame API。详见 [Frame 转换器](doc/packages/board/frame-converters.md)。

旧元素运行时和领域文档 API 已删除，旧格式转换仅在应用迁移模块内保留。完整交付状态见 [迁移验收](doc/architecture/ARCHITECTURE.md)。

The shared canvas and converters use the Cell/Frame API. See [Frame converters](doc/packages/board/frame-converters.md).

原生画布保留组合与批量文字格式、跨 Frame 移动、清空确认、网格、容器比例和脑图字体继承。生产入口加载 `@sue/verd-board-ui/style.css`。

The native canvas supports groups, batch typography, transfers between Frames, clear confirmation, grids, aspect presets and inherited mind topic typography. Product entrypoints load `@sue/verd-board-ui/style.css`.

Desktop 产品验收：先 `pnpm build:desktop`，再 `pnpm test:e2e:desktop`，在临时数据目录中验证保存、迁移及重启恢复。

Desktop acceptance: run `pnpm build:desktop` then `pnpm test:e2e:desktop` to verify saves, migration and restart recovery with temporary data.

画布支持六向对齐、等距分布、拖动参考线和显式自动排列；嵌套 Group 可整体操作、逐层编辑与独立锁定。规则与 API 见 [排列与组合](doc/packages/board/arrangement.md)。

The canvas supports six-way alignment, equal-gap distribution, drag snapping, explicit layouts, nested groups and independent group locking. Layouts affect the selection or the current Frame’s direct objects and preserve nested Frame contents.

产品属性使用画布外 300px Sidebar；节点名称与富文本正文独立，Port 按交互上下文显示，连线菜单支持双向箭头。语义与 API 见 [Sidebar 与节点交互](doc/packages/react/README.md#sidebar节点名称与连接交互)。

Product properties use a separate 300px Sidebar. Node names are independent of rich-text bodies, ports follow interaction context, and connectors support bidirectional arrows. See [Sidebar and node interactions](doc/packages/react/README.md#sidebar节点名称与连接交互).

Mind 节点按内容自适应，默认最大外框宽度为 240，长内容换行、高度不限；设置页提供全局默认，各图可单独覆盖。普通节点可通过「根据内容调整大小」适配选中内容。

Mind topics fit their content with a default maximum outer width of 240 and unlimited height. Application settings define the default, and each map can override it. Other supported nodes offer “Fit size to content” for the selection.

当前画布内容可在独立只读覆盖层中全屏演示，复用相同渲染扩展，支持点击聚焦、总览和激光笔；脑图与架构图提供结构步骤。`0` 总览、`L` 激光笔、`Esc` 退出并恢复编辑视口。演示状态只在内存中，不再生成或保存幻灯片稿，也不提供观众窗口。范围见 [画布模式](doc/packages/board/canvas-modes.md#演示)。

Present current canvas content in a separate read-only fullscreen overlay using the same render extensions, with click-to-focus, overview and a laser pointer; mind maps and architecture diagrams provide structural steps. Use `0` for overview, `L` for laser and `Esc` to exit and restore the editing viewport. Presentation state stays in memory, with no persisted slide deck or audience window. See [canvas modes](doc/packages/board/canvas-modes.md#演示).
