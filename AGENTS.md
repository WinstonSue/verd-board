# VerdBoard 仓库 Agent 规范

本文件适用于整个仓库，直接约束规划、开发与验收。仓库开发约定和门禁策略以本文件为唯一指令源；原生开发文档解释工程细节，任务方案不得自行增加与本文件冲突的完成条件。用户明确指示及更高优先级指令优先。

## 验证范围与门禁

### 先确定影响，再执行检查

- 开始验证前，结合任务基线与本轮实际改动，说明受影响的功能、需要运行的检查和所选测试文件。共享工作区中其他任务的改动不自动计入本任务范围。
- 日常任务必须优先采用足以覆盖影响的定向验证。不得因为“任务完成”“涉及多个文件”“希望更稳妥”、远程入口默认全量，或 Agent 自己在方案中写了全量，就执行全量回归。
- 只读核查不运行技术门禁。只修改仓库 Agent 指令、规则、README 的说明和引用，或技能绑定配置时，检查内容、链接、配置合法性和差异即可；不启动 lint、类型检查、构建、单测或 E2E。若同时修改可执行示例、脚本或配置行为，按实际影响补充验证。
- 原生正文和图表的内容整理，检查身份、结构、缓存、链接及必要预览；`workspace:check` 是对应专项。调整内容数量或全面审阅文档，不自动构成全量产品回归的理由。涉及可执行样例、资源生成或内置更新行为时，增加对应契约、资源检查及相关单测/E2E。
- 功能开发与修复完成前，全量执行 ESLint、Prettier，并实际运行相关单测和 E2E；这里的“全量”仅指 lint/format，不指全部测试。公共功能覆盖 Web/Desktop，宿主专属功能覆盖对应宿主，CLI、资源、升级变更覆盖对应专项。缺少必要覆盖时补充有意义的测试。

### 日常定向验收

- 常规功能验收使用 `pnpm test:remote dev --unit <仓库相对测试文件> --web-e2e <仓库相对测试文件> --desktop-e2e <仓库相对测试文件>`。参数可重复，仅选择相关宿主；`pnpm check:dev` 带相同参数也会默认转到远程。
- 当前 `dev` 选择器要求同时包含单测和至少一种 E2E。它只筛选单测和开发态 E2E 文件，仍固定执行全仓 lint、格式、类型、插件边界、工作区检查、公开包构建及 Agent 资源验收。不得把它描述成“只跑几个测试”。
- 只有脚本、CLI 或内容专项而没有相关 E2E 时，不得拼入无关 E2E 凑参数，也不得省略选择器转为全量。使用测试机已有的适用专项入口；没有可用入口时，报告缺少的执行能力与未验证项，不自行扩大范围。
- 裸 `pnpm test:remote`、`pnpm test:remote ci`、`pnpm check:ci`，以及不带选择器的 `dev`/`check:dev` 都会执行全量。它们不是普通任务的默认收尾命令；定向结果可以完成对应范围的正式验收。

### 全量门禁的触发条件

仅在以下任一条件成立时执行全量，并在执行前说明适用条件：

1. 用户明确要求全量回归。
2. PR 的 CI 流水线执行 `pnpm check:ci`；准备或创建 PR 本身不要求 Agent 在开发会话额外重复全量 CI。
3. 已获授权的产品或独立 SDK/npm 包发布执行 `pnpm check:release`，以及既有发布、打包流程的强制门禁。
4. 改动实际影响全局构建、测试基础设施或跨模块公共契约，且无法通过可枚举的相关测试可靠覆盖。Agent 须先给出具体影响链路和定向不足的原因；仅凭修改了公共文件、依赖或测试配置不能判定必须全量。

全量 CI 覆盖全部单测、脚本、消费者、资源，以及 Web/Desktop 开发态和生产态四套 E2E；发布门禁保持既有要求。技术门禁不会授予发布、安装或替换正式应用的权限。

### 失败、重跑与完成证据

- 修复方负责问题修复、失败项及相关测试的定向验证；发布门禁负责最终快照的完整验收与放行，不接管修复循环。发布执行方集中交回失败清单，修复方交付最终快照后再启动必要完整验收，不在每修一项后自动重启全量。
- 完整门禁按依赖集中收集失败：独立检查和套件继续，依赖构建或资源失败的阶段记为受阻。任何失败、受阻、取消或源码变化均不得放行；不把受阻记为通过，也不自动重试。
- 包单测限制包级和 Vitest 包内总并发，脚本测试单独限制文件并发；Web 可在独立端口和数据下并行，同一 GUI 会话的 Desktop 保持单 worker。四套 E2E 继续依次执行，所有实际并发参数写入验收记录。提高默认并发前须在相同快照、工具链及用例集合上单次比较，全部通过、无资源恶化且至少提速 10% 才采用。
- 正式打包只消费同一任务完整发布门禁通过的证明及本轮产物，不重新构建已验收的 Agent 资源，不复用其他源码或其他轮次的通过结果。证明绑定完整发布输入、版本、工具链、平台架构、阶段集合及并发；安装包校验和真实包 E2E 仍在放行前执行。

- 先保留失败证据，区分本轮引入的问题、相关既有问题与无关问题。修复后先跑失败用例及受修复影响的相关用例，再执行本任务必要的门禁；专项失败不自动触发全量重跑。
- 不为了让无关全量用例变绿而静默修改产品或测试、扩大任务范围。无关失败应明确报告；不能把失败的全量记录说成通过。若本任务本来要求全量通过，则在相关修复后仍须完成全量门禁。
- 必要检查通过后停止验证。只有新增改动、失败或尚未解决的具体风险，才补跑相应范围；不得为获得重复通过记录反复执行同一套检查。
- 结果必须对应实际验收的源码摘要与测试选择。源码变化后重新判断受影响范围，不以旧快照通过证明新源码通过，也不因摘要变化一律改跑全量。全量证明与定向证明分别按各自门槛验收。
- 零重试；不得用新增 skip、放宽断言或截断失败掩盖问题。报告实际运行的命令、范围、结果和未验证项，不把定向通过表述为全仓通过。

### 执行位置与开发隔离

- 自动化 lint、格式检查、类型检查、构建、单测和 E2E 默认在远程测试机运行。当前 Mac 仅做内容/差异核对、快照采集、传输和结果展示；前述纯指令及引用校对不属于技术门禁。
- 需要远程验收时，先用 `pnpm test:remote doctor` 检查配置与连接。执行器是独立用户级 remote-test 工具，配置位于 `~/.config/remote-test/config.json`；主机 `cacheDir` 管理任务、运行时与下载缓存。远程不可用时报告具体阻塞，不自动改成本机执行。
- `pnpm check:dev` / `pnpm check:ci` / `pnpm check:release` 和正式打包在普通开发会话默认委托远程；worker 设置 `VERD_TEST_EXECUTION=remote`，GitHub Actions 直接执行，避免递归委托。用户级连接配置不由仓库改写，仓库只派生稳定的发布任务定义。禁止自行设置该变量绕过本机保护；只有用户明确要求当前机器调试时才使用 `VERD_TEST_EXECUTION=local`。`CI=1` 不构成本机 GUI 授权，也不得改用 `dev:desktop` 或手写 Electron 脚本规避保护。
- 显式 npm registry 发布保留既有执行位置，完整发布门禁与 registry 发布使用同一受控端的当前构建；不得在远程验收后发布本机未经本轮验收的旧 dist。技术验收和远程普通任务不授予 registry 发布权限。
- 断连后使用 `status/logs/fetch/cancel <任务ID>` 恢复操作；`artifacts <任务ID>` 查看诊断大小，按需 `fetch <任务ID> --raw`。默认只回收状态、日志、验收记录和正式失败/中断附件；完整过程 trace 在远端按项目保留最近三轮。
- 日常开发不打包、安装、替换、注册或关闭正式应用。仅在用户明确要求本机预览或调试时启动当前电脑的界面；自动 E2E 使用测试机隔离服务、临时数据和工作区，不复用或关闭手动 Dev。
- Desktop Agent 接入专项必须使用本轮新生成且通过资源验收的资源，并设置 `VERD_AGENT_RESOURCES` 与 `VERD_AGENT_RESOURCE_TEST_PATH`；不得复用旧资源证明新源码通过。

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
