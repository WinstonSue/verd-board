# VerdBoard Desktop

基于 Electron 的青编桌面应用，支持本地画布与独立文档。

当前桌面运行时固定为 Electron 44.11.3。2026-11-16 的真实跨屏对照复现了 45.1.0 的窗口几何失同步及 hover 闪烁，44.11.3 的同机对照保持同步与悬停稳定；产品验收继续按仓库定向门禁执行。Web 与当前 Desktop 共用已有独立 SVG 绘制边界；Electron 28 的性能评估作为历史保留，见[原生验收记录](../../workspace/文档/指南/体验回归验收.verd-doc.json)。

## 开发与验证

从仓库根目录运行：

日常正式验收优先使用 `pnpm test:remote`，在另一台保持桌面登录的 Mac 执行构建、单测及 Web/Desktop E2E；`pnpm test:remote doctor` 检查连接与运行时。开发机上的 `check:dev`、`check:ci` 同样默认走远程；直接 Desktop E2E 缺少执行上下文时会在启动 Electron 前拒绝。未提交修改随独立快照传输，断连后可用 `status`、`logs`、`fetch` 和任务 ID 恢复操作。统一配置位于 `~/.config/remote-test/config.json`，主机 `cacheDir` 可指定远端缓存位置；完整过程 trace 保留三轮，`artifacts` 查看、`fetch <任务ID> --raw` 按需回收。配置与 SSH 密钥接入见[原生开发指南](../../workspace/文档/开发/开发指南.verd-doc.json)的“Tailscale 远程开发验收”；下面的原始验证命令由测试 worker、CI 执行，用户明确要求本机调试时可使用 `VERD_TEST_EXECUTION=local`。

```bash
pnpm install
pnpm dev:desktop # dev / start 为别名；源码热更新
pnpm test:e2e:desktop # 真实 dev，自动启动隔离测试服务
# 显式生产构建专项验收
pnpm build:desktop
pnpm test:e2e:desktop:prod
pnpm workspace:check
```

正式安装包：根目录运行 `pnpm package:desktop`；macOS 默认 DMG，`--with-zip` 可额外生成 ZIP。命令先构建依赖、在临时目录打包并检查身份、图标、原生文件及真实 `.app` 启动；`release/` 只保留当次安装包和 SHA256SUMS，历史产物移入 `release-history/`。临时 `.app` 会清理。

显式调试目录产物：`pnpm --filter desktop build:dir`，调试后请清理其中的 `.app`，避免启动器出现多个入口。图标源为 `build/icon.svg`，在 macOS 安装 Playwright Chromium 后运行 `pnpm icons:desktop` 可重新生成 PNG、ICNS、ICO。所有 Desktop E2E 使用临时 userData 和工作区；`VERDBOARD_WORKSPACE_PATH` 可显式指定独立工作区，防止测试或脚本改动项目内容。

开发版窗口和 macOS Dock 使用卷轴图标右下角带橙色 `DEV` 标记的 `build/icon-dev.png`，启动后替换 Electron 默认 Dock 图标。`pnpm icons:desktop` 从同一正式 SVG 派生开发版 SVG、PNG、ICNS、ICO；正式包继续使用无角标图标。

## 默认工作区

仓库根目录的 [workspace](../../workspace/) 是正式项目内容，包含项目导览、原生架构图与可直接编辑的文档；纳入 Git 管理。开发启动默认使用 `appData/VerdBoard Dev/workspaces/default` 的独立副本，首次复制原生内容并排除运行记录，之后保留修改且不自动覆盖。维护项目文档需主动打开仓库原目录。`.verdscrolls/` 保存项目配置与本机运行状态；内部 `.gitignore` 保留可共享的 `config.json`，排除会话、事务、回收站和本机共享链接。旧 `.verdboard` 在锁内整体迁移，冲突时停止写入。

打包时将这些原生文件放入应用资源。全新用户首次打开默认工作区时，先完整复制到用户数据目录，再以可编辑工作区打开：

- macOS：`~/Library/Application Support/VerdBoard/workspaces/default/`
- Windows：`%APPDATA%/VerdBoard/workspaces/default/`
- Linux：`~/.config/VerdBoard/workspaces/default/`

正式运行时名称为 VerdBoard，应用标识固定 `com.verdboard.desktop`，userData 固定在 `appData/VerdBoard`。开发应用为 `VerdBoard Dev`，窗口带 `[DEV]`，使用全新的 `appData/VerdBoard Dev` 数据目录，不导入旧 `desktop` 的选择与历史；开发旧存储同样归入独立 userData。正式版首次启动将旧 `desktop/workspaces/default` 和已记住的自选目录加入历史入口，旧文件留在原处，旧选择不替代新默认项目。已有正式工作区和旧版资料优先。旧清单 `verdboard-data.json` / `drawnix-data.json` 仍支持备份后迁移；损坏资料显示错误并保留原文。应用升级不会覆盖或合并用户已经编辑的默认工作区副本。

旧开发目录 `apps/desktop/workspace/` 中的个人文件和运行记录保留在原处，可通过「打开工作区文件夹」访问。

侧栏提供「打开工作区文件夹」和「打开系统介绍」。成功切换后记住选择；切换先提交当前编辑并等待保存，保存失败会保留当前工作区。已选择的目录不可用时，可重新选择或打开系统介绍。自选空目录保持独立，不复制项目内容或导入其它目录的旧资料。

测试和自动化可用 `VERDBOARD_USER_DATA_PATH` 覆盖数据目录；只有正式包执行旧区恢复，且仅检查该数据目录旁的 `desktop`，避免访问真实用户资料。

全局选择记录固定在 userData 的 `verdboard-global-config.json`，不写入项目目录。没有会话记录时按项目配置的阅读入口顺序打开第一个可用文件；内置项目默认显示“文档导航”，范式库默认显示其导航文档。项目导览画布由文档链接进入；已有会话及关闭全部标签后的空会话继续保留。

## 内容维护

文字稿以 `.verd-doc.json` 为直接编辑真源，画布以 `.verd.json` 为真源。项目文档通过稳定文件 ID 互链，移动、重命名仍能导航；画布之间使用 `frame-reference` 引用。

```bash
# 校验原生格式、身份、图表引用和文档链接
pnpm workspace:check

# 按当前 package.json 刷新托管包依赖图
pnpm workspace:refresh
```

刷新保留非托管标注与用户新增内容，遇到冲突会停止。执行刷新前关闭正在编辑该工作区的 Desktop，避免自动保存覆盖手工变更；正文不会由生成脚本重建。

手动开发使用端口 7300、`dist-electron-dev`；dev E2E 使用独占端口 7310、`dist-electron-e2e` 和独立 Vite 缓存，生产构建仍用 `dist-electron`。测试不复用或关闭手动 Dev，日常开发和验证不调用打包、安装或 LaunchServices 注册。安装包测试使用独立 `playwright.packaged.config.ts`，仅在显式打包时执行。

手动开发时，Vite 在主进程和 preload 首次构建完成后启动一个 DEV 实例，同一开发数据目录只允许一个实例。页面和样式支持热更新。主进程或 preload 重新构建后，按终端提示正常退出 DEV（macOS 上用 ⌘Q），再重新运行开发命令。退出 DEV 会结束本次开发命令。停止 Vite 时，DEV 会尝试保存并退出，保存失败时保留窗口。

Desktop dev/prod E2E 统一使用 `tests/desktop-e2e/src/desktop-launcher.ts`，单 worker 串行执行，关闭前一个测试进程后才可重启。macOS 测试窗口以 accessory 模式运行，不占 Dock。用例必须在 `finally` / teardown 中关闭实例。公共启动器在关闭超过 10 秒时回收自己启动的子进程，worker 退出或消失时也自动回收。测试清理只针对本轮启动且使用临时数据的进程。

新建或打开文件夹自动维护根 `AGENTS.md` 的专属受管块，并将 `.verdscrolls/shared` 链接到 userData 中按版本保留的工具资源。工作区设置显示 AI 就绪状态，可维护简介和入口文档 ID。打包钩子按目标平台准备经官方 SHA-256 校验的 Node 24.18.1 与完整 CLI；旧资源版本保留。开发时先运行 `pnpm exec turbo run build --filter=@sue/verd-board-agent` 和 `pnpm prepare:agent-resources apps/desktop/build/agent-resources/mac-arm64`，目标平台/CPU 按本机调整；也可用 `VERD_AGENT_RESOURCES` 指向临时准备目录。资源未准备时工作区仍可使用，并显示 AI 接入未就绪。

系统介绍与 文档编写推荐库随应用内置，版本与产品版本一致，不通过 npm 检查或下载。安装新应用不会自动替换已有副本。仅进入对应工作区时，名称旁的小标记提示可用更新；点击进入“设置 → 数据与维护”，确认后更新为当前应用附带内容。更新默认不备份；勾选备份后选择父目录，完整副本保存到独立子目录并加入普通工作区列表。取消目录选择不更新。更新先保存当前会话，保留项目身份和终态事务回执，重新打开新版导航文档。

`pnpm build:content` 从仓库原生内容直接准备内置资源；`node --test scripts/builtin-package.test.mjs` 校验摘要和产品版本。内置内容不单独通过 npm 发布。
