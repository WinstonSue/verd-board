# @sue/board-core

以下为下一主版本的源码接入方式。本轮只交付代码与 Changesets，不升级版本、不发布；请用本仓构建的真实 tarball 验证，已发布的 2.0.0 不包含这些新入口。

通用 Cell/Frame、原子事务、历史、索引、CellRegistry/CellUtil 和几何算法。领域模型与 kind 分别由 draw、mind、workflow、architecture、uml 包导出；核心不反向导出它们。

在项目 .npmrc 配置两个 scope，访问权限和令牌由仓库管理员提供；令牌保存在用户配置或 CI secret。最小编辑器只使用 @sue，完整产品的 @ylib 传递依赖也需要相应授权。

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

```bash
pnpm add @sue/board-core
```

<!-- consumer-example -->

```ts
import { createCellRegistry, createCellRuntime, createCellStore, createFrameCell } from '@sue/board-core';
const registry = createCellRegistry({ plugins: [] });
const runtime = createCellRuntime({ store: createCellStore(createFrameCell('root')) }, registry);
console.log(runtime.snapshot);
```

通过 CellPlugin{id, install, scenes, normalize, validateTransaction, deletionClosure, references, remap, ...} 扩展既有 registry；不另建平行注册系统。重复插件 ID、冲突 kind 明确报错。运行时封闭注册，不支持热安装/卸载。

assertRegisteredCellKinds 在导入归一化前检查；UnregisteredCellKindsError 包含 code 与缺失 kinds。保留原始数据，安装对应插件后再打开。FrameView、FrameReferenceData 支持领域模块扩展，保持既有序列化字段。

独立辅助函数需要显式传递同一 registry，才能使用领域删除、重映射、场景、分组、布局、连接和路由规则。完整契约见原生系统架构文档。

## 下一主版本：链接重映射边界

`createCellRegistry({ plugins, links })` accepts protocol-independent `rewriteHref(href, context)` and `mapStandard(cell, rewriteHref)` callbacks. Supply common's `remapWorkspaceLink` and `mapStandardCellLinks` in a host that supports workspace links; core itself keeps zero runtime dependencies. `registry.remapLinks` runs standard slots once, then each `CellPlugin.mapLinks` for its domain-owned fields.

`CellPastePlan.idMap` is required for custom planners. Ordinary clipboard, duplicate and UML plans pass through the same finalization after copied Cell ownership is known; plugins must not pre-map links. Existing owner text and targets outside the copied set remain unchanged. `CellUtil.keyboard` is removed: register user shortcuts in the UI plugin's Actions and retain pure engine planners for content rules.

## Adaptive themes

`BoardThemeDefinitions` defines light/dark variants for the five theme IDs. `resolveBoardTheme` and `resolveCellAppearance` derive presentation without modifying content. `backgroundMode` and per-field `appearance.colorSources` distinguish `theme` from `custom`; unmarked component and table-entry colors follow the theme, and only explicit custom sources retain literal colors. Background sources keep their historical compatibility rules. Display names are Classic, Colorful, Soft, Retro and Fresh. Unknown IDs resolve to Classic without rewriting files; explicit custom backgrounds remain intact. Color data lives in `theme-config.ts`, with independent light/dark seeds. Mind uses these same six style families and three levels, retaining its inherit/explicit theme setting. Classic uses the former Colorful pastel palette; Colorful uses saturated dopamine seeds. Families share the order purple, red/rose, yellow/ochre, teal, blue and grass/olive. A theme accent can differ from its first family.

Built-in palettes also provide `roles` (`neutral`, `primary`, `secondary`, `tertiary`, `annotation`) and six category `series`. `resolveThemeRole(theme, role, level)` and `resolveThemeSeries(theme, index, level)` return an opaque `{ fill, strokeColor, textColor }` tone at `subtle`, `normal` (the default), or `strong` emphasis. The first three category families are the primary, secondary and tertiary roles. Category indices wrap deterministically; existing palette objects can omit the new fields and use the same helpers. Domain extensions choose mappings at render time; themes, snapshots and per-field custom colors are never rewritten.
