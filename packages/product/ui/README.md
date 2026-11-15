# @sue/verd-board-ui

## 2.0.0 接入与变更

VerdFrame 产品界面。新增 DocumentPage、文件树、标签组、图表库、工作区设置、回收站和外观偏好；VerdFrame 增加引用、工作区历史与宿主回调。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-core@2.0.0 @sue/verd-board-ui@2.0.0 react react-dom
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```tsx
import { useState } from 'react';
import { createCellStore, createFrameCell } from '@sue/board-core';
import { VerdFrame } from '@sue/verd-board-ui';
import '@sue/verd-board-ui/style.css';
export function Editor() {
  const [value, setValue] = useState(() => ({ store: createCellStore(createFrameCell('root')) }));
  return <VerdFrame value={value} frameId="root" onChange={({ snapshot }) => setValue(snapshot)} onOpenFrame={() => {}} />;
}
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。

## 下一主版本：Action 与导航接入

`VerdFrame`/`FrameEditor` controls consume the controller's shared Action source; domain plugins contribute `actions` and tool `actionId` references. User operation availability, toolbar/menu execution, shortcut help and command palette share the same definitions.

`DocumentPage.navigation` is `{requestId,target:WorkspaceTarget,signal?}` with `onNavigationResult`; old anchor-only requests are removed. `FrameLinkHost` delegates workspace link generation/activation, and `revealTarget` replaces legacy reveal props. Document changes may return actual host commit receipts so navigation waits for accepted edits. The product composes `@sue/board-react-actions`; standalone document surfaces do not acquire a board-renderer dependency.

`FrameDocumentEditingView` is re-exported for optional embedded-document adapters. `FrameDocumentReferences.captureEditingView` / `restoreEditingView` and the corresponding canvas controller methods carry opaque JSON view state; the workspace product waits for editor-ready, restores scroll and restores a caret only for matching content revisions. File tree, workspace menu, tabs/groups, library, trash, settings and banners consume the same semantic ActionSource; the canonical surface inventory is `packages/product/app/src/session/workspace-surface-actions.ts`.

## 主题外观

经典、缤纷、柔和、复古、清新、海洋均随应用外观选择深浅变体，画布只需选择一次主题。所有图元的未标记颜色（包括旧固定色）均跟随主题，只有明确标记的手动颜色保持固定；可逐字段恢复主题，Mind 分支也可恢复继承。画布背景保留独立来源规则；图像导出可选当前外观、浅色和深色。主题内部 ID 保持兼容，切换应用外观不修改文件或撤销历史。

## Source organization

`src/canvas` owns the product canvas composition, tools, properties, dialogs and presentation; `documents` owns document pages; `workspace` owns navigation and file management; `settings` owns settings pages. Cross-feature views, design primitives, drafts and preferences live in `shared`, with translations in `i18n`. Tests and feature styles live beside their implementation. The public API remains `src/index.ts`, and `style.css` resolves to the aggregate `src/styles/index.scss` during source development.

`CanvasPreview` keeps product plugin and appearance defaults while delegating the read-only runtime to `FrameCanvasPreview` from `@sue/board-react`.
