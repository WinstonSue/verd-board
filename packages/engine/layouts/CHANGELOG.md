# Changelog

## 2.0.0

### Major Changes

- 树与 DAG 布局。新增 abstractStandardSide；已有公开签名保持不变，本次统一发布为 2.0.0。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

### Patch Changes

- b556617: Mind 功能迭代：笔记文本配置、Mind 配色方案、整树布局、Markdown 双向转换。

  - 新增 `FrameView.mind.colorScheme`（default/colorful/soft/retro/dark/starry），缺省继承画布主题；颜色按"显式标记 > 分支继承 > 方案 > 画布主题 > 默认色板"在渲染时解析，不批量写节点，旧文件无需迁移。
  - `FramePresentation`/`FrameNodeAppearanceValue` 增加可选 `stroke` 字段，外观缓存同步比较。
  - 笔记文本分组支持字号（默认 13）、颜色与"跟随主题"、粗斜体/下划线/删除线、对齐，作用于整篇笔记并保留 marks；空笔记禁用文字控件并提示。
  - `cell-tree.ts` 新增整树事务 helper：`mindTreeRootId`/`mindTreeNodeIds`/`mindTreeLayout`/`setMindTreeLayout`/`setMindTreeRightNodeCount`/`mindLayoutBounds`/`offsetMindTreeRoots`/`stackMindTreeRoots`，一次事务更新根布局并清除后代与概要的局部覆盖（含折叠子树）。
  - Markdown 转换器拆分为 parse/richtext/serialize：多根、前言、跳级标题、合成中心（`fallbackTitle`）、嵌套列表、深层 7+ 级、引用块笔记（含标题/列表/代码块，不参与建树）、粗斜体/行内代码/链接 marks 往返；导出经 remark-stringify。
  - 产品入口：画布内导入预览追加、Mind 详情/引用菜单导出 Markdown（预览后复制或下载，不自动落盘）；多根导入纵向堆叠、追加置于现有内容右侧 80。文件树导入 `.md` 仍创建独立文档。

## 1.0.0

### Major Changes

- 135bf3f: Rename all publishable packages into the `@sue` scope while keeping board/verd-board identity prefixes (for example `@board/core` → `@sue/board-core`, `@verd-board/ui` → `@sue/verd-board-ui`).

### Minor Changes

- 2086e7f: Add publishable Provider packages for controlled canvas, generic mind maps, and host-owned workflow graphs.

本包处于 VerdBoard monorepo 改造基线；历史独立版本记录已收束。

**文档**：请在仓库 [原生文档导航](../../../workspace/文档/文档导航.verd-doc.json) 下查阅。

## 0.0.1

预发布基线：尚未对外发布。
