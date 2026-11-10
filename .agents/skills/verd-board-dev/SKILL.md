---
name: verd-board-dev
description: VerdBoard 本仓开发口径：包落点、workspace 依赖、命令与发布、原生文档策略、画布/Mind 改码入口。改本仓代码、加包、改画布或文档时使用。行业通识不在此重复。
---

# VerdBoard 开发规范

只写本仓库要统一的结论。中英文导航文档位于根 workspace/，分类正文位于 workspace/文档/，图解位于 workspace/架构图/；版本以 package.json、pnpm-workspace.yaml overrides 和 pnpm-lock.yaml 为准。

## 先读原生文档

- 总入口：`workspace/文档导航.verd-doc.json`
- 架构与数据流：`workspace/文档/架构/系统架构.verd-doc.json`
- 命令、提交、测试、发布：`workspace/文档/开发/开发指南.verd-doc.json`
- 文档维护：`workspace/文档/开发/文档维护指南.verd-doc.json`
- 画布 / Mind / 元素源码落点：`workspace/文档/指南/配置与源码索引.verd-doc.json`
- 包索引：`workspace/文档/包/包索引.verd-doc.json`

原生文档是 JSON，完整结构正文在 `text.content`，快速阅读可取 `text.plainText`。修改正文同时保持缓存与内容一致；不得只改 plainText。文档 id 与 text.id 一致，移动重命名不改身份。内部链接使用 `verd://file/<编码后的稳定ID>#<编码后的GitHub标题slug>`。不要新建 Markdown 正文、导出兼容树或正文 JS 生成源。

## 包落点

- 产品 UI：`packages/product/ui`（`@sue/verd-board-ui`）
- 工作区会话与应用：`packages/product/app`（`@sue/verd-board-app`）
- 引擎：`packages/engine`（common、core、layouts、draw、mind、text、workflow、architecture）
- React：`packages/react`（board、text、mind、workflow、architecture）
- 领域图统一由 `FrameCanvas` 通过注册与扩展提供，标准接入 `value/onChange`，外部宿主 `adapter/onIntent`；旧领域 Canvas 已删除。
- 独立文字文件为 `DocumentFileV1` / `.verd-doc.json`，正文为 `BoardTextDocument`，经 `DocumentPage/DocumentEditor` 编辑；不混入画布 CellStore。
- 转换器：`packages/converters`。Markdown/Mermaid-to-board 读写 FrameSnapshot，markdown-to-text 读写独立文档正文；内部依赖使用 `workspace:*`。

## 本仓约定

- TypeScript 严格模式；目录 kebab-case，组件 PascalCase；提交用 Conventional Commits。
- 单测 Vitest（`pnpm test`）；Web E2E 在 `tests/web-e2e`，Desktop E2E 在 `tests/desktop-e2e`。
- 日常用 `pnpm dev:desktop` 启动 Desktop（`pnpm dev` / `pnpm start` 为别名），`pnpm dev:web` 启动 Web；内部包直接走源码热更新，无需先构建。
- `pnpm test:e2e:desktop` 默认启动隔离的真实 dev 服务，使用临时数据与工作区；不复用或关闭手动 Dev。生产构建验收显式执行 `pnpm build:desktop` 后运行 `pnpm test:e2e:desktop:prod`；安装包测试使用独立配置，仅在明确打包流程中执行。
- 日常开发和功能验证不打包、安装、替换、注册或关闭正式应用。手动开发、自动化与生产输出分别为 `dist-electron-dev`、`dist-electron-e2e`、`dist-electron`。`pnpm build` 排除 Desktop。
- `pnpm workspace:check` 校验原生文档、图与链接；包依赖发生变化时用 `pnpm workspace:refresh` 刷新包架构图派生内容。
- 发布使用 Changesets：`pnpm release` 再 `pnpm pub`。
- 根 README、中文原生导航与英文 Documentation 同步重大定位与入口；不再建按月变更目录，不恢复另一份正文源。
- AI 样例位于 `tests/fixtures/ai-canvas/`，契约测试直接读原生规范 codeBlock；修改时同步正文和输入夹具。

## 开发与发布强制门禁

- 每项需求完成前全量执行 ESLint 与 Prettier：`pnpm lint`、`pnpm format:check`；必须实际运行涉及功能的单测和 E2E，缺少覆盖时补充。公共能力覆盖 Web/Desktop，宿主专属能力覆盖对应宿主，CLI、资源和升级变更覆盖相应专项。
- 使用 `pnpm check:dev --unit <仓库相对测试文件> --web-e2e <测试文件> --desktop-e2e <测试文件>`；参数可重复，选择范围时必须同时有单测与 E2E。未指定范围则执行全量。相关性由开发者/Agent 对照需求审阅，不以测试选择器冒充自动影响分析。
- PR CI 使用 `pnpm check:ci` 全量运行单测、脚本测试、四套 Web/Desktop 开发态与生产态 E2E，及现有类型、文档、插件、消费者和资源验收。零重试，不通过新增 skip、放宽断言或截断失败掩盖问题；Desktop Agent 接入必须使用本轮资源。
- 所有产品和独立 SDK/npm 包发布均执行 `pnpm check:release`，并分别核对 Agent 工程、用户文档编写推荐库、系统介绍是否同步最新业务。前两项允许审阅后无变更并说明理由；系统介绍每次版本发布必须实际更新原生正文，版本号、日期、排版和缓存变化不计入。
- 版本化核对记录位于 `.release/`，通过 `pnpm release:review` 生成待填写记录，绑定目标版本清单、源码和内容摘要；业务变化后重新审阅。首次基线只显式创建一次，不追补历史、不自动重置。`pnpm release` 升版前核对，`pnpm pub` 与 `pnpm package:desktop` 在发布结果产生前执行完整门禁；日常开发仍不打包或替换正式应用。
- 推荐库 `packages/product/agent-patterns/workspace/` 面向用户，只提供建议和示例，不产生 Agent 默认提示或约束。真正 Agent 规范、默认 Skills 和执行模板位于同包 `agent/`，使用独立目录索引和加载入口；两边允许知识重合，但分别维护审阅。工作区 AGENTS 接入及用户显式配置的 `.agents/skills` 继续生效。
- 每次发布同步系统介绍的相关正文、入口、能力和限制，并维护原生 `text.content/plainText` 一致。完整资源升级继续校验摘要并要求未提交计划重新生成；推荐正文不作为默认 Agent 指令来源。

## 数据、画布与保存

- 修改元素经 CellTransaction / CellRuntime 和 FrameCanvasController；主题位于 `FrameCell.view`，相机只在内存。
- 工作区唯一写入入口为 `WorkspaceSession`，经 `WorkspaceHost` 对画布与文档做 expectedVersion 条件提交、统一历史、保存、冲突与回收管理。
- Desktop 开发身份为 VerdBoard Dev，窗口带 [DEV]，userData 为 appData/VerdBoard Dev；默认工作区在其 workspaces/default，首次复制仓库原生内容并排除运行记录，后续保留修改，不继承旧 desktop 的目录选择。维护项目文档需主动打开仓库 workspace/。开发旧存储亦归独立 userData；测试可显式覆盖数据和工作区目录。
- 打包应用继续使用 appData/VerdBoard 与既有恢复策略，不覆盖用户修改；本地开发无需迁移正式资料。

细节见原生系统架构、源码索引与相关包说明。
