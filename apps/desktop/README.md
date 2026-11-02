# VerdBoard Desktop

基于 Electron 的青编桌面应用，支持本地画布与独立文档。

本轮受控评估未保留 Electron 45.1.0，继续使用锁文件中的 28.3.3，不改变系统兼容线。Web 的独立 SVG 绘制边界在 Electron 28 上出现拖拽回退，因此 Desktop 保留平铺实时矢量预览并优化视口测量；完整数据见[原生验收记录](../../workspace/文档/指南/体验回归验收.verd-doc.json)。

## 开发与验证

从仓库根目录运行：

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

侧栏提供「打开工作区文件夹」和「回到内置工作区」。成功切换后记住选择；切换先提交当前编辑并等待保存，保存失败会保留当前工作区。已选择的目录不可用时，可重新选择或回到内置工作区。自选空目录保持独立，不复制项目内容或导入其它目录的旧资料。

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

自测不得堆积 Dev 应用或 Dock 图标。Desktop dev/prod E2E 统一使用 `tests/desktop-e2e/src/desktop-launcher.ts`，单 worker 串行执行，关闭前一个测试进程后才可重启；macOS 测试窗口以 accessory 模式运行，不占 Dock。用例必须在 `finally` / teardown 中关闭实例；公共启动器在关闭超过 10 秒时回收自己启动的子进程，worker 退出或消失时也自动回收。手动自测优先复用已运行的 Dev，主进程或 preload 变更需要重启时先正常保存退出，再启动一个实例。测试清理只针对本轮启动且使用临时数据的进程。

新建或打开文件夹自动维护根 `AGENTS.md` 的专属受管块，并将 `.verdscrolls/shared` 链接到 userData 中按版本保留的工具资源。工作区设置显示 AI 就绪状态，可维护简介和入口文档 ID。打包钩子按目标平台准备经官方 SHA-256 校验的 Node 24.18.1 与完整 CLI；旧资源版本保留。开发时先运行 `pnpm exec turbo run build --filter=@sue/verd-board-agent` 和 `pnpm prepare:agent-resources apps/desktop/build/agent-resources/mac-arm64`，目标平台/CPU 按本机调整；也可用 `VERD_AGENT_RESOURCES` 指向临时准备目录。资源未准备时工作区仍可使用，并显示 AI 接入未就绪。

内置图文独立更新：项目资源来自 `@sue/verd-board-docs`，范式资源来自 `@sue/verd-board-agent-patterns`。启动和应用资源变化触发后台检查，通常间隔 24 小时。主进程复用本机用户/系统 npm 配置的匹配凭证，不要求系统安装 npm，也不把凭证打包。用户确认后才下载并校验精确版本，再完整备份和替换托管工作区；自选目录不会被替换。断网、认证失败和资源包尚未发布时继续使用本地内容。

`pnpm build:content` 构建两种发布描述；`node --test scripts/builtin-package.test.mjs` 验证真实 npm tarball；`pnpm publish:content` 是单独的显式发布命令。正式 Desktop 打包消费这些相同产物。先发布资源包，再交付启用在线检查的应用；开发/测试不自动发布。
