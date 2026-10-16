# VerdBoard 系统架构文档

## 项目概述

产品中文名为**青编**，英文名与代码、包名仍为 **VerdBoard**。**VerdBoard** 是一体化白板工具，支持思维导图、流程图、自由绘画，以及脑图 / 工作流的独占编辑器与常规白板上的特殊组件。项目分为两层：产品 **VerdBoard**（`@sue/verd-board-*`）与引擎 **Board**（`@sue/board-*`）。视图层以 **React** 为主，富文本基于 **TipTap**。画布模式约定见 [画布模式](../packages/board/canvas-modes.md)。

## 技术栈

### 核心技术

- **框架**: React 19.2.0（Provider 包 peer `react>=18`，隔离 consumer 以 React 18 + Vite 5 验收）
- **构建工具**: Vite 6.4.1 + Turbo (Monorepo)
- **包管理**: pnpm 11.18.0
- **语言**: TypeScript 6.0.3
- **画图引擎**: Board 引擎（`@sue/board-*`）
- **富文本**: TipTap 3.16.0
- **图标**: lucide-react 1.47.0
- **样式**: SCSS + CSS Modules

### 桌面端

- **Electron**: 28.3.3（EOL，本轮不升 major，评估见 [开发指南](../development/README.md#electron-2833-eol)）
- **打包**: electron-builder 24.9.1

### 测试

- **单元测试**: Vitest 3.0.8
- **E2E 测试**: Playwright 1.36.0

## 项目结构

```
verd-board/
├── apps/                          # 应用层
│   ├── desktop/                   # Electron 桌面应用
│   └── web/                       # Web 应用
│
├── packages/
│   ├── engine/                    # @sue/board-common, core, layouts, draw, mind, text, workflow, architecture
│   ├── react/                     # @sue/board-react, text, mind, workflow, architecture
│   ├── converters/                # markdown-to-board, mermaid-to-board
│   └── product/                   # @sue/verd-board-ui, @sue/verd-board-app
│
├── tests/
│   ├── consumer/                  # 隔离 consumer 验收
│   ├── fixtures/legacy/           # 旧文件与文本迁移夹具
│   └── web-e2e/                   # Playwright E2E
├── doc/
├── scripts/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 系统架构

产品的数据流为 `WorkspaceApp → WorkspaceSession → VerdFrame → FrameCanvas → CellRuntime`。WorkspaceSession 按文件持有各画布的 FrameFileV2 并组装成单一 CellStore 喂给画布；React 画布按 frameId 挂载根 Frame，`frame-reference` 引用壳在渲染时桥接到目标文件内容。白板嵌入与详情视图共用数据，领域 React 包只注册行为和布局扩展。具体挂载与接入规则见 [Cell/Frame 画布模式](../packages/board/canvas-modes.md)。

### 模型和事务

Cell 分为 Node、Edge、Group，Frame 是唯一带 children 的 Node。Frame.children 表达直接所有权和绘制顺序，Frame.groups 管理分组。场景由 mind-root、workflow-start 或 architecture-layer 锚点决定。普通节点不保存父级、children 或所属锚点。

公开快照为 `FrameSnapshot = {store: CellStore}`，主题放在 FrameCell.view，视口只存在于当前画布内存。历史、索引、选择、布局缓存和 DOM 引用只存在于运行时。 平移、缩放及适配不提交事务、不触发保存或撤销记录。重新进入画布自动适配；产品以纯内存导航栈逐层返回来源 Frame 并定位打开过的外壳，图像导出的临时画布关闭自动适配。

操作先在候选状态执行，维护关系、归一化并校验最终状态，成功后整体提交。历史记录实际改变 Cell 的事务前后值，因此 Frame、领域子树、关联边、成员和分组的级联删除可以完整撤销。校验拒绝重复 id、多父级、层级环、跨 Frame 关系与混合场景。少于两个有效成员的 Group 自动解散，选择使用 Frame/Group 聚焦路径。

### 包职责与公共接入

| 包                                            | 职责                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| @sue/board-core                               | Cell 类型、事务、历史、索引、选择、坐标、复制闭包、Util 基类与共享几何 |
| @sue/board-draw                               | 绘图 Cell 工厂与 Util；从 core 几何生成 Rough 路径                     |
| @sue/board-mind、workflow、architecture       | 原生领域 Cell、校验、命令与布局                                        |
| @sue/board-react                              | 唯一 FrameCanvas、控制器、运行时 Hook、渲染扩展                        |
| @sue/board-react-mind、workflow、architecture | 注册领域行为和布局扩展                                                 |
| @sue/board-react-text                         | TipTap 富文本编辑；DocumentEditor 独立文档编辑器                       |
| @sue/verd-board-ui                            | VerdFrame 的产品工具、属性、导入预览与导航；文件树、Tabs、设置与空态   |
| @sue/verd-board-app                           | WorkspaceSession、WorkspaceHost（fs/IndexedDB）、文件分区、迁移入口    |

标准画布使用 value/onChange，变化包含新快照与事务。第三方画布使用 adapter.toFrameSnapshot(value) 和 onIntent，业务数据由宿主持有；接受、拒绝、异步等待、只读、外部历史和自定义渲染共用这一 API。

### 几何和文本

形状路径、内部线条、文字区域、边界端口、正交路由、箭头、标签位置和命中位于 core/geometry。产品全部 65 种白板形状都使用原生几何。旋转节点的命中转换到局部坐标，端口和路由共享实际轮廓。Rough 绘制位于 draw，通过稳定 Cell id 生成种子，不依赖旧元素投影。

静态文字由 FrameRichText 渲染 BoardTextDocument 的内容与标记；编辑由共享 TipTap 组件提交 Cell 事务。双击期间不立即捕获指针给 SVG，拖动超过阈值后才启用捕获。Frame 缩放只改变外壳，内容通过居中缩小变换显示；根不画外壳，详情保留内容坐标。

### 持久化和迁移

工作区有两类一等文件：画布（`.verd.json`，FrameFileV2，含自身 Frame 根与直接拥有的非 Frame Cell，group 成员按传递闭包归属）与独立文档（`.verd-doc.json`，DocumentFileV1，正文为 `BoardTextDocument`，文件 id 与正文 id 一致）。两类文件共用文件树、标签页、存储、回收站与统一撤销历史。画布文件之间用 `frame-reference` 引用壳互链——壳保存自身几何、外观与实例级思维导图偏移，目标只记稳定 `targetFrameId`，因此同一文件可被多处嵌入、各自独立摆放且内容共享。

FrameFileV2 可以带可选的 `organization`：缺省是尚未整理的旧文件，仍作为独立入口；`standalone` 是明确的独立图表；`subgraph` 只允许思维导图、流程图和架构图，且只能挂在一张普通画布下，层级只有两级。归属和引用图是两套索引。改归属或提升为独立图表只刷新导航，不改图表类型，也不重置相机、选择和编辑状态。复制闭包同时包含引用依赖和该画布拥有的子图，但不会顺着归属把父画布拉进来。整理一批归属是一次条件提交、一步撤销；撤销只补丁 organization 字段，不拿旧快照覆盖后来同步的内容。组织变更不移动物理文件。工作区内部元数据（配置、会话导航、回收区、版本、事务日志）放在 `.verdboard/` 目录。

存储经 `WorkspaceHost` 抽象：Desktop 落到真实文件夹（`prepared→applying→applied` 事务日志保证崩溃恢复），Web 落到 IndexedDB 虚拟目录。写入全部携带 expectedVersion 做条件提交；外部变更经订阅进入会话，与本地脏状态冲突时显式走 load-disk / keep-local / save-copy 解决。`WorkspaceSession` 是唯一的写入入口：命令先构建候选文件图、跑分区与身份/循环校验，成功才更新内存、统一历史和去抖保存队列；撤销/重放走同一条校验管线。历史元数据带 group/name/primaryFileId/selection，连续同组文档输入合并为一步，undo/redo 恢复编辑器选区；`flush()` 对 I/O 失败返回 `false` 以便显式重试。应用注册 `host.onShutdown(flush)`：Desktop 退出前等待落盘，Web 用 pagehide/beforeunload 做 best-effort flush。

首次打开旧版平铺存储（manifest+frames 记录或更早的领域键）时，`migrateLegacyCellWorkspace` 组装成快照，再由 `partitionCellStore` 拆成 `.verd.json` 文件导入新工作区——嵌套 Frame 自动外置为独立文件并以引用互联。旧存储边界保留只读与修复写路径供迁移使用；旧 `VerdBoardApp` 与平铺保存队列已删除。迁移先备份再提交，缺失或损坏数据报告错误，不默认替换为空文档。

### 转换器

Markdown/Mermaid 直接读写 FrameSnapshot，产品导入预览也使用 FrameCanvas。具体 API、支持场景和格式保留范围见 [Frame 转换器](../packages/board/frame-converters.md)。`@sue/board-markdown-to-text` 在 Markdown 与 `BoardTextDocument` 之间双向转换（CommonMark + GFM：标题、列表、链接、图片、引用、代码块、表格），用于文档的 `.md` 导入导出；无法表达的结构降级为可读文本并返回告警。

## 迁移与发布验收

Cell/Frame 运行时迁移已落地：产品入口只运行 FrameCanvas，原有产品 E2E 已迁到新画布。旧产品画布、引擎元素 API、插件、领域文档 reducer 和流程 key 前缀运行路径已删除；旧 JSON 定义及前向转换器仅存在于应用的私有 migration/legacy 边界。发布准备使用 major changeset，尚未执行发布。

体验回归尚未完成。迁移后的操作方式、富文本、全屏工具、脑图布局与文件流程以 `8d6b923` 为基准恢复，验收清单见 [体验回归验收](../guides/体验回归验收.md)。在该清单全部关闭，并且类型检查、单测、lint、公开包与两端构建、完整产品 E2E 和严格 consumer 重新通过之前，不能把运行时迁移写成体验验收已通过。

验收要求同时满足产品只跑新运行时、全部现有功能保留、旧数据可靠迁移、旧底座删除，以及 pnpm typecheck、单测、Web/Desktop 前端构建、全部产品 E2E 和隔离 consumer 通过。只通过新增测试或构建命令退出成功不足以宣称完成。类型声明生成发现错误会直接使构建失败。

当前测试入口是 core/cell 与 core/geometry 的内核用例，各领域 cell-utils 用例，app 的 frame-files / workspace-host 契约 / workspace-session / canvas-session / migration / workspace-app 用例，provider.spec.ts 的宿主接入，以及 tests/desktop-e2e 的实际 Electron 存储与生命周期测试。发布准备使用 major changeset，不自动发布。

| 阶段         | 实现与通过的验收覆盖                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型与几何   | Cell 类型、65 种原生形状、共享端口与路由、Rough 路径；全部形状绘制、轮廓擦除与实际导出                                                                                            |
| 事务与 Frame | 候选状态校验、完整级联历史、索引、分组、复制闭包、嵌套坐标；标准/宿主接受拒绝、异步、只读、外部历史与隔离 consumer                                                                |
| Architecture | 层排序、最后层保护、模块归属与固定位置、跨层依赖路由、自连接拒绝；嵌入/详情、撤销与刷新                                                                                           |
| Workflow     | 稳定成员与端口、DAG 拒绝循环、process 循环、多图隔离、图原点与自动布局；开始事件保护及不依赖 ID 顺序的布局                                                                        |
| Mind         | 改父级/重排、概要范围、折叠、媒体与笔记；九种布局、粘贴身份转换、文字样式继承和原有快捷操作                                                                                       |
| 白板与产品   | 绘图、文本、箭头、表格、泳道、折线、缩放旋转与图像导出；Popover、剪贴板、组合拖动对齐、批量文字、清空确认、跨 Frame 转移、网格、比例及触控笔保护                                  |
| 存储与迁移   | 文件级持久化与条件提交、回收区与身份还原、统一历史与保存队列、外部同步与冲突解决、引用渲染与复制闭包；旧领域混合 fixture、共享副本、ID 冲突、未挂载文档、原样备份、损坏与失败重试 |
| 清理与发布   | 旧运行时/公开 API 删除、双语文档与 major changeset；类型、单测、lint、两端构建、完整产品 E2E 和严格 consumer                                                                      |

2026-10-10 验收：typecheck、全部单测、lint、公开包/Web 构建和最新 Desktop 构建通过；Web 生产构建运行全部 70 项产品 E2E，最新 Electron 运行全部 4 项生命周期 E2E，均通过。隔离 consumer 使用 React 18、TypeScript 5、skipLibCheck=false，验证公开类型、产品 CSS 导出和实际打包通过。最终回归修复了生产入口漏载提取 CSS、架构属性编辑丢失派生 y，以及流程开始事件因 ID 排序被任务覆盖的问题。单测总计 356 项（全量 355 项通过后，流程领域加入定位回归并再次通过其全部 5 项）。

白板组合保持连续图层块；流程/架构组合保留原绘制顺序，组关系与领域归属使用独立索引。批量外观/文字不穿透嵌套 Frame；剪切在校验与剪贴板写入成功后提交删除。浏览器离开页面时的异步保存仍为尽力 flush，Electron 关闭则等待保存队列确认提交；两端的生命周期保证按此边界验收。

## 贡献指南

### 开发环境

```bash
# 安装依赖
pnpm install

# 启动开发
pnpm start

# 运行测试
pnpm test

# 构建
pnpm build
```

### 代码规范

- **ESLint**: 代码检查
- **Prettier**: 代码格式化
- **TypeScript**: 类型检查

### 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试
chore: 构建/工具
```

---

**最后更新**: 2026-09-20
**版本**: 0.0.1（workspace 预发布基线，以各包 `package.json` 为准）

2026-10-14 排列与 Group 验收：类型检查、全量 610 项单测、lint、Web/Desktop 最新构建、生产 Web 全部 127 项 E2E、Desktop 全部 7 项 E2E，以及隔离 consumer 的严格类型、构建和浏览器运行时全部通过。新增六向对齐、等距分布、拖动参考线、显式自动排列、嵌套组与独立锁定；Mind 保持树布局，Workflow/Architecture 模块的旧派生位置在加载/导入边界物化。规则与 API 见 [排列与组合](../packages/board/arrangement.md)。
