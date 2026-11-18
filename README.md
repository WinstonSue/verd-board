# 青编（VerdBoard）

青编是画布与文档共存的本地知识工作区，支持白板、思维导图、流程图、架构图、UML 类图、UML 时序图与独立富文本文档。

原生文档、独立图表和普通资料按真实目录组织。画布通过稳定引用共享源内容；实时保存与手动版本分开。Desktop 与本机 Web service 使用文件系统工作区，支持版本预览、恢复及 Git 远端同步；独立 IndexedDB SDK 宿主提供浏览器本地工作区与历史。

VerdBoard combines native documents, independent diagrams and ordinary resources in a local workspace. Desktop and the local Web service use filesystem workspaces; the standalone IndexedDB SDK host provides browser storage. Diagrams share source content through stable references, and automatic saving stays separate from explicit version creation.

## 阅读入口

系统介绍的唯一正文来源是根 [`workspace/`](workspace/)。在应用切换器中选择「打开系统介绍」阅读内置副本；维护项目内容时主动打开仓库原目录。开发应用的默认工作区是独立副本，后续启动保留用户修改。

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

验收范围以根级 [AGENTS.md](AGENTS.md) 为准，按实际改动选择内容专项或功能定向验证。开发机的 `check:dev`、`check:ci`、`check:release` 和正式打包默认转到远程测试机，结果绑定源码摘要与测试选择。全量门禁按依赖集中收集失败，修复方负责修复与定向验证；完整通过后，打包复用同轮已验收构建和资源。单测和 Web 使用受控并发，同一桌面会话的 Desktop 串行；ESLint、Prettier、类型、原生内容、单测、消费者、Agent 资源及四套 E2E 均保留。

Use the root `AGENTS.md` to choose validation scope. Quality gates and Desktop packaging default to the remote test host. Gates collect independent failures for the repair owner; packaging consumes this run's complete passing proof and validated artifacts. Unit and Web tests use bounded parallelism, while native Desktop tests remain serial within one GUI session. All four development/production E2E suites remain required. Setup and recovery commands are documented in the native development guide.

## 包分层与第三方接入

- `packages/workspace/core`：`@sue/verd-board-workspace`，统一文件模型、Host 契约、Session、条件提交、历史、资源和通用 Git。
- `packages/agent/{runtime,patterns}`：独立 Agent API/CLI，以及默认 Skills、执行模板和独立用户推荐库。生产依赖不包含产品 app/ui。
- `packages/engine`、`packages/react`、`packages/converters`：引擎、React 编辑器/领域插件与格式转换。
- `packages/product/{app,ui}`：宿主、迁移、应用组合与产品界面；app 根入口和 `/headless` 保留共享核心转导出。
- `apps/{desktop,web,service}`：Electron、Web 界面与本机服务。系统介绍由既有内容构建脚本从根 `workspace/` 准备，不维护 product/docs 包壳。

本次按包独立升版：产品应用、UI、Agent 与内置内容为 2.1.1，共享工作区 SDK 与 `board-react` 为 2.2.0，其余包以 manifest 为准。2.1.0 的插件与 Actions 契约保留为迁移基线；历史 2.0 接入者按[迁移说明](workspace/文档/包/2.0接入与迁移.verd-doc.json)调整。源码定版、本地产物与 registry 发布分别核对。

下面的浏览器 SDK 示例展示工作区宿主接入；插件、Actions、CSS、资源和保存回执的完整契约以 React 接入及各包 README 为准。

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

[应用包](packages/product/app/README.md) · [底层画布](packages/react/board/README.md) · [独立文档](packages/react/text/README.md) · [UML](packages/react/uml/README.md)

<a id="npm-2"></a>

### 历史 npm 2.0.0 接入

历史发布清单、两个私有 scope 的 registry 配置、读权限要求、1.0 → 2.0 破坏性变更及当时的验收记录，统一保存在[2.0 接入与迁移](workspace/文档/包/2.0接入与迁移.verd-doc.json)。本锚点保留为旧链接入口，不把历史接口当作当前接入推荐。

Current source contracts use explicit engine/UI plugins, shared Actions and stable workspace targets. See the package and React guides for current APIs; historical 2.0 instructions and registry setup remain in the migration document. Local artifacts do not establish registry publication.

## Agent 与文档维护

工作区 `AGENTS.md` 指向共享编写 Skill；从项目根执行 `.verdscrolls/shared/bin/verd context --json` 获取项目身份、阅读入口与适用 Skills。用户补充保存在 `.agents/skills/<name>/SKILL.md`，修改后重新生成未提交计划。

默认 Agent 规范以 `SKILL.md` 和 Markdown references 为单一维护源；执行模板保留原生 JSON。文档编写推荐库是面向用户的建议和示例，与 Agent 默认指令分别维护。共享资源升级后重新规划，已有用户副本仅在确认全量更新后替换，可选备份。

本仓开发约定与验证门禁统一见根级 [AGENTS.md](AGENTS.md)。日常任务按实际影响定向验证，PR CI 与发布执行对应全量门禁。其他项目技能仍由 `pnpm install` 同步，CI 跳过；手动使用 `pnpm skills:sync` / `pnpm skills:status`，配置见 [project.json](.ai-config-manager/project.json)。

产品及工程说明继续写入原生正文；正文、图和双语入口同步能力与限制。发布前分别核对 Agent 工程、用户推荐库与系统介绍；每版系统介绍须有实际业务正文更新，不能只改日期、版本或缓存。
