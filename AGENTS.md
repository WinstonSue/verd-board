# VerdBoard 仓库 Agent 规范

本文件适用于整个仓库，直接约束规划、开发与验收。仓库开发约定和门禁策略以本文件为唯一指令源；原生开发文档解释工程细节，任务方案不得自行增加与本文件冲突的完成条件。用户明确指示及更高优先级指令优先。

## 验证范围与门禁

### 架构边界与测试职责

- “完整门禁”指受影响架构边界内的完整验收，不等于每次运行全仓测试。基础层（engine/common、core、layouts）、领域与转换器、React 渲染、共享工作区与 Agent、产品组合、宿主分别定义验收职责；包或独立功能为最小完整验证单元。影响按真实依赖与测试输入传播，不按层号机械扩散。
- 下游改动不运行未受影响的上游测试。基础层测试不得依赖真实业务插件；中性插件验证内核契约，真实领域组合归消费者契约。构建上游依赖不构成运行上游测试的理由。
- `tests/catalog.json` 是测试归属与宿主/运行态的唯一目录。新增、移动、删除用例同步目录；共享 fixtures、helpers、配置与依赖闭包纳入输入。未分类用例和无法归属的输入禁止静默略过。
- 单测覆盖不变量、边界、异常和历史回归；契约/组件测试覆盖协作。Web 生产态完整验证共享业务；Desktop 生产态覆盖关键接入、IPC、文件系统、窗口、下载和重启。开发态仅验证开发运行时；安装包专项验证本轮真实交付物。保留实际浏览器所需的布局、焦点和拖拽断言，不通过 skip、放宽断言或删除历史回归削减覆盖。

### 先计划影响，再执行检查

- 开始验证前说明任务基线、本轮变化、影响链路、所选单元和必要宿主。共享工作区其他任务的改动不自动计入本任务范围；打包快照仍必须准确记录实际包含的完整输入。
- `pnpm test:plan --base <Git引用> --json` 只读输出差异、影响、选择理由和证明引用；差异包含已提交、暂存、未暂存、未跟踪、删除和重命名。不能把任务开始时的 HEAD 当作此前全部源码已验收的证明。
- 日常功能验收优先使用 `pnpm test:remote dev --base <Git引用>`，也可使用可重复的 `--unit`、`--web-e2e`、`--desktop-e2e` 明确选择归属单元。纯 core、CLI、脚本可独立验收，不拼入无关 E2E。产品交互变化须覆盖相关宿主。
- 功能改动全仓执行 ESLint、Prettier，其他阶段按实际影响与发布产物需要执行。只读核查不运行技术门禁；仅指令、README、引用或技能绑定变更检查内容、链接、配置与差异。原生内容整理使用 workspace 专项；可执行样例、资源和升级行为补充对应契约。

### 发布证明与全仓基线

- CI、release、package 默认计算架构边界完整的计划。受影响单元运行其完整集合；未变化且输入一致的上游引用有效通过证明。缺少证明的单元补跑，禁止把范围外或引用证明记成本轮执行通过。
- 本轮发布身份绑定完整源码、版本、审阅、环境和产物；单元验证身份绑定其源码、完整测试集合、共享输入、解析依赖闭包、相关配置及实际工具链。下游变化和纯版本升号不自动使纯逻辑测试证明失效；版本敏感契约仍验证当前版本。
- 只有完整通过的单元记录可复用，旧格式记录不自动升级。远程证明保存于测试机项目缓存；CI 从受信任主分支恢复，PR 不写入可信基线。失败、受阻、取消、输入变化或证据缺失不得放行。
- 全仓重整后的首次基线、用户明确要求或影响确实无法枚举时，使用显式 `--full` 执行全部新架构单元。先说明适用原因；不得为获得重复通过记录反复全仓验收。新架构基线完成后恢复按边界验证。
- 正式打包仅消费同一任务的完整发布计划及本轮产物。历史证明仅用于免跑输入一致的测试，不复用旧 dist；本轮公共包、Agent/内置资源、生产应用、生产清洁检查及必要交付物验收继续执行。不得重建已验收 Agent 资源。安装包校验、校验和及真实包 E2E 仍在交付前执行。

### Agent 与远程任务协作

- 正式打包流程固定为：doctor → 完成发布输入 → 单次 package → 工具等待 → 读取终态摘要。`package` 内部执行发布计划并接续打包，不再先独立运行 `test:remote release`、`check:release` 或 `check:ci` 再提交 `package`；`pnpm release` 的升版步骤属于发布输入准备。
- 执行器负责测试推进、日志、超时、断连恢复和结果汇总。Agent 等待工具完成，不实时解读用例日志、不持续播报计数。只有基础设施异常、明确需要决策或终态诊断时介入；用户询问状态时可读取简要状态。
- 默认远程入口只返回任务 ID 和终态摘要，过程日志保留于文件；需要时显式使用 logs/--verbose。断连后使用 `pnpm test:remote wait <任务ID> --timeout <秒>` 接管同一任务，超时不取消、不重复提交；`summary <任务ID> --json` 读取汇总。保留 status/logs/fetch/cancel/artifacts 和按需 fetch --raw。
- 完整计划集中收集失败：独立检查继续，依赖失败阶段标记受阻。零自动重试。修复方先修复并定向验证失败项及其影响，再交付最终快照；发布执行方按新计划验收，不在每修一项后自动全仓重跑。
- 结果必须对应实际源码摘要和选择集合，分别报告本轮执行、引用证明、范围外、失败、受阻与未验证项。测试通过、打包成功、取回成功和安装包已交付分别判断，不把其中一项替代其他状态。不为无关失败静默修改产品或扩大任务范围。

### 执行位置、并发与隔离

- 日常 `dev` 和 `scripts` 由 remote-test 依次评估 verd-test、Tart 来宾和宿主 Mac。项目路由启用后，已授权在远端和来宾均不适用、宿主资源充足时自动在本机隔离快照中运行。CI、release、package 和 benchmark 固定在 verd-test。
- 独立用户级 remote-test 的连接配置位于 `~/.config/remote-test/config.json`，仓库仅临时派生任务配置，不改写用户连接和凭据。主机 cacheDir 管理任务、运行时、下载和项目验证缓存。
- 普通会话的 check:dev/check:ci/check:release/package 委托项目适配器。remote-test worker 根据执行端设置 VERD_TEST_EXECUTION，GitHub Actions 直接执行。禁止自行设置执行变量、CI=1 或改用手写 Electron 绕过本机保护。
- 保持现有包级/包内单测并发与脚本文件并发预算。Web 使用隔离端口和数据；同一 GUI 的 Desktop 保持单 worker，宿主/运行态 E2E 阶段依次执行。并发写入记录；提高默认并发需同快照、工具链和集合的单次比较，全部通过、无资源恶化且提速至少 10%。
- 日常开发不打包、安装、替换、注册或关闭正式应用。自动 E2E 使用测试机隔离服务、临时数据和工作区，不复用手动 Dev。Desktop Agent 专项使用本轮生成并验收的资源，设置 VERD_AGENT_RESOURCES 与 VERD_AGENT_RESOURCE_TEST_PATH。
- npm registry 发布仍需明确授权，并使用同一受控端的当前验收构建；技术验收不授予 registry 发布、安装或替换正式应用的权限。

## 原生文档与工程入口

中英文导航位于根 `workspace/`，分类正文位于 `workspace/文档/`，图解位于 `workspace/架构图/`。按任务需要阅读：

- 总入口：`workspace/文档导航.verd-doc.json`
- 架构与数据流：`workspace/文档/架构/系统架构.verd-doc.json`
- 命令、提交、测试、发布：`workspace/文档/开发/开发指南.verd-doc.json`
- 文档维护：`workspace/文档/开发/文档维护指南.verd-doc.json`
- 画布、Mind、元素源码落点：`workspace/文档/指南/配置与源码索引.verd-doc.json`
- 包索引：`workspace/文档/包/包索引.verd-doc.json`

原生文档正文在 `text.content`，快速阅读可取 `text.plainText`；修改正文同步缓存，不得只改 plainText。文档 `id` 与 `text.id` 一致，移动重命名不改身份。内部链接使用 `verd://file/<编码后的稳定ID>#<编码后的GitHub标题slug>`。产品与工程说明不新建 Markdown 正文、导出兼容树或正文 JS 生成源。版本以 `package.json`、`pnpm-workspace.yaml` overrides 和 `pnpm-lock.yaml` 为准，命令以 scripts 为准。

产品 Agent 执行规范和默认 Skills 以 `packages/agent/patterns/agent/skills/` 中的 `SKILL.md`、`references/*.md` 为单一维护源；原生执行模板按 catalog 独立保存。设置页只在内存中转换阅读模型，不维护规范 JSON 镜像。`packages/agent/patterns/workspace/` 是面向用户的推荐库，不产生默认 Agent 指令。工作区 `AGENTS.md` 接入和用户显式配置的 `.agents/skills` 继续按适用范围生效。

## 包落点与实现边界

- 产品 UI：`packages/product/ui`（`@sue/verd-board-ui`）；源码按 canvas、documents、workspace、settings、shared、i18n 分目录，测试和功能样式随实现。公共 JS 聚合仅在根 `index.ts`，样式聚合在 `styles/index.scss`。
- 共享工作区核心：`packages/workspace/core`（`@sue/verd-board-workspace`），维护文件模型、Host 契约、Session、条件提交、历史与通用 Git。
- 产品应用：`packages/product/app`（`@sue/verd-board-app`），维护宿主、旧迁移和应用组合；根入口和 `/headless` 转导出共享核心。
- 独立 Agent：`packages/agent/runtime` 与 `packages/agent/patterns`，保持现有 npm 包名；Agent/共享核心的生产依赖闭包不得包含产品 app/ui。
- 根 `workspace/` 是系统介绍唯一来源；既有脚本生成内置资源，不维护 product/docs 包壳。
- 引擎：`packages/engine`（common、core、layouts、draw、mind、text、workflow、architecture）；React：`packages/react`（board、text、mind、workflow、architecture）。
- 领域图由 `FrameCanvas` 通过注册与扩展提供，标准接入 `value/onChange`，外部宿主 `adapter/onIntent`；不恢复已删除的旧领域 Canvas。
- 独立文字文件为 `DocumentFileV1` / `.verd-doc.json`，正文为 `BoardTextDocument`，经 `DocumentPage/DocumentEditor` 编辑，不混入画布 CellStore。
- 转换器位于 `packages/converters`。Markdown/Mermaid-to-board 读写 FrameSnapshot，markdown-to-text 读写独立文档正文；内部依赖使用 `workspace:*`。
- 修改元素经 CellTransaction / CellRuntime 和 FrameCanvasController；主题位于 `FrameCell.view`，相机只在内存。
- 工作区唯一写入入口为 `WorkspaceSession`，经 `WorkspaceHost` 对画布与文档做 expectedVersion 条件提交、统一历史、保存、冲突和回收管理。

## 开发、内容与发布约定

- TypeScript 严格模式；目录 kebab-case，组件 PascalCase；提交用 Conventional Commits。
- 单测使用 Vitest，Web E2E 位于 `tests/web-e2e`，Desktop E2E 位于 `tests/desktop-e2e`。测试命令及其执行位置、范围遵循前述门禁规则。
- 获授权的本机预览使用 `pnpm dev:desktop`（`pnpm dev` / `pnpm start` 为别名）或 `pnpm dev:web`；内部包直接源码热更新，无需先构建。
- Desktop 开发、自动化、生产输出分别为 `dist-electron-dev`、`dist-electron-e2e`、`dist-electron`。`pnpm build` 排除 Desktop；生产专项先重建，再运行对应 prod 配置。安装包测试仅属于显式打包流程。
- Desktop 开发身份为 VerdBoard Dev，窗口带 `[DEV]`，userData 为 `appData/VerdBoard Dev`；默认工作区为其 `workspaces/default`，首次复制仓库原生内容并排除运行记录，后续保留修改，不继承旧 desktop 的目录选择。开发旧存储也使用独立 userData；测试可显式覆盖数据和工作区目录。
- 维护项目文档主动打开仓库 `workspace/`。打包应用继续使用 `appData/VerdBoard` 及既有恢复策略，不覆盖用户修改；本地开发无需迁移正式资料。
- `pnpm workspace:check` 校验原生文档、图和链接；包依赖变化用 `pnpm workspace:refresh` 刷新包架构图派生内容。技术检查仍在测试机执行。
- 根 README、中文导航与英文 Documentation 同步重大定位和入口；不建立按月变更目录或另一份正文源。
- AI 样例位于 `tests/fixtures/ai-canvas/`，契约测试直接读取原生规范 codeBlock；修改时同步正文和输入夹具。
- 发布使用 Changesets：`pnpm release` 再 `pnpm pub`。所有产品及独立 SDK/npm 包发布都执行 `pnpm check:release`，分别核对 Agent 工程、用户推荐库和系统介绍是否同步业务。前两项允许审阅后无变更并说明理由；系统介绍每次发布必须实际更新原生正文，版本号、日期、排版或缓存变化不计入。
- 发布核对记录位于 `.release/`，通过 `pnpm release:review` 生成，绑定目标版本清单、源码和内容摘要；业务变化后重新审阅。首次基线只显式创建一次，不追补历史或自动重置。`pnpm release` 升版前核对，`pnpm pub` 与 `pnpm package:desktop` 在产出前执行完整门禁。
- 每次发布同步系统介绍相关正文、入口、能力与限制，保持 `text.content/plainText` 一致。完整资源升级校验摘要并要求未提交计划重新生成；用户推荐正文不作为默认 Agent 指令来源。
