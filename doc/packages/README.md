# 包文档

本文档索引 monorepo 中的 workspace 包。目录按引擎、React 适配、转换器和产品分层。

## 应用与产品层

### `@sue/verd-board-ui`（目录 `packages/product/ui`）

产品入口导出 `VerdFrame` 与 `ProductShell`。`VerdFrame` 按 `frameId` 挂载白板或领域 Frame，工具栏、属性面板和导入预览共用 `FrameCanvas`。画布模式见 [canvas-modes.md](./board/canvas-modes.md)。

### `@sue/verd-board-app`（目录 `packages/product/app`）

Web/Desktop 共用的应用壳与工作区生命周期。`WorkspaceApp` 经 `WorkspaceHost`（Desktop 文件系统 / Web IndexedDB）打开工作区，`WorkspaceSession` 持有各画布文件并组装成单一 CellStore；嵌入与详情编辑同一份 Cell，跨文件嵌入由 `frame-reference` 桥接。专业图可以用 `organization` 归属到一张普通画布，图表库和侧边栏读取单独的归属索引。画布按 `.verd.json` 文件条件提交，冲突显式解决；首次加载旧平铺存储自动迁移。桌面关闭窗口前等待会话 flush。

## React 包

| 包名                            | 目录                          | 说明                                                                                   |
| ------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `@sue/board-react`              | `packages/react/board`        | 统一 `FrameCanvas`、控制器、运行时 Hook、标准 `value/onChange` 与宿主 adapter/onIntent |
| `@sue/board-react-text`         | `packages/react/text`         | TipTap 文本运行时与 `BoardTextController`                                              |
| `@sue/board-react-mind`         | `packages/react/mind`         | `createMindFrameExtensions` 注册节点行为、树布局、媒体与概要括号渲染                   |
| `@sue/board-react-workflow`     | `packages/react/workflow`     | `createWorkflowFrameExtensions` 注册流程端口、边校验与布局                             |
| `@sue/board-react-architecture` | `packages/react/architecture` | `createArchitectureFrameExtensions` 注册层、模块与布局                                 |

## Board 引擎：`packages/engine`

| 包名                      | 目录                           | 说明                                                        |
| ------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `@sue/board-common`       | `packages/engine/common`       | 纯文本模型、编辑器属性、文本转换与测量                      |
| `@sue/board-core`         | `packages/engine/core`         | CellStore、原子事务、历史、索引、选择、共享几何与 Util 基类 |
| `@sue/board-layouts`      | `packages/engine/layouts`      | 树布局与通用 DAG 布局                                       |
| `@sue/board-draw`         | `packages/engine/draw`         | 几何图形、流程图符号、表格                                  |
| `@sue/board-mind`         | `packages/engine/mind`         | 原生中心/子主题、分支和概要边，树布局和事务命令             |
| `@sue/board-text`         | `packages/engine/text`         | 文本控制器的 mark、对齐、链接与剪贴板工具                   |
| `@sue/board-workflow`     | `packages/engine/workflow`     | 原生开始事件、任务、判断与边，成员索引和 DAG/process 校验   |
| `@sue/board-architecture` | `packages/engine/architecture` | 原生层、模块与依赖边，成员排布和共享正交路由                |

公开包通过 `vite build` 产出 `dist` ESM/CJS/d.ts/CSS；workspace 开发仍走 `exports.development` 源码入口，`publishConfig` 指向 dist。隔离 consumer 见 `scripts/test-consumer.mjs`。

领域 React 包只保留 Frame 扩展，旧 Canvas、SceneGraphic 和领域样式入口已删除。标准与宿主 API 见 [React 包文档](./react/README.md)。引擎与产品中的旧元素 API、插件和文档 reducer 已删除，旧格式转换移至应用私有迁移边界。

## 转换器：`packages/converters`

| 包名                           | 目录                                    | 说明                                                                             |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------- |
| `@sue/board-markdown-to-board` | `packages/converters/markdown-to-board` | `parseMarkdownToFrameSnapshot` / `serializeFrameToMarkdown`                      |
| `@sue/board-mermaid-to-board`  | `packages/converters/mermaid-to-board`  | `parseMermaidToFrameSnapshot` / `serializeFrameToMermaid`；流程/架构可指定 scene |

内部依赖一律使用 `workspace:*`。

E2E 在 `tests/web-e2e`，用 Playwright 验收 Web 产品路径。Markdown / Mermaid 导入联调走产品文本导入对话框；转换器用例在 `@sue/board-mermaid-to-board` 的 `tests/fixtures`。

转换器 API 与数据保留范围见 [Frame 转换器](./board/frame-converters.md)。

AI 生成可导入画布数据的完整字段表、元素目录、约束与示例见 [面向 AI 的画布数据生成规范](../guides/ai-canvas-data-spec.md)。

## 排列与 Group

六向对齐、等距分布、拖动参考线、显式自动排列、嵌套组与独立锁定的规则及 API 见 [对齐、自动排列与组合](./board/arrangement.md)。
