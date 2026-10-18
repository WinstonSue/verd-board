# VerdBoard Desktop

基于 Electron 的青编桌面应用，支持本地画布与独立文档。

## 开发与验证

从仓库根目录运行：

```bash
pnpm install
pnpm start
pnpm build:desktop
pnpm test:e2e:desktop
pnpm workspace:check
```

安装包目录：`pnpm --filter desktop build:dir`。所有 Desktop E2E 使用临时 userData 和工作区；`VERDBOARD_WORKSPACE_PATH` 可显式指定独立工作区，防止测试或脚本改动项目内容。

## 默认工作区

仓库根目录的 [workspace](../../workspace/) 是正式项目内容，包含项目导览、原生架构图与可直接编辑的文档；纳入 Git 管理。开发启动默认直接编辑该目录。`.verdboard/` 保存本机会话、配置、事务日志和回收站，不提交版本库。

打包时将这些原生文件放入应用资源。全新用户首次打开默认工作区时，先完整复制到用户数据目录，再以可编辑工作区打开：

- macOS：`~/Library/Application Support/VerdBoard/workspaces/default/`
- Windows：`%APPDATA%/VerdBoard/workspaces/default/`
- Linux：`~/.config/VerdBoard/workspaces/default/`

已有工作区和旧版资料优先。旧清单 `verdboard-data.json` / `drawnix-data.json` 仍支持备份后迁移；损坏资料显示错误并保留原文。应用升级不会覆盖或合并用户已经编辑的默认工作区副本。

旧开发目录 `apps/desktop/workspace/` 中的个人文件和运行记录保留在原处，可通过「打开工作区文件夹」访问。

侧栏提供「打开工作区文件夹」和「回到内置工作区」。成功切换后记住选择；切换先提交当前编辑并等待保存，保存失败会保留当前工作区。已选择的目录不可用时，可重新选择或回到内置工作区。自选空目录保持独立，不复制项目内容或导入其它目录的旧资料。

全局选择记录固定在 userData 的 `verdboard-global-config.json`，不写入项目目录。首次打开内置工作区且没有会话记录时显示项目导览；关闭全部标签后的空会话也会保留。

## 内容维护

文字稿以 `.verd-doc.json` 为直接编辑真源，画布以 `.verd.json` 为真源。项目文档通过稳定文件 ID 互链，移动、重命名仍能导航；画布之间使用 `frame-reference` 引用。

```bash
# 校验原生格式、身份、图表引用和文档链接
pnpm workspace:check

# 按当前 package.json 刷新托管包依赖图
pnpm workspace:refresh
```

刷新保留非托管标注与用户新增内容，遇到冲突会停止。执行刷新前关闭正在编辑该工作区的 Desktop，避免自动保存覆盖手工变更；正文不会由生成脚本重建。
