# @sue/verd-board-app

Shared file models, `WorkspaceHost` contracts, `createMemoryWorkspaceHost`, `WorkspaceSession`, validation and common Git implementations live in `@sue/verd-board-workspace`. This package retains browser/service hosts, legacy storage migration and application composition. Both its root entry and `/headless` continue re-exporting the shared APIs for existing consumers; new headless integrations can depend directly on the workspace SDK without installing product app/ui.

Next-major source navigation also preserves an embedded document editing view through optional canvas adapter hooks. The workspace preview cache keeps canonical document identity, content revision, selection and scroll in opaque JSON; it waits for editor-ready before restoration, checks the revision before restoring a caret, and cancels on abort, source deletion or cache release. Returning through a different occurrence resolves the stable cell again. View restoration changes no file content or history.

## 2.0.0 接入与变更

文件工作区与会话。VerdBoardApp 改为 WorkspaceApp({host})；WorkspaceHost、WorkspaceSession 统一保存/历史/冲突，支持 FrameFileV2 与 DocumentFileV1。旧 StorageAdapter 仍作为迁移边界保留。

版本通过可选 WorkspaceHost.versions 与 WorkspaceSession.versions 接入统一保存屏障，接口使用不透明版本 ID、显式文件/目录/工作区范围和能力声明。当前 Git 适配器负责底层仓库；旧 git 接口保留兼容与专属配置。文件、资源和目录菜单统一显示“版本历史”，Git 路径、作者、远端与维护移入工作区设置 → 版本管理。目录依据 folderId 跟随改名移动，恢复到当前位置；从首次带身份的目录版本起保证历史连续。IndexedDB 宿主保持本地历史，Desktop 与本地 Web service 支持远端快进同步。旧快照可读可恢复，自动恢复点和自动创建版本均已关闭。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/verd-board-app@2.0.0 @sue/verd-board-ui@2.0.0 react react-dom
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

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

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

### 从 1.0.0 迁移

旧入口 `<VerdBoardApp adapter={adapter} />` 已删除，改用上述 `WorkspaceApp host={host}`。Web 使用 `createWebWorkspaceHost`；自定义服务或桌面接入实现 `WorkspaceHost`，不要把 `StorageAdapter` 当作新 host。

`createWorkspaceSaveQueue`、`collectWorkspaceRevisions`、`createEmptyWorkspaceRecord` 已移除。通过 `openWorkspaceSession(host, handle)` 取得会话，使用 `apply`、`undo/redo`、`flush`、`dispose`；空工作区由 `host.openWorkspace` 与应用初始化。旧 `StorageAdapter`、`loadCellWorkspace` 和 `saveCellWorkspace` 保留于旧存储迁移边界，不是新文件工作区的写入通道。

`FrameFileV2` 保存 `.verd.json` 画布；`DocumentFileV1` 保存 `.verd-doc.json` 独立正文。`WorkspaceSession` 统一文件、历史和保存；`WorkspaceHost.commit` 按 `expectedVersion` 条件写入，事务 ID 支持重试。`flush()` 返回 `false` 时仍有失败或冲突，不能关闭后丢弃内容；冲突通过 `session.resolveConflict(fileId, 'keep-local' | 'load-disk')` 明确解决，再次 `flush()` 可重试保存。

`importLegacy` 只在尚未初始化、无现有文件的可写默认工作区被调用；显式目录不导入设备旧数据。迁移前备份原存储，保留迁移备份；新文件不是 1.0.0 应用的可回写格式。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。

## 下一主版本：稳定链接与可取消导航

Import `WorkspaceTarget` and the link codecs from `@sue/board-common`; the application package no longer exports `DocumentLink`, `createDocumentLink` or `parseDocumentLink`. Cell links use a typed `cell:` fragment and the workspace-global Cell owner index, so a move preserves the existing target. The URL file ID is a creation-time hint and a missing-target fallback, not a persistent redirect.

Workspace navigation captures its source, waits for `DocumentEditorController.flushEditing()` / canvas editing receipts, and sends an abortable request to the mounted target. Return context, selection, camera and temporary Mind reveals remain in memory. Single-file and mixed graph copies/imports rewrite links once with the final identity/owner mapping; ordinary navigation links do not enlarge embedded-reference export closures.

These next-major source APIs accompany major Changesets only; do not infer availability from the still-2.0.0 package version.

File navigation shows the current source file, its latest successful entry, and grouped direct embed locations across canvases and documents. Ownership is displayed separately in file information. Direct opens clear that file’s return context; tab activation preserves it. Document embed locations include a body revision and are revalidated before selection; ordinary text links and repeated nested preview appearances are excluded from embed counts.

`createServiceWorkspaceHost(options)` connects the shared application to the local filesystem service. It preserves binary payloads, conditional commits, errors and change subscriptions across HTTP/SSE. `WorkspaceHost.storageKind` optionally declares `filesystem` or `browser`; existing third-party hosts remain compatible. Browser storage remains an SDK and migration facility.

`exportBrowserBackup()` reads the source databases without changing them. After the service confirms a complete, validated import, the Web migration entry calls `clearMigratedBrowserData(backup)` to clear the matching source records. Cleanup checks the original origin and compares records inside each write transaction; changed source data is retained for a fresh backup and migration. Importing a backup file does not clear the current browser's data.

`WorkspaceApp.onMigrateBrowserData` optionally exposes a host migration action under Settings → Data and maintenance. The local Web application uses this action to import its previous browser workspaces.
