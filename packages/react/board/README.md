# @sue/board-react

通用 FrameCanvas、可组合 FrameEditor、工具栏、属性控件、快捷键分发、图像导出，以及内置富文本。不依赖领域引擎、领域 UI、产品包或转换器。

在项目 .npmrc 配置两个 scope，访问权限和令牌由仓库管理员提供；令牌保存在用户配置或 CI secret。最小编辑器只使用 @sue，完整产品的 @ylib 传递依赖也需要相应授权。

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

最小 Mind 安装四个 Board 包（文本和布局自动安装）：

```bash
pnpm add @sue/board-core @sue/board-mind @sue/board-react @sue/board-react-mind react react-dom
```

<!-- consumer-example -->

```tsx
import { useState } from 'react';
import { createMindFrameSnapshot } from '@sue/board-mind';
import { FrameEditor } from '@sue/board-react';
import { createMindUIPlugin } from '@sue/board-react-mind';
import '@sue/board-react/style.css';
import '@sue/board-react-mind/style.css';
const plugins = [createMindUIPlugin()];
export function Editor() {
  const [value, setValue] = useState(createMindFrameSnapshot('frame', 'topic'));
  return (
    <div style={{ height: 600 }}>
      <FrameEditor plugins={plugins} value={value} onChange={(change) => setValue(change.snapshot)} />
    </div>
  );
}
```

底层用法：const pluginSet = createFramePluginSet(plugins)，传给 FrameCanvas 的 pluginSet。FrameEditor 支持 value/onChange 或 adapter/onIntent，readonly、外部 history。引擎语义和 UI 贡献由同一个插件集合生成，预览和导出复用该组合。

只通过公开的 style.css 加载样式。FrameImporter/FrameExporter 是可选宿主能力，安装转换器后通过 importers/exporters 注入。不同编辑器使用独立插件集合、配置和语言；变更插件种类需要重新挂载编辑器。

完整契约、格式兼容和迁移见原生“React 接入”和“系统架构”。

## 声明式配置面板

普通字段可用 `defineSettings` / `ConfigPanel` 声明，宿主在 `onCommit` 中执行既有事务。`createFrameSettingsContribution({ id, definition, bind })` 创建类型化插件贡献，挂到 `propertyPanels` 或 `settingsPanels`；旧 `Properties` / `Settings` 仍用于复杂编辑器。面板 ID 不得重复。

`FrameGeometryControls` 与 `FrameAppearanceSettings` 提供最小编辑器和产品面板共用的字段定义；`FrameSettingsText` 保留文本草稿，`FramePropertyNumber` 保留数字草稿，`FrameSettingsControl` 桥接即时生效的原生控件。新 SDK 为独立仓库候选包，联调使用校验过的 tarball；正式版本须在 SDK 发布并更新依赖后验证 registry 消费。

## 统一用户操作与定位

`FrameCanvasController` exposes `actions()`, `getActionState(id,args?)`, `executeAction(id,args?,invocation?)` and `actionSource`. Toolbar, menu, shortcut, palette and help read the same definitions. `Ctrl/Cmd+Shift+P` opens the nearest scope's palette. `@sue/board-react-actions` supplies the shared React surface; board CSS already includes its styles.

Replace `clipboard`, `undo/redo`, `fit`, `centerSelection`, `setZoom`, `editText`, `moveSelection`, `selectionCommandState` and `executeSelectionCommand` with `canvas.clipboard.*`, `canvas.history.*`, `canvas.view.*`, `canvas.selection.edit`, `canvas.selection.move` and selection/arrangement action IDs. `frameSelectionActionId(FrameSelectionOperation)` maps arrangement/group/lock operations. Low-level `dispatch`, image export and bounds helpers remain host composition APIs.

`FrameUIPlugin.actions` contributes definitions with stable IDs, `effect`, argument validation, state and execution. Tools reference `actionId`; plugin-local `shortcuts`, tool `run/enabled/tool` callbacks and engine `CellUtil.keyboard` are removed. Menus call `action.capture()` before focus changes. Content execution waits for `flushEditing()` and preserves the original target through asynchronous work; inspect the returned `ActionResult` instead of assuming success.

`FrameLinkHost` delegates `createLink({frameId,cellId})` and `openLink(href)` to the host. Link activation is workspace-internal; the canvas does not resolve files or register an OS deep-link handler. `revealTarget({cellId,requestId,signal?})` replaces `revealCell` and one-way reveal props, returning `revealed`, `cancelled` or `unavailable` after layout is ready.

`FrameRenderExtension.layout(store,frameId,projection)` and render contexts share an occurrence-local `FrameViewProjection`. Mind reveal ancestors are runtime overrides only; cache by projection identity, and use canonical projection for export. Node, Edge, label/marker and Group bounds are handled consistently. Persistent Frame/document formats stay unchanged.

Continuous text in custom render extensions should call `context.commitEditing(transaction)` so the editing barrier tracks its host receipt without starting another Action for each input event. Use `context.dispatch` for final discrete controls; it executes through the shared Action adapter and waits for host echo. The canvas initializes its internal action controller even when the consumer does not supply a React ref.

Embedded document hosts may implement `FrameDocumentReferences.captureEditingView(instanceId)` and `restoreEditingView(view, activate, signal?)`. `FrameDocumentEditingView` is `{cellId,state:unknown}`; `captureDocumentEditingView()` / `restoreDocumentEditingView(view,signal?)` forward it through the canvas controller. Keep `state` as plain JSON. The adapter resolves the current occurrence, calls `activate(instanceId)`, waits for its editor-ready acknowledgement and returns `Promise<ActionResult>`; abort or a missing source ends the wait without a timeout. The product stores canonical document identity, content revision, selection and scroll, restoring a caret only when the revision still matches. These optional hooks add no document history and require no rich-text schema or DOM protocol in the SDK.

## Theme appearance

`FrameCanvas` and `FrameEditor` accept an optional `appearance="light" | "dark"` runtime prop. Omitting it preserves legacy rendering. Extensions receive resolved semantic colors through `FrameRenderContext.theme`; appearance does not edit snapshots. `controller.exportImage({ appearance: "light" })` overrides the current appearance for one export.

`FrameRenderExtension.themeAppearance({ cell, store, frameId, theme })` supplies domain defaults for fill, stroke and label text. `resolveFrameAppearance` applies custom field sources and local contrast rules to each component; runtime `ResolvedFrameCellAppearance` and `FrameRenderContext.resolvedAppearance` share the result with renderers and inspectors. `resolveFrameCellAppearance` combines those defaults with per-field custom overrides; `controller.resolveAppearance(cellId)` exposes the same read-only result to inspectors. Unmarked component colors follow the theme, while transparent layers retain their meaning. Rich-text colors follow the theme unless `textStyle.attrs.colorSource` is `custom`; missing and `theme` sources inherit the nearest readable text color. Omitting `appearance` resets the adaptive text variable at the frame boundary and retains literal legacy colors.

## Read-only canvas preview

`FrameCanvasPreview` mounts an isolated read-only preview with local reference dependencies, viewport fitting and resize handling. Pass `value: FrameSnapshot`, `frameId` and an explicit `pluginSet`. Optional props are `documentReferences`, `appearance` (`light` or `dark`) and `exporting`. Load the SDK and selected domain plugin styles as for `FrameCanvas`. The SDK does not select product plugins or read product appearance preferences.
