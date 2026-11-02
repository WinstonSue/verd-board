# 青编（VerdBoard）

画布与文档共存的本地工作区，支持白板、思维导图、流程图、架构图、UML 类图、UML 时序图与独立文字稿。

通用画布中的 Frame 默认显示实时矢量预览，双击原位编辑，通过标题栏打开详情。预览保持实时矢量内容和原生清晰度；性能采样与运行时升级的验收记录见原生「体验回归验收」。

## 📖 文档

内置项目工作区以“文档导航”为主入口，首次打开或手动全量更新后从文档开始阅读，已有会话继续恢复。项目文档和架构图直接保存在仓库根 [`workspace/`](workspace/)；桌面端开发默认使用该目录的独立副本，维护文档需主动打开原目录。文档正文使用 `.verd-doc.json`，画布使用 `.verd.json`，两者均可在产品中直接编辑。

- **[文档导航](workspace/文档导航.verd-doc.json)** / **[English](workspace/Documentation.verd-doc.json)**
- **[产品概览](workspace/文档/产品/产品概览.verd-doc.json)** / **[系统架构](workspace/文档/架构/系统架构.verd-doc.json)**
- **[开发指南](workspace/文档/开发/开发指南.verd-doc.json)** / **[桌面安装与使用](workspace/文档/指南/桌面安装与使用.verd-doc.json)**
- **[包索引](workspace/文档/包/包索引.verd-doc.json)** / **[React 接入](workspace/文档/包/React接入.verd-doc.json)**
- **[AI 画布数据规范](workspace/文档/指南/AI画布数据规范.verd-doc.json)** / 配套输入 [`tests/fixtures/ai-canvas/`](tests/fixtures/ai-canvas/)
- **Agent 工具与范式库**：`@sue/verd-board-agent` 提供 `verd` CLI 与 Skill（本仓可用 `pnpm agent describe --json`）；独立内容包 `@sue/verd-board-agent-patterns` 维护原生模板与规则。Desktop 工作区菜单可打开安装后的可编辑副本，首次复制、后续保留修改。新建或打开工作区会初始化 `.verdscrolls`、项目根 `AGENTS.md` 和共享工具链接；AI 通过项目内 `.verdscrolls/shared/bin/verd context --json` 获取项目身份、简介和入口。Desktop 内置独立 Node 与完整 CLI，无需全局安装。
- **[文档维护指南](workspace/文档/开发/文档维护指南.verd-doc.json)**

The built-in project workspace starts with document navigation. Open the root `workspace/` folder in Desktop to read and edit native documentation, then follow links to architecture diagrams. Native files are the maintained source; Markdown remains an optional import/export format.

<a id="npm-2"></a>

## npm 2.0.0：第三方接入

20 个公开包统一为 `2.0.0`，发布到阿里云，保持独立包和原有包名。3 个首次发布包：`@sue/board-markdown-to-text`、`@sue/board-uml`、`@sue/board-react-uml`。各包 README 附安装和可编译示例，CHANGELOG 说明相对已发布 `1.0.0` 的变化。

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

将上述配置放入消费项目 `.npmrc`，向仓库管理员申请两个仓库的读权限并在用户配置或 CI secret 中提供令牌。产品包还依赖 `@ylib/tabs`，因此需要两个 scope 的配置。不要提交访问令牌。

- 完整文件工作区：安装 `@sue/verd-board-app@2.0.0`、`@sue/verd-board-ui@2.0.0`、React/React DOM，使用 `WorkspaceApp`。
- 嵌入产品画布：使用 `@sue/verd-board-ui` 的 `VerdFrame`；仅需底层画布则使用 `@sue/board-react` 的 `FrameCanvas` 及场景引擎/扩展。
- 独立文字：使用 `@sue/board-react-text` 的 `DocumentEditor`；Markdown 文档使用 `@sue/board-markdown-to-text`，Mind Markdown 使用 `@sue/board-markdown-to-board`。
- UML：`@sue/board-uml` + `@sue/board-react-uml` 注册到同一个 `FrameCanvas`，Mermaid 转换器新增 `uml-class`/`uml-sequence` 场景。

**1.0 → 2.0 主要破坏性变更：** `VerdBoardApp({adapter})` 改为 `WorkspaceApp({host})`；`createWorkspaceSaveQueue`、`collectWorkspaceRevisions`、`createEmptyWorkspaceRecord` 已删除。新工作区由 `WorkspaceSession` 经 `WorkspaceHost` 提交 `.verd.json` 与 `.verd-doc.json` 文件。`BoardTextController` 仅新增可选 `getActiveAlign`；依赖穷尽类型分支的宿主需适配扩展后的 Cell 联合类型。

`FrameCanvas` 在已发布的 1.0.0 中已经存在，两种受控模式仍保留；不要把更早的 BoardCanvas 重构当作本次新增变更。Markdown 转换器保留旧前两个参数，第三个选项为兼容新增。其他各包的新增/签名变化与统一发版原因见各包 changelog。

<!-- consumer-example -->

```tsx
import { useMemo } from 'react';
import { WorkspaceApp, createWebWorkspaceHost, createWebStorageAdapter, migrateLegacyCellWorkspace } from '@sue/verd-board-app';
import '@sue/verd-board-ui/style.css';
export function App() {
  const host = useMemo(() => createWebWorkspaceHost(), []);
  return (
    <WorkspaceApp
      host={host}
      importLegacy={async () => {
        const adapter = createWebStorageAdapter();
        return (await adapter.listKeys()).length ? migrateLegacyCellWorkspace(adapter) : null;
      }}
    />
  );
}
```

组件面向浏览器，React 18/19。产品入口必须加载 `@sue/verd-board-ui/style.css`；底层画布/独立文本加载 `@sue/board-react-text/style.css`。`importLegacy` 仅用于未初始化的可写默认工作区；自定义旧 adapter 可在此回调交给 `migrateLegacyCellWorkspace`。不要假定新建 host 会自动读取旧应用数据。`flush()` 返回 `false` 表示仍有未保存内容或冲突。

完整指南：[2.0 接入与迁移](workspace/文档/包/2.0接入与迁移.verd-doc.json)，以及 [应用包接入](packages/product/app/README.md)、[画布接入](packages/react/board/README.md)、[独立文档](packages/react/text/README.md)、[UML](packages/react/uml/README.md)。

The 2.0 release replaces `VerdBoardApp(adapter)` with `WorkspaceApp(host)`, adds file workspaces, standalone documents and native UML. `FrameCanvas` already shipped in 1.0. Both private registries require read access; see each package README for installable examples and CSS entrypoints.

## 🚀 快速开始

```bash
# 安装依赖（会同步 Cursor skills）
pnpm install

# 启动源码开发（独立的 VerdBoard Dev；dev / start 为别名）
pnpm dev:desktop

# 日常 Desktop E2E：自动启动隔离 dev，无需构建
pnpm test:e2e:desktop

# 构建公开包和 Web（不含 Desktop）
pnpm build

# 构建 Desktop
pnpm build:desktop

# 正式安装包（macOS 默认 DMG；--with-zip 额外生成 ZIP）
pnpm package:desktop

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

Desktop 日常验证使用 `pnpm test:e2e:desktop`；生产专项先 `pnpm build:desktop`，再 `pnpm test:e2e:desktop:prod`。开发数据位于 `appData/VerdBoard Dev`，默认工作区首次复制后保留；测试使用临时目录。日常流程不打包、安装或操作正式应用。

Daily Desktop tests run real dev with `pnpm test:e2e:desktop`. Production acceptance uses `pnpm build:desktop` then `pnpm test:e2e:desktop:prod`, with temporary data.

画布支持六向对齐、等距分布、拖动参考线，以及独立的节点布局和连线整理；普通白板支持按连接关系布局，Group 支持局部布局、逐层编辑与独立锁定。规则与 API 见 [排列与组合](workspace/文档/包/排列与组合.verd-doc.json)。

The canvas supports alignment, equal-gap distribution, drag snapping, separate node layout and edge rerouting, and connection-based whiteboard layouts. Layouts can target Group contents or the current focused container; nested groups stay rigid, nested Frame contents remain intact, and conflicting layouts leave the document unchanged.

内置工作区的第九张专题图介绍自动布局与连线算法：范围解析、循环关系分层、减少交叉、正交避障、优化与重置，以及自动计算的触发和保存边界。完整用法与算法流程见原生[排列与组合](workspace/文档/包/排列与组合.verd-doc.json)。两个自动开关默认关闭；普通自动路径仅在运行时派生，显式优化保存可编辑折点，自动计算结果合入原编辑的一次事务。

The ninth built-in topic diagram explains layout scope, cycle-aware layering, crossing reduction, orthogonal obstacle routing, optimization/reset, and automatic calculation. See [layout and routing](workspace/文档/包/排列与组合.verd-doc.json). Both automatic switches default to off. Ordinary routes remain derived in memory; explicit optimization stores editable waypoints, and automatic results join the triggering edit in one transaction.

产品属性使用画布外 300px Sidebar；节点名称与富文本正文独立，Port 按交互上下文显示，连线菜单支持双向箭头。语义与 API 见 [Sidebar 与节点交互](workspace/文档/包/React接入.verd-doc.json)。

Product properties use a separate 300px Sidebar. Node names are independent of rich-text bodies, ports follow interaction context, and connectors support bidirectional arrows. See [Sidebar and node interactions](workspace/文档/包/React接入.verd-doc.json).

Mind 节点按内容自适应，默认最大外框宽度为 240，长内容换行、高度不限；设置页提供全局默认，各图可单独覆盖。普通节点可通过「根据内容调整大小」适配选中内容。

Mind topics fit their content with a default maximum outer width of 240 and unlimited height. Application settings define the default, and each map can override it. Other supported nodes offer “Fit size to content” for the selection.

工作区文件夹可整体移入回收站并还原；回收站支持确认后永久删除单项或清空。侧栏底部和画布「更多」菜单统一打开「设置」，管理个人外观、编辑及当前工作区的常规、数据维护和回收站；顶部名称打开工作区切换器。所有内容页统一浏览文件和图表，Cmd/Ctrl+P 快速打开文件。文件树完整显示真实目录，所属画布下另列图表快捷入口，两处共用源文件。

应用支持浅色、深色和跟随系统，默认跟随系统；在「设置 → 外观」即时切换并记住本机选择。经典、缤纷、柔和、复古、清新、海洋六个画布主题均提供深浅变体，画布、独立和嵌入文档的未标记富文本颜色同步适配；仅明确标为 custom 的文字色保留，支持逐项恢复主题。图像导出可选择当前外观、浅色或深色。 主题通过五种颜色角色、三级强调和六组协调色为流程、架构、UML、形状、表格及泳道提供领域配色；完整映射与色板维护在原生系统架构文档。

Workspace folders move to trash and restore as complete subtrees. Confirm before permanently deleting an item or emptying trash. My opens from the sidebar or canvas More menu for device preferences. Workspace settings have separate General and Trash sections. Workspace settings and Desktop folder actions are grouped under the workspace name at the top of the sidebar. The file tree shows actual paths and marked owner-canvas shortcuts, both opening the same source.

当前画布内容可在独立只读覆盖层中全屏演示，复用相同渲染扩展，支持点击聚焦、总览和激光笔；脑图与架构图提供结构步骤。`0` 总览、`L` 激光笔、`Esc` 退出并恢复编辑视口。演示状态只在内存中，不再生成或保存幻灯片稿，也不提供观众窗口。范围见 [画布模式](workspace/文档/包/画布模式.verd-doc.json)。

Present current canvas content in a separate read-only fullscreen overlay using the same render extensions, with click-to-focus, overview and a laser pointer; mind maps and architecture diagrams provide structural steps. Use `0` for overview, `L` for laser and `Esc` to exit and restore the editing viewport. Presentation state stays in memory, with no persisted slide deck or audience window. See [canvas modes](workspace/文档/包/画布模式.verd-doc.json).

## 下一主版本：四层插件接入（源码）

以下为下一主版本的源码接入方式。本轮只交付代码与 Changesets，不升级版本、不发布；请用本仓构建的真实 tarball 验证，已发布的 2.0.0 不包含这些新入口。

最小 Mind 直接安装 core、mind、react、react-mind 四个包；共享文本与布局自动安装。白板、Workflow、Architecture、UML 使用各自对应的两层插件。

```tsx
import { useState } from 'react';
import { createMindFrameSnapshot } from '@sue/board-mind';
import { FrameEditor } from '@sue/board-react';
import { createMindUIPlugin } from '@sue/board-react-mind';
import '@sue/board-react/style.css';
import '@sue/board-react-mind/style.css';
const plugins = [createMindUIPlugin()];
export function Editor() {
  const [value, setValue] = useState(createMindFrameSnapshot('frame', 'topic'));
  return (
    <div style={{ height: 600 }}>
      <FrameEditor plugins={plugins} value={value} onChange={(change) => setValue(change.snapshot)} />
    </div>
  );
}
```

引擎使用 createCellRegistry({plugins})，底层画布使用 createFramePluginSet 与 FrameCanvas({pluginSet})。领域类型移至领域包；缺少插件时拒绝文件且零写入，格式版本保持兼容。详细说明见原生[系统架构](workspace/文档/架构/系统架构.verd-doc.json)与[React 接入](workspace/文档/包/React接入.verd-doc.json)。

验证：pnpm check:plugins、pnpm test:plugin-consumers。完整产品默认组合全部插件。

## Schema 配置面板

普通设置与属性使用独立 Schema SDK 的类型化声明，保留业务事务、历史、继承及现有输入行为。完整说明与迁移清单见原生系统架构；开发指南说明真实 tarball 联调和先发布 SDK、再验证 registry 依赖的顺序。候选联调入口为 `node scripts/prepare-schema-integration.mjs --schema-artifacts /absolute/manifest.json`。

## 下一主版本：统一操作与图元链接（源码）

当前源码把工具栏、菜单、快捷键、命令面板和帮助统一为实例级 Actions。`Ctrl/Cmd+Shift+P` 打开最近编辑实例的命令面板。新增 [`@sue/board-react-actions`](packages/react/actions/README.md)，仅依赖 common 与 React；独立文档共用面板而不引入画布渲染器。

工作区内部链接可指向单个图元；移动后按稳定 Cell 身份找到当前源文件。导航等待源编辑提交与目标布局，支持取消及返回来源；临时展开折叠 Mind 祖先只影响当前视图，不写内容或撤销，图像导出保持原始折叠状态。

**破坏性 API 迁移：** 画布和独立文档的用户操作改为 `getActionState` / `executeAction` / `actions`，领域插件通过 `actions` 与工具 `actionId` 贡献命令；`revealTarget`、`FrameLinkHost` 与 common 的 `WorkspaceTarget` codec 替代分散的定位/链接入口。详细说明在原生 [React 接入](workspace/文档/包/React接入.verd-doc.json)和[迁移指南](workspace/文档/包/2.0接入与迁移.verd-doc.json)末节。本轮仅准备 major Changesets，不升级版本、不发布。

The next-major source shares Actions across editor controls, keyboard shortcuts, palettes and help, with a renderer-independent React actions package. Stable Cell links follow moves, navigation awaits host commit receipts, and temporary Mind reveals stay out of files, history and exports. Controllers and plugins migrate to Actions and typed reveal/link contracts; no version bump or publication is performed here.

### 知识关联与链接预览

文档链接栏可搜索工作区文档、章节和图元；文档与画布的「关联内容」面板分别展示文字链接、图元链接和嵌入来源，支持只读预览、复制链接和定位来源。Alt + 单击正文内部链接可直接预览，关闭后保留编辑与阅读位置。关联索引仅在运行时派生，保持原生格式和导出依赖范围。独立 `DocumentPage` 可通过可选 `linkChoices` 与 `onPreviewLink` 接入宿主提供的目标和预览。

Documents offer searchable internal link targets. Related content shows text links, Cell links and embeds with read-only previews and source navigation. Alt-click an internal link to preview without leaving the current editor. Knowledge relationships remain separate from export dependencies.

### 写作、版本与资料管理

空段输入 `/` 插入内容，段落操作支持移动、复制、删除和稳定链接；链接选择器中的「引用此段」插入随源内容更新的只读摘录。首页「从模板创建」提供原生技术方案、ADR、系统设计、需求梳理及图表范式，支持搜索、预览和目标目录。

「内容管理」提供标签、状态、来源、命名版本、版本预览与恢复、图片尺寸／说明和引用管理。所有内容与全文搜索可组合属性筛选并保存视图；冲突横幅支持比较两版和保留两份。资源和历史位于工作区 `.verd-resources/`，由 `WorkspaceSession` 条件提交；编辑空闲两分钟或十分钟周期生成检查点，恢复前保存当前版本，永久删除同步清除相关版本。

首页支持 Markdown 文件夹和 ZIP 迁入；便携 ZIP 包含原生源、Markdown、图片和转换报告。图片按内容哈希管理，原生文件导出仍自包含；重新导入便携包优先使用原生源保留属性与稳定身份。Notion CSV 数据库不在本轮适配范围。

Slash insertion, paragraph actions and live read-only excerpts support reusable writing. Native templates cover proposals, ADRs, system design and requirements. Content management adds portable properties, saved filters, durable checkpoints, conflict comparison and managed images. Folder/ZIP migration preserves note links and assets; portable archives retain native source alongside Markdown and conversion reports.

### 两层系统介绍

使用桌面端打开仓库的 `workspace/`，从文档导航阅读产品与架构说明，再按需打开项目导览画布，进入九张专题总览，再打开二十一张机制细节图，查看主要流程、失败分支、保存边界和源码入口。细节按专题收在 `workspace/架构图/细节/`，复用现有原生文档；逐层返回恢复阅读位置。完整包依赖图位于“01.1 完整包分层与依赖”，继续通过 `pnpm workspace:refresh` 更新。

内置项目工作区与 Agent 范式库遵循统一项目规范。已有副本不自动更新；在工作区设置中可手动备份并完整替换为当前应用附带的最新内容，保留项目身份与历史事务回执。

Built-in project and Agent pattern workspaces use portable project context. Existing copies update only on request: Workspace settings can back up and fully replace a copy with the bundled version while retaining project identity and transaction receipts.

内置项目图文与 Agent 范式库支持独立 npm 版本及确认后的备份更新，无需随 Desktop 重装。资源构建与检查：`pnpm build:content`、`node --test scripts/builtin-package.test.mjs`。完整说明见原生桌面安装与开发指南。

### 文档折叠、公式与资料阅读（源码）

独立文档和文档 Frame 新增列表子项折叠、通用折叠块及行内／块级 LaTeX。新增通用附件卡片、本地音视频、PDF 阅读与页码引用、HTTPS 网页卡片和按需嵌入。待办与数据库不在本轮范围。附件原件保存在工作区资源目录，便携 ZIP v2 携带二进制资源；旧包仍可导入。PDF、音视频和网页在静态预览中显示资料卡片，网页需联网且遵守站点嵌入限制。

Standalone documents add folding, LaTeX and attachment cards, local media/PDF reading and HTTPS embeds. Portable v2 archives preserve original binary resources. Task lists and databases remain deferred.

当前源码接口清理与迁移说明见内置《2.0 接入与迁移》的下一主版本章节：归属索引使用 `groupOf` / `domainOwnerOf`，编辑器类型统一为 `EditorKind`，主题颜色解析使用四参数 `resolveThemeColor`。
