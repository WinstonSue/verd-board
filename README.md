# 青编（VerdBoard）

青编以真实文件夹为工作区，统一管理原生图文与普通资料。工作区既可独立使用，也可作为外部项目的文档目录，由桌面端或项目通过 SDK 接入的 Web 界面打开。

目录内用户文件按现有桌面能力管理，用户可继续在 IDE 或其他工具中修改同一批文件。项目内工作区沿用所属 Git 仓库，只提交和恢复工作区内容；独立仓库保留远端同步。实时保存与明确创建版本分开，普通永久删除保留 Git 历史。Agent 编写工具通过设置显式启用。

VerdBoard treats a real folder as a workspace, either standalone or embedded in a project. Desktop and the project Web SDK edit the same files through the shared Node host. Project workspaces inherit their enclosing Git repository, with commits and restores limited to the content directory. External editors remain supported; automatic saving, explicit versions and trash deletion have separate behavior.

## 阅读入口

系统介绍的唯一正文来源是根 [`workspace/`](workspace/)。从 Desktop 或本机 Web 首页只读浏览「系统介绍」和「文档编写推荐库」。首次打开新版内置库会恢复为随附内容。维护项目内容时主动打开仓库原目录。

- [中文文档导航](workspace/文档导航.verd-doc.json) / [English documentation](workspace/Documentation.verd-doc.json)：按阅读目标选择入口。
- [产品概览](workspace/文档/产品/产品概览.verd-doc.json)：定位、能力、宿主和限制。
- [系统架构](workspace/文档/架构/系统架构.verd-doc.json)：职责边界、模型、关键链路与失败处理。
- [开发指南](workspace/文档/开发/开发指南.verd-doc.json) / [桌面安装与使用](workspace/文档/指南/桌面安装与使用.verd-doc.json)：开发隔离、使用、远程验收与发布。
- [包索引](workspace/文档/包/包索引.verd-doc.json) / [React 接入](workspace/文档/包/React接入.verd-doc.json)：包职责、插件组合和公共 API。
- [AI 画布数据规范](workspace/文档/指南/AI画布数据规范.verd-doc.json) / [配套样例](tests/fixtures/ai-canvas/)：原生字段、约束与真实导入输入。
- [文档维护指南](workspace/文档/开发/文档维护指南.verd-doc.json)：原生真源、稳定身份、样例契约与审图。

Start with document navigation, then follow the product, architecture, development or SDK path. The overview canvas links nine topic overviews and twenty-one mechanism diagrams. Native documents and independent diagrams remain the maintained editable sources; README is an entry point.

## 开发与验收

源码环境要求 Node.js >= 22.12.0、pnpm >= 11.18.0。依赖版本以各包 `package.json`、`pnpm-workspace.yaml` overrides 和 `pnpm-lock.yaml` 为准。

```bash
pnpm install
# 用户明确要求本机预览时启动，开发应用与正式数据隔离
pnpm dev:desktop
# 或启动 Web + 本机 service：http://localhost:7200
pnpm dev:web
# 验证前检查测试机连接
pnpm test:remote doctor
```

验收范围以根级 [AGENTS.md](AGENTS.md) 为准。测试按基础、领域、渲染、共享服务、产品与宿主分层，`tests/catalog.json` 登记用例归属；`pnpm test:plan --base <ref> --json` 查看影响，未变化上游有有效证明即可免跑，缺少证明才补跑。共享业务以 Web 生产态验证，Desktop 与开发态覆盖各自差异。功能改动保留全仓 ESLint、Prettier；技术检查默认在测试机执行。正式打包一次提交，执行器完成门禁、打包并返回终态摘要；不逐条向 Agent 传递测试日志。

Use the root `AGENTS.md` to choose validation scope. `tests/catalog.json` assigns complete verification units, and `pnpm test:plan --base <ref> --json` explains the affected boundaries. Matching upstream proofs can be reused; missing proofs require execution. Shared browser behavior runs in Web production, with separate native Desktop and development runtime contracts. Remote packaging runs one gate and package task, then returns a terminal summary. Unit and Web tests retain bounded parallelism; Desktop uses one worker. Use `--full` for an explicit repository baseline. Setup and recovery commands are documented in the native development guide.

## 包分层与第三方接入

- `packages/workspace/core`：`@sue/verd-board-workspace`，统一文件模型、Host 契约、Session、条件提交、历史、资源和通用 Git。
- `packages/agent/{runtime,patterns}`：独立 Agent API/CLI，以及默认 Skills、执行模板和独立用户推荐库。生产依赖不包含产品 app/ui。
- `packages/engine`、`packages/react`、`packages/converters`：引擎、React 编辑器/领域插件与格式转换。
- `packages/product/{app,ui}`：宿主、迁移、应用组合与产品界面；app 根入口和 `/headless` 保留共享核心转导出。
- `apps/{desktop,web,service}`：Electron、Web 界面与本机服务。系统介绍由既有内容构建脚本从根 `workspace/` 准备，不维护 product/docs 包壳。

当前源码基线为 `0.1.0`。包职责、插件组合和 Actions 接入见[包索引](workspace/文档/包/包索引.verd-doc.json)及[SDK 接入与契约](workspace/文档/包/SDK接入与契约.verd-doc.json)。

项目在现有 Node 服务中挂载 `@sue/verd-board-agent/node` 的 `createProjectWorkspaceService({ projectRoot, workspacePath })`，将请求交给其 `handleRequest(req, res)`；未处理的请求继续交给项目自身路由，退出时调用 `close()`。目录须已存在；也可在项目根 `.verd.config.json` 声明 `{ "workspace": "docs" }`，省略 `workspacePath`。默认仅面向本机 HTTP 使用。

前端继续使用同一 `WorkspaceApp`，服务握手声明固定工作区的能力。完整 Node 挂载示例、目录范围和保存契约见原生 React 接入文档。`createWebWorkspaceHost` 仍提供独立 IndexedDB 工作区，不代表磁盘上的项目目录。

<!-- consumer-example -->

```tsx
import { useMemo } from 'react';
import { WorkspaceApp, createServiceWorkspaceHost } from '@sue/verd-board-app';
import '@sue/verd-board-ui/style.css';
export function App() {
  const host = useMemo(() => createServiceWorkspaceHost({ baseUrl: '/api/v1' }), []);
  return <WorkspaceApp host={host} />;
}
```

[应用包](packages/product/app/README.md) · [底层画布](packages/react/board/README.md) · [独立文档](packages/react/text/README.md) · [UML](packages/react/uml/README.md)

## Agent 与文档维护

Desktop 和本机 Web 可以从文档和画布顶部、文件树或命令面板选择「发起 Agent」。任务始终从工作区发起，当前文件、文件夹或选区提供聚焦上下文。默认 Agent 为 Codex，可在「设置 → 个人偏好 → Agent」查看。「快速执行」使用已安装并登录的本机 Codex CLI，可在 VerdBoard 内审阅并确认原生改动。「在 Codex 中继续」在对应工作区预填任务，由用户在 Codex 中发送。CLI 配置和断线行为见桌面安装与使用指南。

Choose Start Agent from a page toolbar, the file tree, or the command palette. A file, folder, or selection focuses a task that starts in the current workspace. Codex is the default under Settings → Personal → Agent. Run a quick task with the installed Codex CLI and review changes in VerdBoard, or open a draft in the Codex desktop app.

工作区 `AGENTS.md` 指向共享编写 Skill；从工作区根执行 `.verdscrolls/shared/bin/verd context --json` 获取工作区身份、阅读入口与适用 Skills。用户补充保存在 `.agents/skills/<name>/SKILL.md`，修改后重新生成未提交计划。

默认 Agent 规范以 `SKILL.md` 和 Markdown references 为单一维护源；执行模板保留原生 JSON。文档编写推荐库是面向用户的建议和示例，与 Agent 默认指令分别维护。共享资源升级后重新规划，已有用户副本仅在确认全量更新后替换，可选备份。

本仓开发约定与验证门禁统一见根级 [AGENTS.md](AGENTS.md)。日常任务按实际影响定向验证，CI 与发布执行架构边界内的完整计划；显式 `--full` 用于新架构基线或要求全仓运行的情况。其他项目技能仍由 `pnpm install` 同步，CI 跳过；手动使用 `pnpm skills:sync` / `pnpm skills:status`，配置见 [project.json](.ai-config-manager/project.json)。

产品及工程说明继续写入原生正文；正文、图和双语入口同步能力与限制。发布前分别核对 Agent 工程、用户推荐库与系统介绍；每版系统介绍须有实际业务正文更新，不能只改日期、版本或缓存。

桌面端和本机 Web 的「首页」可按名称或目录查找「我的工作区」，也提供系统介绍和文档编写推荐库。点击侧栏工作区名称会打开与侧栏等宽的下拉框，覆盖下方导航。「工作区」页提供「全部内容」「图表」、筛选和已保存视图。侧栏「搜索」打开当前工作区的搜索弹窗，Cmd/Ctrl+P 默认搜索标题与路径，Cmd/Ctrl+Shift+F 默认搜索全部。侧栏底部「设置」右侧可以收起侧栏。Desktop 在同一个主窗口打开和切换工作区，已知工作区内的画布也在这里打开。

Desktop 首页下方的「快速创建」浏览 `quick-edit/` 子目录并列出最近打开的目录外文件。可新建 Markdown 或图、重命名文件、移到废纸篓。独立文件在单独窗口编辑，可直接在窗口内改名。同一个文件重复打开时聚焦原窗口。可以从系统托盘、Dock 或「窗口 → 显示主窗口」恢复 Desktop 主窗口。本地交互开发使用仓库内 Git 忽略的 `tmp/verdboard/quick-edit/`。

桌面的「文件 → 打开文件…」和系统文件管理器可打开 Markdown 与 `.verd` 画布，兼容旧 `.verd.json`。使用字母 `⌘O`（macOS）或 `Ctrl+O`（Windows/Linux）打开文件，使用数字 `⌘0` 或 `Ctrl+0` 恢复页面缩放。Markdown 保存回原文件，默认打开方式按操作系统要求确认。
