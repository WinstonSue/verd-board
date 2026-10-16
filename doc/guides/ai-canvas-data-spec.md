# 面向 AI 的画布数据生成规范

> **核对日期**: 2026-10-15
> **对应代码版本**: 仓库 `verd-scrolls`，提交 `5d57ed28`（master）
> **文件格式版本**: `verd-frame` v2（单画布文件）、`verd-canvas-bundle` v1（多画布包）、`verd-document` v1（独立文档，非画布）
> **配套示例**: [`doc/examples/ai-canvas/`](../examples/ai-canvas/)，与本文内嵌代码块逐字一致，由 `packages/product/app/src/frames/ai-canvas-examples.spec.ts` 契约测试保证。

本文是面向 AI 的**单份自洽规范**：读完本文即可生成完整、合法、布局合理的青编（VerdBoard）画布数据，无需安装项目或阅读源码。文末源码链接仅作为维护者的核对依据，不是阅读前提。

## 1. 文档定位与使用方式

- **默认产出**：单画布生成 `FrameFileV2` JSON，建议文件名 `*.verd.json`；多画布生成 `FrameExportBundle`（`verd-canvas-bundle`）JSON，同样建议 `*.verd.json`。两者都经「工作区文件树 → 导入」成为工作区画布文件。
- **FrameSnapshot** 是当前已挂载画布的内存整树结构 `{store: CellStore}`，可另存为 `*.json` 后经「画布菜单 → 打开/导入」读写当前画布；它也是转换器与程序化 API 的通用格式。
- **Markdown / Mermaid** 是纯文本导入入口，适合快速生成脑图 / 流程 / 架构草稿，保真度低于 JSON。
- **`.verd-doc.json`（`verd-document`）是独立富文本文档格式，不是画布**，本文不覆盖其内部文本模型；工作区 `.md` 导入创建的也是独立文档而非画布，注意与「画布 Markdown 导入成脑图」区分（见 §3.6）。

## 2. 数据模型速览

### 2.1 CellStore 与 Cell

一个画布的完整内容是一棵以 Frame 为根的单元树：

```jsonc
{
  "store": {
    "rootId": "canvas-id",
    "cells": {
      "canvas-id": { "id": "canvas-id", "kind": "frame", "cellType": "frame", "children": ["..."], "groups": ["..."] },
      "...": { "id": "...", "kind": "...", "cellType": "node | edge | group" },
    },
  },
}
```

- `cells` 是平铺映射：**键必须等于 `cell.id`**，同一棵树内 id 全局唯一（字符串，非空）。
- `cellType` 五种：`frame`（容器）、`node`（普通节点）、`edge`（连线）、`group`（分组）、以及 `frame` 的根特例。只有 Frame 携带 `children`/`groups`。
- `kind` 是行为类型字符串，完整合法值见附录 B；**任意字符串不是合法 kind**（未注册的 kind 通过不了产品注册表校验，也不会渲染）。
- **Frame（frame）的 `children` 数组顺序即绘制顺序**（先画的在底层）；`groups` 数组只放 `cellType: 'group'` 的成员。

### 2.2 Frame 与场景

Frame 是唯一可带 `children` 的节点，也是文件/画布边界。场景由 Frame **直接子级中的锚点 kind** 决定：

| 锚点 kind            | 场景 | 允许的内容                                                         |
| -------------------- | ---- | ------------------------------------------------------------------ |
| `mind-root`          | 脑图 | `mind-*` 节点、`mind-branch`、`mind-summary-edge`                  |
| `workflow-start`     | 流程 | `workflow-*` 节点与边                                              |
| `architecture-layer` | 架构 | `architecture-*` 节点与边                                          |
| （无锚点）           | 白板 | 除上述领域元素外的普通绘图元素、嵌套 Frame、frame-reference、group |

**强制**：三种锚点在一个 Frame 的直接子级中只能出现一种；白板 Frame 不能混入任何领域元素；脑图 Frame 不能有 group。嵌套 Frame（子 Frame）只出现在白板 Frame 内或作为文件根。

### 2.3 所有权

- 每个非 Frame Cell **恰好有一个父 Frame**（出现在某个 Frame 的 `children` 或 `groups` 中）；`cells` 中不允许孤儿。
- 一条边的两端端点必须与这条边**同属一个 Frame**（直接兄弟坐标系），不能跨 Frame 连接。
- `FrameFileV2.cells` 只放该文件**直接拥有**的非 Frame Cell；嵌套 Frame 不写入文件的 `cells`，跨文件嵌入一律走 `frame-reference`（见 §6.5）。

## 3. 可导入格式与产品入口

### 3.1 `FrameFileV2`（推荐默认产出）

```jsonc
{
  "format": "verd-frame",
  "version": 2,
  "frame": {/* FrameCell，见 §4.9 */},
  "cells": {/* 该文件直接拥有的非 Frame Cell，键=id */},
}
```

- `frame` 必须是一个 `cellType: 'frame'` 的 FrameCell。
- `cells` 中**不得**包含根 Frame 自身，也不得包含任何 `cellType: 'frame'` 的 Cell。
- `frame.children`/`frame.groups` 引用的 id 必须全部存在于 `cells` 中。
- `frame-reference` 实例放在 `cells` 中，`data.targetFrameId` 指向**另一文件的根 Frame id**。

### 3.2 `FrameExportBundle`（多画布包）

```jsonc
{
  "format": "verd-canvas-bundle",
  "version": 1,
  "files": [/* FrameFileV2[]，至少一个 */],
}
```

- `files` 内各文件根 Frame id 互不相同，全部 Cell id 跨文件唯一。
- `frame-reference` 的 `targetFrameId` 若指向包内 Cell，必须指向**某个文件的根 Frame**；指向包外的引用保留为未解析占位（允许存在，打开时显示占位壳）。
- 引用不能成环（A 引 B、B 引 A 直接拒绝）。

### 3.3 `FrameSnapshot`（当前画布整树）

```jsonc
{ "store": { "rootId": "...", "cells": { "...": {} } } }
```

- 与文件的差别：`cells` 中**可以**含嵌套 Frame（整棵树全部内联）；`rootId` 必须是 Frame。
- 根 Frame 上可有 `view.theme`；视口 (`view.viewport`) 属于运行时状态，导入时被剥离，不要手写。

### 3.4 入口对照表

| 内容                | 建议文件名           | 入口                                                              | 语义                                       |
| ------------------- | -------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| FrameFileV2         | `name.verd.json`     | 文件树「导入画布/包」                                             | 新增画布文件到工作区                       |
| verd-canvas-bundle  | `name.verd.json`     | 文件树「导入画布/包」                                             | 新增整包画布文件（含依赖闭包）             |
| FrameSnapshot       | `name.json`          | 画布菜单「打开」/「导入」                                         | 打开=替换当前画布内容；导入=插入当前 Frame |
| `.md` / `.markdown` | `name.md`            | 文件树「导入画布/包」→ 独立文档；画布「打开/导入/文本导入」→ 脑图 | 两个入口语义不同，见 §3.6                  |
| `.mmd` / `.mermaid` | `name.mmd`           | 画布「打开/导入/文本导入」                                        | 按当前 Frame 场景解释为白板/流程/架构      |
| `.verd-doc.json`    | `name.verd-doc.json` | 文件树「导入画布/包」                                             | 独立文本文档（非画布）                     |

工作区文件导入的实际 `accept` 是 `.json,.verd.json,.verd-doc.json,.md,.markdown`——**`.mmd` 不能走文件树导入**；画布菜单「打开/导入」`accept` 是 `application/json,.md,.markdown,.mmd,.mermaid`——**`.verd.json` 文件不能走画布菜单**（其 JSON 不是 FrameSnapshot）。AI 生成 `.verd.json` 时请固定走文件树导入路径。

### 3.5 打开 vs 导入

- **打开**：用文件内容**替换**当前 Frame 的全部内容（保留画布外壳/主题之外的运行时状态），随后自动适配视图。**领域锚点保护**：workflow 场景画布上「打开」任何文件都会被拒绝——`workflow-start` 不可删除，且打开时 id 会全部重映射（报 `Cannot delete a workflow start`）；mind 场景画布上打开不含 `mind-root` 的内容同样被拒（不可删除最后一个场景锚点）；architecture 场景画布上打开含 `architecture-layer` 的内容可以成功（锚点按 kind 校验）。
- **导入**：把文件内容**插入**当前 Frame——同场景内容直接并入成员；不同场景内容包装成一个嵌套 Frame 保留。所有 id 按运行时分配器重映射，重复导入不会冲突。workflow 场景画布上导入 workflow 内容会并存为**第二个分图**（各自带独立 `workflow-start`）。

### 3.6 文本格式（Markdown / Mermaid）

- **Markdown → 脑图**：标题层级映射为中心主题—子主题树；列表项也可产生子主题。**不保留**：id、布局、样式、视口、主题、富文本标记、折叠与概要。工作区文件树的 `.md` 导入创建的是 `verd-document` **独立文档**，与画布脑图无关——要生成脑图请走画布菜单。
- **Mermaid → 画布**：`flowchart`（`graph`/`flowchart`）原生解析为节点+边；`sequence`/`classDiagram` 也有原生支持；其他类型降级为图片 Cell。
- **领域限定**：`scene: 'workflow' | 'architecture'` 时**只接受 flowchart**。白板场景（默认）走通用 flowchart 映射。流程默认 `graphMode: 'dag'`（拒绝回环），可指定 `graphMode: 'process'` 允许受限回环；**自连边和连入开始事件的边两种模式都拒绝**。
- **`%% verd:` 元数据**：flowchart 中以 `%% verd:{...}` 注释行携带保真信息——`frameId`、`cellIds`（mermaid id → cell id）、`positions`、`graphs`（`{start, members, mode, origin}`，workflow 分图）、`edges`（`sourcePort`/`targetPort`）。样式、富文本、视口、主题不进入文本。
- 节点形状映射：`id[文本]`=box；`id{文本}`=decision（workflow→workflow-decision，architecture→decision 模块）；`id[(文本)]`=store（架构 store 模块）；`id([文本])` 或 `id(文本)`=stadium（workflow 里 **id 为 `start` 的节点优先成为 workflow-start**，没有则取第一个 stadium 节点）；`subgraph` 在 architecture 场景映射为 architecture-layer。

## 4. 通用字段表

标注：**必填** = 缺失即非法；**默认** = 省略时的行为；**约束** = 产品强制校验。

### 4.1 所有 Cell 公共字段

| 字段     | 类型    | 必填 | 说明                              |
| -------- | ------- | ---- | --------------------------------- |
| `id`     | string  | 是   | 非空、全局唯一、与 `cells` 键一致 |
| `kind`   | string  | 是   | 必须是附录 B 中的真实值           |
| `locked` | boolean | 否   | 锁定后不可编辑/移动/删除          |
| `hidden` | boolean | 否   | 隐藏不渲染                        |

### 4.2 NodeCell（`cellType: 'node'` 或 `'frame'`）

| 字段         | 类型              | 必填 | 说明                                                                                            |
| ------------ | ----------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `geometry`   | NodeGeometry      | 是   | 见 §4.3                                                                                         |
| `name`       | string            | 否   | 独立名称（属性面板），可与 label 不同                                                           |
| `appearance` | NodeAppearance    | 否   | 见 §4.4                                                                                         |
| `ports`      | PortSpec[]        | 否   | 见 §4.5；省略表示无可声明端口                                                                   |
| `content`    | `{label?, text?}` | 否   | `label` 为纯文本缓存；`text` 为 BoardTextDocument（§5）。渲染时 `text` 优先，缺省回落到 `label` |
| `data`       | object            | 否   | 领域专属数据，见 §6 各元素表                                                                    |

### 4.3 NodeGeometry

| 字段       | 类型                        | 必填 | 约束/默认                                                                                                                        |
| ---------- | --------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `x`, `y`   | number                      | 是   | 有限数，Frame 局部坐标                                                                                                           |
| `width`    | number                      | 是   | 有限且 **≥ 0**                                                                                                                   |
| `height`   | number                      | 是   | 有限且 **≥ 0**                                                                                                                   |
| `outline`  | string 或 `{kind, radius?}` | 否   | 必须是已注册几何名（§6.1 全表）；`radius` 仅 `rectangle`/`roundRectangle`/`terminal` 类矩形轮廓生效                              |
| `rotation` | number                      | 否   | 弧度制；**Frame 与 frame-reference 禁止旋转**                                                                                    |
| `derived`  | boolean                     | 否   | `true` 表示坐标由布局计算、x/y 只是缓存。AI 生成白板/流程/架构模块时写真实坐标即可，不用写该标志；脑图子节点与架构层按 §6 惯例写 |

### 4.4 NodeAppearance / EdgeAppearance

| 字段          | 类型     | 取值                                                        |
| ------------- | -------- | ----------------------------------------------------------- |
| `fill`        | string   | CSS 颜色；`'none'`/`'transparent'` 表示无填充（不参与命中） |
| `strokeColor` | string   | CSS 颜色；`'none'` 无描边                                   |
| `strokeWidth` | number   | ≥0，建议 1–16                                               |
| `strokeStyle` | `'solid' | 'dashed'                                                    | 'dotted'` | 默认 solid |
| `opacity`     | number   | 0–1，默认 1                                                 |
| `shadow`      | string   | UI 提供 `'none'                                             | 'sm'      | 'md'       | 'lg'` 预设（sm: dy1/blur2/0.16；md: dy4/blur8/0.18；lg: dy12/blur20/0.22），其他字符串不保证渲染 |

边 (`EdgeCell.appearance`) 只有 `strokeColor`、`strokeWidth`、`strokeStyle`、`opacity`、`shadow`——**没有 `fill`**。

### 4.5 PortSpec（节点端口）

```jsonc
{ "id": "right", "side": "right", "direction": "both", "offset": 0.5, "maxConnections": 4 }
```

| 字段             | 类型     | 必填     | 说明                                     |
| ---------------- | -------- | -------- | ---------------------------------------- |
| `id`             | string   | 是       | 节点内唯一；常用 `top/right/bottom/left` |
| `side`           | `'top'   | 'right'  | 'bottom'                                 | 'left'` | 是                                | 所在边 |
| `direction`      | `'input' | 'output' | 'both'`                                  | 是      | workflow 边校验会检查方向（§6.3） |
| `offset`         | number   | 否       | 沿边的归一化位置（0–1），默认 0.5        |
| `maxConnections` | number   | 否       | 连接数上限                               |

边端点用 `portId` 引用时，**必须**存在于该节点的 `ports` 中。

### 4.6 content 与 name

- `content.label`：纯文本标题/缓存，任意节点可写。表格/泳道正文在 `data.cells[].text`（§6.1），不在 `content`。
- `content.text`：富文本 BoardTextDocument（§5）。`plainText` 应与 `label` 保持一致。
- `name`：属性面板中独立的名称，与正文解耦；Frame/文件用 `name` 显示标题（文件树画布名优先 `frame.name`，缺省回退文件名）。

### 4.7 EdgeCell（`cellType: 'edge'`）

```jsonc
{
  "id": "e1",
  "kind": "arrow",
  "cellType": "edge",
  "source": { "cellId": "a", "portId": "right" },
  "target": { "cellId": "b", "anchor": [0.5, 0.5] },
  "route": { "mode": "orthogonal" },
  "labels": [{ "text": "调用", "position": 0.5 }],
  "data": { "sourceMarker": "none", "targetMarker": "arrow" },
}
```

| 字段              | 类型           | 必填 | 说明                                                                                             |
| ----------------- | -------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `source`,`target` | EdgeTerminal   | 是   | 二选一形态：`{cellId, portId?, anchor?}` 或 `{point:[x,y]}` 自由端点                             |
| `route`           | EdgeRoute      | 是   | `{mode:'auto'}`、`{mode:'orthogonal'                                                             | 'straight' | 'curve', points?}`、`{mode:'fixed', points}`；`points` 若给出必须 **≥2 个有限 [x,y]** |
| `labels`          | EdgeLabel[]    | 否   | `{text, position?（0–1 沿路径）, richText?（BoardTextDocument）}`；`position` 省略时自动避让布局 |
| `appearance`      | EdgeAppearance | 否   | 同 §4.4                                                                                          |
| `data`            | object         | 否   | `arrow` 用 `sourceMarker`/`targetMarker`                                                         |

端点规则：

- `cellId` 必须指向**同一 Frame 内的节点**（node 或 Frame）；`portId` 必须是其 `ports` 中已声明的端口；缺省 `portId` 时端点吸附到对侧边的中心。
- `anchor` 是端点相对节点几何的**归一化坐标**：`[0,0]`=左上，`[1,1]`=右下。
- `arrow` 支持自由端点 `{point}`；领域边（workflow/architecture/mind-branch/summary-edge）两端必须是 `cellId`。
- `arrow` 的 `data.sourceMarker`/`targetMarker`：UI 暴露 `none|arrow|solid-triangle|hollow-triangle|diamond|diamond_outline|circle|cross|one-side-up|one-side-down|single-slash`；渲染器另认识 `sharp-arrow`、`triangle_outline`、`composition`、`aggregation`、`lollipop`（UML 语义）。

### 4.8 GroupCell（`cellType: 'group'`）

```jsonc
{ "id": "g1", "kind": "group", "cellType": "group", "members": ["a", "b"] }
```

- `members` ≥2 个不重复 id；成员可含子 group（嵌套），但不能成环。
- 成员必须与 group 同属一个 Frame；成员只能是：普通节点（**不能**是 `mind-*`、`architecture-layer`）、`arrow` 边、或子 group。
- **白板 Frame 中所有叶子成员必须在 `frame.children` 中连续相邻**（绘制顺序上排在一起）；成员不能属于多个 group。

### 4.9 FrameCell 与 frame-reference

FrameCell 附加字段：

| 字段          | 类型                   | 说明                                 |
| ------------- | ---------------------- | ------------------------------------ |
| `children`    | CellId[]               | 绘制顺序；不能重复、不能有第二个父级 |
| `groups`      | CellId[]               | 只含 `cellType:'group'` 的 id        |
| `aspectRatio` | `'custom'              | 'a4'                                 | '1:1' | '4:3' | '16:10' | '16:9' | 'browser' | 'tablet' | 'phone'` | 内容区约束比例，缺省不限 |
| `view`        | `{theme?: BoardTheme}` | 画布主题，见 §4.10                   |

`frame-reference`（`cellType:'node'`，kind `frame-reference`）是**跨文件嵌入实例**，不拥有目标内容：

```jsonc
{
  "id": "ref-1",
  "kind": "frame-reference",
  "cellType": "node",
  "geometry": { "x": 320, "y": 120, "width": 560, "height": 340 },
  "data": { "targetFrameId": "canvas-detail", "mindOffsets": { "mind-root": [0, 0] } },
}
```

- `data.targetFrameId`：**必填非空字符串**，指向目标文件根 Frame id；`mindOffsets`（可选）按 mind-root id 记录嵌入脑树的平移（每项为有限 [x,y]）。
- 位置/尺寸/外观/端口/名称/宽高比/锁定/隐藏都按实例保存；目标文件负责内容与主题。
- 实例不能旋转；引用目标必须解析为**文件根**；引用图不能有环。
- **不要在 `FrameFileV2` 里写嵌套 Frame**：嵌套场景由 `frame-reference` + 独立文件表达；`FrameSnapshot` 内嵌套 Frame 是合法整树形态（导入时被分区为文件+引用）。

### 4.10 主题 BoardTheme

写在 Frame 的 `view.theme` 中：

```jsonc
{ "themeColorMode": "default", "boardBackground": "#ffffff", "gridEnabled": false, "gridSize": 20 }
```

| 字段              | 类型    | 说明                                                                     |
| ----------------- | ------- | ------------------------------------------------------------------------ |
| `themeColorMode`  | string  | 必填（写 theme 时）：`default`/`colorful`/`soft`/`retro`/`dark`/`starry` |
| `boardBackground` | string  | 覆盖默认背景色（默认见下表）                                             |
| `gridEnabled`     | boolean | 网格开关                                                                 |
| `gridSize`        | number  | 网格间距                                                                 |

主题默认：`default`/`colorful` 背景 `#ffffff`、文字 `#333333`；`soft` `#f5f5f5`；`retro` `#f9f8ed`；`dark` `#141414`/`#FFFFFF`；`starry` `#0d2537`/`#FFFFFF`。

## 5. 富文本 BoardTextDocument

节点 `content.text`、表格单元格 `data.cells[].text`、边标签 `labels[].richText`、脑图 `data.note` 共用同一持久化结构（TipTap/ProseMirror JSON 包一层信封）：

```jsonc
{
  "schemaVersion": 1,
  "id": "任意唯一字符串",
  "kind": "inline" | "block",
  "content": {
    "type": "doc",
    "content": [
      { "type": "paragraph", "content": [
          { "type": "text", "text": "普通" },
          { "type": "text", "text": "加粗", "marks": [{ "type": "bold" }] }
      ] }
    ]
  },
  "plainText": "普通加粗",
  "align": "center"
}
```

| 字段            | 类型             | 必填     | 说明                                                            |
| --------------- | ---------------- | -------- | --------------------------------------------------------------- |
| `schemaVersion` | `1`              | 是       | 固定为 1                                                        |
| `id`            | string           | 是       | 文档 id（生成一个稳定字符串即可）                               |
| `kind`          | `'inline'        | 'block'` | 是                                                              | 形状/脑图内联文本用 `inline`；表格单元格、脑图备注用 `block` |
| `content`       | ProseMirror JSON | 是       | 根固定 `{type:'doc'}`                                           |
| `plainText`     | string           | 是       | **纯文本缓存，必须与 content 派生文本一致**（导入时可能被重算） |
| `align`         | `'left'          | 'center' | 'right'`                                                        | 否                                                           | 整体对齐 |

常用节点：`doc`、`paragraph`、`heading`（`attrs.level` 1–6、`attrs.textAlign`）、`text`、`hardBreak`、`bulletList`/`orderedList`/`listItem`、`blockquote`、`codeBlock`、`horizontalRule`、`table`/`tableRow`/`tableCell`/`tableHeader`、`image`（`attrs.src/alt/title`）。

常用 marks：`bold`、`italic`、`underline`、`strike`、`code`、`link`（`attrs.href`）、`textStyle`（`attrs.color`、`fontSize`、`fontFamily`）、`highlight`（`attrs.color`）、`superscript`、`subscript`。**未知类型会导致编辑器 schema 报错——只用上表列出的类型。**

## 6. 元素目录

### 6.1 白板元素

#### `geometry`（几何图形，含文本）

`kind: 'geometry'`，形状由 `geometry.outline` 决定。`outline: 'text'` 即**文本形状**（配 `fill:'none'`、`strokeColor:'none'`）。内置 `outline` 全表（`builtinShapeGeometries` 注册表，任意其他字符串**不保证**渲染）：

| 类别      | outline 值                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础      | `rectangle`、`roundRectangle`、`ellipse`、`diamond`、`terminal`、`store`、`text`、`underline`                                                                                                                                                                       |
| 流程图    | `process`、`predefinedProcess`、`decision`、`data`、`document`、`multiDocument`、`manualInput`、`manualLoop`、`preparation`、`delay`、`storedData`、`merge`、`offPage`、`display`、`internalStorage`、`database`、`hardDisk`                                        |
| 方向/标注 | `leftArrow`、`rightArrow`、`twoWayArrow`、`pentagonArrow`、`processArrow`、`triangle`、`trapezoid`、`parallelogram`、`pentagon`、`hexagon`、`octagon`、`star`、`cross`、`comment`、`roundComment`、`cloud`、`note`、`noteCurlyLeft`、`noteCurlyRight`、`noteSquare` |
| 逻辑/其他 | `or`、`summingJunction`、`connector`、`branchMerge`、`container`、`actor`                                                                                                                                                                                           |
| UML       | `simpleClass`、`object`、`port`、`activation`、`useCase`、`activityClass`、`package`、`combinedFragment`、`class`、`interface`、`component`、`componentBox`、`template`、`deletion`、`providedInterface`、`requiredInterface`、`assembly`                           |

推荐尺寸与样式：`{width:160,height:64}` 左右；`fill`/`strokeColor`/`strokeWidth` 常规 `'#fff'`+`'#64748b'`+2；文本形状固定 `outline:'text'` + `fill/strokeColor:'none'`。`{kind:'roundRectangle',radius:8}` 可自定义圆角。

#### `image`（图片）

```jsonc
{ "kind": "image", "cellType": "node", "geometry": {...}, "data": { "url": "data:image/..." } }
```

- `data.url` 必填：自包含 `data:` URL（base64 或 URL 编码 SVG）；外部 http(s) URL 也能渲染，但要求网络可达。**AI 生成请一律使用 data URL**。
- 尺寸建议：宽度 ≤ 600、高度 ≤ 400（UI 插入图片时按此上限缩放）。

#### `table`（表格）与 `swimlane`（泳道）

二者共用 `TableCellData`，泳道只是带 `direction`/`header`/角色语义的表格：

```jsonc
"data": {
  "rows":    [{ "id": "r0", "height": 40 }, ...],
  "columns": [{ "id": "c0", "width": 120 }, ...],
  "cells":   [{ "id": "e0", "rowId": "r0", "columnId": "c0",
                "rowspan": 1, "colspan": 2, "role": "body",
                "textDirection": "horizontal", "fill": "#f1f5f9",
                "text": { /* BoardTextDocument kind:'block' */ } }],
  "direction": "horizontal",   // 仅 swimlane 必填
  "header": true               // 仅 swimlane 语义（标题轨道）
}
```

约束：

- `rows`/`columns`/`cells` 均非空；各 id 唯一；`rowId`/`columnId` 引用必须存在。
- `rowspan`/`colspan` 为正整数；**所有单元格必须恰好铺满 `rows × columns` 网格**——不重叠、不留洞。合并单元格 = 一个 `colspan`/`rowspan` >1 的 entry 覆盖多格，被覆盖位置**不再**写单独 entry。
- 行高/列宽可省略（未指定的轨道平分剩余空间）；指定值必须 >0。
- 表格行高建议 36–48，泳道标题/泳道头轨道宽/高 ≈ 42，正文区留足。
- `role`: `'title'|'lane'|'body'`（泳道语义标注）；`textDirection`: `'horizontal'|'vertical'`。水平泳道标题/泳道文字用 `vertical`，垂直泳道用 `horizontal`（与产品内置一致）。

水平泳道结构（`direction:'horizontal'`，`header:true`，N 条泳道）：`rows=N`；`columns=[标题列(42), 泳道列(42), 正文列]`；entries：标题 entry `columnId=第1列, rowspan=N, role:'title'`；每行泳道头 entry `role:'lane'`；每行正文 entry `role:'body'`。垂直泳道是其行列转置：`columns=N`；`rows=[标题行(42), 泳道行(42), 正文行]`；标题 entry `rowId=第1行, colspan=N`。

#### `freehand`（笔迹）

```jsonc
{
  "kind": "freehand",
  "data": {
    "shape": "feltTipPen",
    "points": [
      [0, 0],
      [40, 10],
      [80, 4],
    ],
  },
}
```

- `data.shape`: `'nibPen'|'feltTipPen'|'artisticBrush'|'markerHighlight'`。
- `data.points`：**局部坐标**（相对 geometry.x/y），点都在 geometry 范围内；geometry 包住所有点（宽高 ≥1）。
- 默认样式：`nibPen/feltTipPen` 宽 3、`artisticBrush` 宽 6、`markerHighlight` 宽 16 + `opacity:0.35`（荧光笔半透明）。

#### `vector-line`（折线/曲线）

```jsonc
{
  "kind": "vector-line",
  "data": {
    "shape": "straight",
    "points": [
      [0, 0],
      [70, 0],
      [70, 60],
    ],
  },
}
```

- `data.shape`: `'straight'|'curve'`；`points` ≥2 个有限局部点。首尾相同即闭合。
- geometry 同样包住所有点；`fill:'none'`、描边常规 2。

#### `arrow`（连接线）

见 §4.7 完整字段。要点：推荐 `route.mode:'auto'`（自动避障正交路由）或 `'orthogonal'`；`fixed`/`curve`/`straight` 自带 points 时必须 ≥2 点；标签用 `labels:[{text}]`。

### 6.2 脑图元素（mind Frame）

```jsonc
{ "kind": "mind-root", "data": { "layout": "right", "rightNodeCount": 2, "maxNodeWidth": 200 } }
{ "kind": "mind-child", "data": { "collapsed": true, "manualWidth": 160 } }
{ "kind": "mind-summary" }
{ "kind": "mind-branch", "data": { "order": "00000001" } }
{ "kind": "mind-summary-edge", "data": { "startSiblingId": "a", "endSiblingId": "b" } }
```

| 元素                | 角色       | data 字段                                                                                                                                                    | 约束                                                                                                          |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `mind-root`         | 中心主题   | `layout`、`rightNodeCount?`、`maxNodeWidth?`、`embeddedOffset?`、MindNodeData 其余字段                                                                       | 不能有入向 `mind-branch`；不能 `collapsed:true`；`maxNodeWidth` 为整数 80–2000（缺省 240）                    |
| `mind-child`        | 子主题     | `collapsed?`、`manualWidth?`、`note?`、`noteCollapsed?`、`image?`、`emojis?`、`branchAppearance?`、`branchShape?`、`fontSize?`、`layout?`、`rightNodeCount?` | **恰好一条**入向 `mind-branch`                                                                                |
| `mind-summary`      | 概要节点   | 同 MindChildData 基座                                                                                                                                        | **恰好一条**入向 `mind-summary-edge`                                                                          |
| `mind-branch`       | 父子边     | `order: string`（必填、父内唯一，惯例 8 位补零序号）                                                                                                         | source=mind-root/mind-child，target=mind-child；不能成环                                                      |
| `mind-summary-edge` | 概要范围边 | `startSiblingId`,`endSiblingId`（必填）                                                                                                                      | target=mind-summary；`source.cellId` 必须等于 `startSiblingId`；两端必须是同一父节点的兄弟且 start 不晚于 end |

- `layout` 枚举：`right|left|standard|upward|downward|right-bottom-indented|right-top-indented|left-top-indented|left-bottom-indented`（`standard` 为左右平衡，`rightNodeCount` 表示右侧一级子主题数）。
- `branchShape`: `'bight'`（曲线）|`'polyline'`（折线），缺省按曲线处理；`branchAppearance` 覆盖该子树分支描边。
- `note` 是 BoardTextDocument（kind:'block'），`noteCollapsed` 折叠；`image:{url,width,height}`；`emojis:[{name:'🌿'}]`；`manualWidth` 为该节点固定宽度。
- **脑图位置由树布局实时计算**：root 用自己的 `geometry.x/y` 锚定整棵树；所有 mind-child/mind-summary 的 `geometry` 写 `{x:0,y:0,width:120,height:40,derived:true}`（width/height 只是缓存，`manualWidth` 才参与布局）。
- 推荐 root 尺寸 160×56、`outline:'roundRectangle'`；mind-child outline 可写 `roundRectangle`（默认）或 `underline`。

### 6.3 流程元素（workflow Frame）

```jsonc
{ "kind": "workflow-start", "data": { "graphMode": "dag", "origin": [60, 140], "memberIds": [...] } }
{ "kind": "workflow-task" | "workflow-decision" }
{ "kind": "workflow-edge" }
```

| 元素                | outline/端口                                            | data             | 约束                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow-start`    | `terminal`；4 侧端口 `direction:'output'`, `offset:0.5` | `graphMode:'dag' | 'process'`、`origin:[x,y]`、`memberIds:string[]`                                                                                                                                                                                                      | `memberIds` 必须包含自身；成员去重且均为同一 Frame 内 `workflow-start | task | decision`；每个流程节点**恰好属于一个** start |
| `workflow-task`     | `roundRectangle`；4 侧 `direction:'both'`               | —                | 必须在某个 start 的 `memberIds` 内                                                                                                                                                                                                                    |
| `workflow-decision` | `diamond`；同上                                         | —                | 同上                                                                                                                                                                                                                                                  |
| `workflow-edge`     | —                                                       | —                | 两端 `cellId`；source≠target；target 不能是 start；两端必须在**同一流程图**（同一 start 成员集）；source/target **必须带 `portId`** 且已声明，source 端口 direction ≠ `input`、target ≠ `output`；同一 (source,target) 不允许重复；`dag` 模式禁止回环 |

- `origin` 与 start 的 `geometry.x/y` 保持一致（移动 start 时二者同步）。
- 推荐尺寸：start 120×40（terminal），task 160×48，decision 120×80。
- `process` 模式允许受限回环（如失败后回到前序任务）；`dag` 模式严格无环。无论哪种模式，自连边、连入 start 的边均拒绝。

### 6.4 架构元素（architecture Frame）

```jsonc
{ "kind": "architecture-layer",  "data": { "order": "00000001", "memberIds": [...] } }
{ "kind": "architecture-module", "data": { "shape": "box", "placed": true } }
{ "kind": "architecture-edge" }
```

| 元素                  | outline                                              | data                                                              | 约束                                                                                                                     |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `architecture-layer`  | `rectangle`，`derived:true`                          | `order:string`（层排序，惯例 8 位补零序号）、`memberIds:string[]` | 成员去重、全部是同一 Frame 内 `architecture-module`；层几何由成员包围盒派生（顶部留 44 标题、左右 20、底部 16、层间 72） |
| `architecture-module` | `roundRectangle`/`diamond`/`store` 对应 `shape:'box' | 'decision'                                                        | 'store'`                                                                                                                 | `shape`、`placed?:boolean` | 必须**恰好属于一个层** |
| `architecture-edge`   | —                                                    | —                                                                 | 两端必须都是 `architecture-module`、不可自连                                                                             |

- 模块写真实 `x/y` 与 `placed:true`（导入物化语义）；不写 `placed` 且 `derived:true` 的模块会按行内 24 间距排在层内顶部。
- 推荐模块尺寸：box 240×44、decision 160×88、store 160×88；层内水平间距 ≥24。层框 = 成员包围盒外扩（上 44、左右 20、下 16），因此**下一层成员顶边应比上一层成员底边至少低 60**（44 标题 + 16 底衬）层框才不重叠；留到 132（再含 72 层间缓冲）更接近产品自动排布的观感。
- 架构 children 顺序惯例：`architecture-layer` 排在最前（垫底），模块随后，边最后。

### 6.5 容器与分组

- **嵌套 Frame**：只写在 `FrameSnapshot.store.cells` 里（整树内联），`FrameFileV2` 中一律以 `frame-reference` + 独立文件代替。
- **`frame-reference`**：见 §4.9。
- **`group`**：见 §4.8。

## 7. 关系与校验约束（产品强制）

| #   | 规则                                                                                                                                        | 违反报错（节选）                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `cells` 键 === `cell.id`                                                                                                                    | `Cell key does not match id`                                                                                                                                        |
| 2   | 根必须是 Frame；根不能有父级                                                                                                                | `Root must be a frame` / `Root cannot have a parent`                                                                                                                |
| 3   | 每个非 Frame Cell 恰好属于一个 Frame；Frame 的 children/groups 无重复、无缺失                                                               | `Missing child`、`Repeated child`、`Cell has multiple parents`、`Cell must belong to a frame`                                                                       |
| 4   | group 只能列在 `frame.groups`，且其成员满足 §4.8                                                                                            | `Groups must be listed in frame.groups`、`Invalid group member`、`Cell belongs to multiple groups`、`Group members must be consecutive in one frame`、`Group cycle` |
| 5   | 一个 Frame 只能有一种场景锚点；内容与本场景匹配；脑图 Frame 无 group                                                                        | `Mixed frame scenes`、`Cell does not belong to the frame scene`、`Groups are not allowed in mind frames`                                                            |
| 6   | `geometry` 有限、宽高 ≥0；Frame 与 frame-reference 无 `rotation`                                                                            | `Invalid geometry`、`Frames cannot rotate`、`Frame references cannot rotate`                                                                                        |
| 7   | 节点 `ports` 内 id 唯一                                                                                                                     | `Duplicate ports`                                                                                                                                                   |
| 8   | 边两端必须是 `{cellId}` 或 `{point}`；`cellId` 端点是同 Frame 节点、`portId` 已声明、`anchor` 为有限 [x,y]；`route.points` 给出时 ≥2 有限点 | `Edge endpoint must be a node`、`Edge crosses frame boundary`、`Unknown endpoint port`、`Invalid bound anchor`、`Invalid route points`                              |
| 9   | `frame-reference`：`targetFrameId` 非空、`mindOffsets` 为有限点表；目标（存在时）必须是文件根；引用无环                                     | `Frame reference requires a target`、`Frame reference target is not a file root`、`Frame reference cycle`                                                           |
| 10  | `FrameFileV2`：`cells` 不含根自身、不含 Frame；跨文件 Cell id 唯一；包内文件根不重复                                                        | `Invalid frame file`、`Duplicate cell id across files`、`Duplicate frame root`                                                                                      |
| 11  | 领域约束：workflow（§6.3）、architecture（§6.4）、mind（§6.2）、table/swimlane 网格覆盖（§6.1）、vector-line 点数                           | 各领域报错见对应小节                                                                                                                                                |

### 常见错误与正确写法

| 错误写法                                 | 后果                                                              | 正确写法                                                        |
| ---------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `cells` 里塞入 `cellType:'frame'`        | `Invalid frame file`                                              | 嵌套画布拆成独立文件 + `frame-reference`                        |
| workflow-edge 不带 `portId`              | `Incompatible workflow ports`                                     | 两端都写已声明端口（`top/right/bottom/left`）                   |
| 边的两端连不同 Frame 的节点              | `Edge crosses frame boundary`                                     | 端点与边同 Frame；跨画布用 frame-reference 导航                 |
| mind-child 有两条入向 branch 或 0 条     | `Mind child must have exactly one branch parent`                  | 每个 child 恰好一条 `mind-branch`                               |
| `mind-branch.data.order` 兄弟间重复/缺失 | `Mind sibling order must be unique`                               | 按 `00000000…` 递增、父内唯一                                   |
| 表格 entry 没铺满网格或有重叠            | `Overlapping table entries` / `Table entries must cover the grid` | 用 rowspan/colspan 精确铺满                                     |
| group 成员在 `children` 中不相邻         | `Group members must be consecutive in one frame`                  | 把成员在 children 中排到一起（或放领域 Frame 里不适用白板约束） |
| `outline` 写 `rounded`/`rect`/`box`      | 渲染退化/校验不识别                                               | 用上表真实值（`roundRectangle`/`rectangle`）                    |
| `route:{mode:'fixed'}` 但只有 1 个点     | `Invalid route points`                                            | fixed/curve 至少 2 点，或改 `auto`/`orthogonal`                 |
| workflow-start 被某条边指向              | `Cannot connect to a start`                                       | start 只能作 source                                             |
| 脑图 Frame 内写 group                    | `Groups are not allowed in mind frames`                           | 脑图内不要分组                                                  |

## 8. 坐标、尺寸与布局约定

- **坐标系**：Frame 局部坐标（点 [x,y] 相对 Frame 左上角）；边两端节点与边本身同系。嵌套 Frame 内部有自己的局部系。
- **绘制顺序** = `frame.children` 顺序；连线画在节点之后更稳妥。
- **尺寸/留白**：文本节点按字号×0.6×字符数 + 24 估算宽度，节点高度给足（单行 40–56，多行按行数+8/行）；形状内文字安全区约为几何内接区域的 70–80%（菱形等只有中部一半宽）；图片按 600×400 上限缩；表格/泳道见 §6.1。
- **白板**：直接写真实坐标。推荐水平流间距 80–120、垂直层间距 80–120、节点间距 ≥60；边默认 `auto`/`orthogonal` 自动绕开同 Frame 可见障碍。
- **脑图**：结构优先——只写父子边与兄弟顺序、root 坐标；子节点位置交给树布局（节点大小由文字测量，`maxNodeWidth` 控宽）。**不要**手工计算整树坐标。
- **流程**：写真实坐标（`derived` 省略或 false）。DAG 按层从左到右/从上到下铺开，同层节点 y 对齐，层间水平间距 80–160；`process` 回环边用 orthogonal 折线绕到源节点下方/侧方返回。
- **架构**：模块写真实坐标+`placed:true`；**层框由成员派生**——按层内成员最小外接矩形 + 顶 44/侧 20/底 16/层间 72 的规则预留空间；层按 `data.order` 从上到下排列；模块间水平间距 ≥24。
- **不承诺自动重排**：导入不会为任意手写数据重新布局（只有粘贴/打开时 workflow/architecture 的 `derived` 坐标会被物化、mind 由树布局接管）。布局合理的责任在生成方。
- **旋转**：`rotation` 弧度制，绕节点中心；Frame/frame-reference/脑图节点不可旋转（脑图节点的旋转字段被忽略）。

## 9. AI 输出约定

### 9.1 输出硬性要求

- 只输出**一个完整 JSON**（或要求的单个文本文件），无省略号、无注释、无占位符——除非刻意写未解析 `frame-reference`。
- 所有 id 非空、全文档唯一；`cells` 键与 `id` 完全一致。
- 所有引用闭合：Frame `children`/`groups`、边端点 `cellId`/`portId`、`frame.groups` 成员、领域 `memberIds`/`startSiblingId`/`endSiblingId`、表格 `rowId`/`columnId`、`frame-reference.targetFrameId`。
- `content.label` 与 `content.text.plainText` 一致；表格 `plainText` 与单元格文本一致。
- 不写 `view.viewport`、不写 `derived` 缓存坐标冒充真实坐标；`rotation` 仅白板普通节点可用（弧度）。

### 9.2 可复用提示词

```
请按 VerdBoard 画布数据规范生成数据。要求：
1. 输出 FrameFileV2（format:'verd-frame', version:2）：一个 frame（含 children/groups/name/view.theme）+ cells 字典（不含根 Frame 自身、不含 frame）。多画布输出 verd-canvas-bundle。
2. 文件名建议 *.verd.json，工作区「导入画布/包」直接导入。
3. 场景限定：白板只用 geometry/image/table/swimlane/freehand/vector-line/arrow/frame-reference/group；脑图只用 mind-*；流程只用 workflow-*；架构只用 architecture-*，不混场景。
4. 所有 id 唯一且 cells 键==id；所有引用闭合；frame.children 顺序=绘制顺序；group 叶子成员在 children 中连续。
5. 白板/流程/架构节点写真实 x/y（流程写 portId 连接，架构模块 placed:true，层 data.order 8 位补零）；脑图只写 root 坐标与 mind-branch.data.order，子节点 geometry derived。
6. 端口/锚点/路由/标签/外观/富文本字段按规范取值（outline/kind/marker/layout/shape 只用规范列出的真实枚举）。
7. 布局留白充分：节点间距 ≥60，文本按 字号*0.6+24 估算宽度；图片 data URL 自包含。
8. 不输出注释、省略号或占位符；plainText 与 content 一致。
```

### 9.3 生成前检查清单

- [ ] 顶层结构是 `verd-frame`/`verd-canvas-bundle`/`{store:…}` 三者之一，字段名完全匹配。
- [ ] 所有 kind 出自附录 B；所有 outline 出自 §6.1 表（或确认已注册）。
- [ ] `cells` 键 == `id`；无重复 id；无孤儿（除根外每个 Cell 都在某 Frame 的 children/groups 中）。
- [ ] Frame `children`/`groups` 中每个 id 存在于 `cells`；groups 只含 `cellType:'group'`。
- [ ] 场景锚点唯一；白板无领域元素；脑图无 group；边端点与边同 Frame。
- [ ] `portId` 均已声明；`anchor`/`route.points`/`data.points` 均为有限 [x,y]。
- [ ] workflow：start `memberIds` 含全部节点、edge 带 portId、dag 无环、target 非 start。
- [ ] architecture：层 `memberIds` 与模块一一对应、边两端都是模块。
- [ ] mind：每 child 一条入向 branch、`order` 父内唯一、summary 恰好一条 summary-edge 且范围是同父兄弟。
- [ ] 表格 entries 恰好铺满网格；泳道方向/轨道结构与 §6.1 一致。
- [ ] `frame-reference.targetFrameId` 非空、指向文件根、无环。
- [ ] `plainText` 与富文本一致；无 `view.viewport`。

## 10. 完整示例

以下每例均可直接另存后按标注入口导入；`doc/examples/ai-canvas/` 中有同名文件。

### 10.1 基础白板

- **文件**: `doc/examples/ai-canvas/whiteboard-basic.verd.json`（FrameFileV2）
- **入口**: 工作区文件树「导入画布/包」
- **预期**: 三个图形（圆角矩形/矩形/菱形）+ 文本节点，两条带标签箭头（`auto` 与 `orthogonal` 路由），菱形与文本组成一个 group。

```json doc/examples/ai-canvas/whiteboard-basic.verd.json
{
  "format": "verd-frame",
  "version": 2,
  "frame": {
    "id": "canvas-basic",
    "kind": "frame",
    "cellType": "frame",
    "name": "基础白板",
    "geometry": { "x": 0, "y": 0, "width": 960, "height": 640 },
    "children": ["shape-request", "shape-process", "shape-decision", "text-note", "arrow-1", "arrow-2"],
    "groups": ["group-review"],
    "view": { "theme": { "themeColorMode": "default" } }
  },
  "cells": {
    "shape-request": {
      "id": "shape-request",
      "kind": "geometry",
      "cellType": "node",
      "geometry": {
        "x": 80,
        "y": 120,
        "width": 160,
        "height": 64,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both" },
        { "id": "right", "side": "right", "direction": "both" },
        { "id": "bottom", "side": "bottom", "direction": "both" },
        { "id": "left", "side": "left", "direction": "both" }
      ],
      "appearance": {
        "fill": "#ffffff",
        "strokeColor": "#64748b",
        "strokeWidth": 2
      },
      "content": { "label": "提交请求" }
    },
    "shape-process": {
      "id": "shape-process",
      "kind": "geometry",
      "cellType": "node",
      "geometry": {
        "x": 360,
        "y": 120,
        "width": 160,
        "height": 64,
        "outline": "process"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both" },
        { "id": "right", "side": "right", "direction": "both" },
        { "id": "bottom", "side": "bottom", "direction": "both" },
        { "id": "left", "side": "left", "direction": "both" }
      ],
      "appearance": {
        "fill": "#eff6ff",
        "strokeColor": "#2563eb",
        "strokeWidth": 2
      },
      "content": { "label": "系统处理" }
    },
    "shape-decision": {
      "id": "shape-decision",
      "kind": "geometry",
      "cellType": "node",
      "geometry": {
        "x": 640,
        "y": 104,
        "width": 140,
        "height": 96,
        "outline": "diamond"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both" },
        { "id": "right", "side": "right", "direction": "both" },
        { "id": "bottom", "side": "bottom", "direction": "both" },
        { "id": "left", "side": "left", "direction": "both" }
      ],
      "appearance": {
        "fill": "#fefce8",
        "strokeColor": "#a16207",
        "strokeWidth": 2
      },
      "content": { "label": "需要复核?" }
    },
    "text-note": {
      "id": "text-note",
      "kind": "geometry",
      "cellType": "node",
      "geometry": {
        "x": 640,
        "y": 240,
        "width": 200,
        "height": 40,
        "outline": "text"
      },
      "appearance": {
        "fill": "none",
        "strokeColor": "none",
        "strokeWidth": 2
      },
      "content": { "label": "人工复核入口" }
    },
    "arrow-1": {
      "id": "arrow-1",
      "kind": "arrow",
      "cellType": "edge",
      "source": { "cellId": "shape-request", "portId": "right" },
      "target": { "cellId": "shape-process", "portId": "left" },
      "route": { "mode": "auto" },
      "labels": [{ "text": "创建工单" }],
      "data": { "sourceMarker": "none", "targetMarker": "arrow" }
    },
    "arrow-2": {
      "id": "arrow-2",
      "kind": "arrow",
      "cellType": "edge",
      "source": { "cellId": "shape-process", "portId": "right" },
      "target": { "cellId": "shape-decision", "portId": "left" },
      "route": { "mode": "orthogonal" },
      "labels": [{ "text": "校验" }],
      "appearance": { "strokeColor": "#334155", "strokeWidth": 2 },
      "data": { "sourceMarker": "none", "targetMarker": "arrow" }
    },
    "group-review": {
      "id": "group-review",
      "kind": "group",
      "cellType": "group",
      "members": ["shape-decision", "text-note"]
    }
  }
}
```

### 10.2 进阶白板

- **文件**: `doc/examples/ai-canvas/whiteboard-advanced.verd.json`（FrameFileV2）
- **入口**: 工作区文件树「导入画布/包」
- **预期**: 内嵌 SVG 图片、带加粗/链接/彩色字号的富文本、首行合并单元格的 3×3 表格、水平与垂直两种泳道、荧光笔迹、一条直角折线与一条曲线。

```json doc/examples/ai-canvas/whiteboard-advanced.verd.json
{
  "format": "verd-frame",
  "version": 2,
  "frame": {
    "id": "canvas-advanced",
    "kind": "frame",
    "cellType": "frame",
    "name": "进阶白板",
    "geometry": { "x": 0, "y": 0, "width": 1240, "height": 720 },
    "children": ["image-logo", "pen-mark", "text-rich", "table-plan", "lane-h", "lane-v", "line-zig", "line-curve"],
    "groups": []
  },
  "cells": {
    "image-logo": {
      "id": "image-logo",
      "kind": "image",
      "cellType": "node",
      "name": "内嵌 SVG",
      "geometry": { "x": 64, "y": 64, "width": 160, "height": 120 },
      "data": {
        "url": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='120'%3E%3Crect width='160' height='120' rx='12' fill='%232563eb'/%3E%3Ctext x='80' y='70' font-family='sans-serif' font-size='26' fill='white' text-anchor='middle'%3EVerd%3C/text%3E%3C/svg%3E"
      }
    },
    "pen-mark": {
      "id": "pen-mark",
      "kind": "freehand",
      "cellType": "node",
      "geometry": { "x": 64, "y": 196, "width": 224, "height": 24 },
      "appearance": {
        "strokeColor": "#f59e0b",
        "strokeWidth": 16,
        "opacity": 0.35
      },
      "data": {
        "shape": "markerHighlight",
        "points": [
          [4, 14],
          [56, 10],
          [112, 8],
          [168, 10],
          [220, 6]
        ]
      }
    },
    "text-rich": {
      "id": "text-rich",
      "kind": "geometry",
      "cellType": "node",
      "geometry": {
        "x": 64,
        "y": 232,
        "width": 400,
        "height": 64,
        "outline": "text"
      },
      "appearance": {
        "fill": "none",
        "strokeColor": "none",
        "strokeWidth": 2
      },
      "content": {
        "label": "白板数据 规范 · 示例库 v2",
        "text": {
          "schemaVersion": 1,
          "id": "text-rich-doc",
          "kind": "inline",
          "content": {
            "type": "doc",
            "content": [
              {
                "type": "paragraph",
                "content": [
                  { "type": "text", "text": "白板数据 " },
                  {
                    "type": "text",
                    "text": "规范",
                    "marks": [{ "type": "bold" }]
                  },
                  { "type": "text", "text": " · " },
                  {
                    "type": "text",
                    "text": "示例库",
                    "marks": [
                      {
                        "type": "link",
                        "attrs": { "href": "https://devin.ai" }
                      }
                    ]
                  },
                  { "type": "text", "text": " " },
                  {
                    "type": "text",
                    "text": "v2",
                    "marks": [
                      {
                        "type": "textStyle",
                        "attrs": { "color": "#2563eb", "fontSize": "20px" }
                      }
                    ]
                  }
                ]
              }
            ]
          },
          "plainText": "白板数据 规范 · 示例库 v2"
        }
      }
    },
    "table-plan": {
      "id": "table-plan",
      "kind": "table",
      "cellType": "node",
      "geometry": { "x": 64, "y": 330, "width": 400, "height": 160 },
      "appearance": {
        "fill": "#ffffff",
        "strokeColor": "#64748b",
        "strokeWidth": 1
      },
      "data": {
        "rows": [{ "id": "tr0" }, { "id": "tr1" }, { "id": "tr2" }],
        "columns": [{ "id": "tc0" }, { "id": "tc1" }, { "id": "tc2" }],
        "cells": [
          {
            "id": "te0",
            "rowId": "tr0",
            "columnId": "tc0",
            "colspan": 2,
            "fill": "#f1f5f9",
            "text": {
              "schemaVersion": 1,
              "id": "te0-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "季度目标" }]
                  }
                ]
              },
              "plainText": "季度目标"
            }
          },
          {
            "id": "te1",
            "rowId": "tr0",
            "columnId": "tc2",
            "fill": "#f1f5f9",
            "text": {
              "schemaVersion": 1,
              "id": "te1-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "负责人" }]
                  }
                ]
              },
              "plainText": "负责人"
            }
          },
          {
            "id": "te2",
            "rowId": "tr1",
            "columnId": "tc0",
            "text": {
              "schemaVersion": 1,
              "id": "te2-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "白板导入" }]
                  }
                ]
              },
              "plainText": "白板导入"
            }
          },
          {
            "id": "te3",
            "rowId": "tr1",
            "columnId": "tc1",
            "text": {
              "schemaVersion": 1,
              "id": "te3-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "已完成" }]
                  }
                ]
              },
              "plainText": "已完成"
            }
          },
          {
            "id": "te4",
            "rowId": "tr1",
            "columnId": "tc2",
            "text": {
              "schemaVersion": 1,
              "id": "te4-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "An" }]
                  }
                ]
              },
              "plainText": "An"
            }
          },
          {
            "id": "te5",
            "rowId": "tr2",
            "columnId": "tc0",
            "text": {
              "schemaVersion": 1,
              "id": "te5-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "多画布包" }]
                  }
                ]
              },
              "plainText": "多画布包"
            }
          },
          {
            "id": "te6",
            "rowId": "tr2",
            "columnId": "tc1",
            "text": {
              "schemaVersion": 1,
              "id": "te6-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "进行中" }]
                  }
                ]
              },
              "plainText": "进行中"
            }
          },
          {
            "id": "te7",
            "rowId": "tr2",
            "columnId": "tc2",
            "text": {
              "schemaVersion": 1,
              "id": "te7-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "Bei" }]
                  }
                ]
              },
              "plainText": "Bei"
            }
          }
        ]
      }
    },
    "lane-h": {
      "id": "lane-h",
      "kind": "swimlane",
      "cellType": "node",
      "geometry": { "x": 520, "y": 64, "width": 520, "height": 220 },
      "appearance": {
        "fill": "#ffffff",
        "strokeColor": "#64748b",
        "strokeWidth": 1
      },
      "data": {
        "direction": "horizontal",
        "header": true,
        "rows": [{ "id": "hr0" }, { "id": "hr1" }],
        "columns": [{ "id": "hc0", "width": 42 }, { "id": "hc1", "width": 42 }, { "id": "hc2" }],
        "cells": [
          {
            "id": "he-title",
            "rowId": "hr0",
            "columnId": "hc0",
            "rowspan": 2,
            "textDirection": "vertical",
            "role": "title",
            "text": {
              "schemaVersion": 1,
              "id": "he-title-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "项目泳道" }]
                  }
                ]
              },
              "plainText": "项目泳道"
            }
          },
          {
            "id": "he-lane0",
            "rowId": "hr0",
            "columnId": "hc1",
            "textDirection": "vertical",
            "role": "lane",
            "text": {
              "schemaVersion": 1,
              "id": "he-lane0-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "设计" }]
                  }
                ]
              },
              "plainText": "设计"
            }
          },
          {
            "id": "he-body0",
            "rowId": "hr0",
            "columnId": "hc2",
            "role": "body",
            "text": {
              "schemaVersion": 1,
              "id": "he-body0-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "视觉稿、交互说明" }]
                  }
                ]
              },
              "plainText": "视觉稿、交互说明"
            }
          },
          {
            "id": "he-lane1",
            "rowId": "hr1",
            "columnId": "hc1",
            "textDirection": "vertical",
            "role": "lane",
            "text": {
              "schemaVersion": 1,
              "id": "he-lane1-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "开发" }]
                  }
                ]
              },
              "plainText": "开发"
            }
          },
          {
            "id": "he-body1",
            "rowId": "hr1",
            "columnId": "hc2",
            "role": "body",
            "text": {
              "schemaVersion": 1,
              "id": "he-body1-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "实现与联调" }]
                  }
                ]
              },
              "plainText": "实现与联调"
            }
          }
        ]
      }
    },
    "lane-v": {
      "id": "lane-v",
      "kind": "swimlane",
      "cellType": "node",
      "geometry": { "x": 520, "y": 330, "width": 420, "height": 320 },
      "appearance": {
        "fill": "#ffffff",
        "strokeColor": "#64748b",
        "strokeWidth": 1
      },
      "data": {
        "direction": "vertical",
        "header": true,
        "rows": [{ "id": "vc0", "height": 42 }, { "id": "vc1", "height": 42 }, { "id": "vc2" }],
        "columns": [{ "id": "vr0" }, { "id": "vr1" }],
        "cells": [
          {
            "id": "ve-title",
            "rowId": "vc0",
            "columnId": "vr0",
            "colspan": 2,
            "textDirection": "horizontal",
            "role": "title",
            "text": {
              "schemaVersion": 1,
              "id": "ve-title-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "阶段泳道" }]
                  }
                ]
              },
              "plainText": "阶段泳道"
            }
          },
          {
            "id": "ve-lane0",
            "rowId": "vc1",
            "columnId": "vr0",
            "textDirection": "horizontal",
            "role": "lane",
            "text": {
              "schemaVersion": 1,
              "id": "ve-lane0-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "十月" }]
                  }
                ]
              },
              "plainText": "十月"
            }
          },
          {
            "id": "ve-body0",
            "rowId": "vc2",
            "columnId": "vr0",
            "role": "body",
            "text": {
              "schemaVersion": 1,
              "id": "ve-body0-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "内测版本" }]
                  }
                ]
              },
              "plainText": "内测版本"
            }
          },
          {
            "id": "ve-lane1",
            "rowId": "vc1",
            "columnId": "vr1",
            "textDirection": "horizontal",
            "role": "lane",
            "text": {
              "schemaVersion": 1,
              "id": "ve-lane1-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "十一月" }]
                  }
                ]
              },
              "plainText": "十一月"
            }
          },
          {
            "id": "ve-body1",
            "rowId": "vc2",
            "columnId": "vr1",
            "role": "body",
            "text": {
              "schemaVersion": 1,
              "id": "ve-body1-doc",
              "kind": "block",
              "content": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "公测版本" }]
                  }
                ]
              },
              "plainText": "公测版本"
            }
          }
        ]
      }
    },
    "line-zig": {
      "id": "line-zig",
      "kind": "vector-line",
      "cellType": "node",
      "geometry": { "x": 1080, "y": 120, "width": 140, "height": 60 },
      "appearance": {
        "fill": "none",
        "strokeColor": "#334155",
        "strokeWidth": 2,
        "opacity": 1
      },
      "data": {
        "shape": "straight",
        "points": [
          [0, 0],
          [70, 0],
          [70, 60],
          [140, 60]
        ]
      }
    },
    "line-curve": {
      "id": "line-curve",
      "kind": "vector-line",
      "cellType": "node",
      "geometry": { "x": 1080, "y": 260, "width": 140, "height": 80 },
      "appearance": {
        "fill": "none",
        "strokeColor": "#2563eb",
        "strokeWidth": 2,
        "opacity": 1
      },
      "data": {
        "shape": "curve",
        "points": [
          [0, 70],
          [70, 0],
          [140, 70]
        ]
      }
    }
  }
}
```

### 10.3 思维导图

- **文件**: `doc/examples/ai-canvas/mind-map.verd.json`（FrameFileV2）
- **入口**: 工作区文件树「导入画布/包」
- **预期**: 右向树布局；三个一级主题（右二左一，`rightNodeCount:2`）、两级子主题；`topic-release` 折叠；`leaf-mind` 固定宽度 160；`sum-core` 概要覆盖 `topic-features`→`topic-design` 兄弟范围；root `maxNodeWidth:200`。

```json doc/examples/ai-canvas/mind-map.verd.json
{
  "format": "verd-frame",
  "version": 2,
  "frame": {
    "id": "canvas-mind",
    "kind": "frame",
    "cellType": "frame",
    "name": "思维导图",
    "geometry": { "x": 0, "y": 0, "width": 960, "height": 640 },
    "children": ["mind-root", "topic-features", "topic-design", "topic-release", "leaf-canvas", "leaf-mind", "leaf-theme", "leaf-beta", "leaf-ga", "sum-core", "br-0", "br-1", "br-2", "br-3", "br-4", "br-5", "br-6", "br-7", "sum-edge"],
    "groups": []
  },
  "cells": {
    "mind-root": {
      "id": "mind-root",
      "kind": "mind-root",
      "cellType": "node",
      "geometry": {
        "x": 140,
        "y": 260,
        "width": 160,
        "height": 56,
        "outline": "roundRectangle"
      },
      "content": { "label": "产品路线图" },
      "data": {
        "layout": "right",
        "rightNodeCount": 2,
        "maxNodeWidth": 200
      }
    },
    "topic-features": {
      "id": "topic-features",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "功能规划" },
      "data": { "collapsed": false }
    },
    "topic-design": {
      "id": "topic-design",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "视觉设计" },
      "data": { "collapsed": false }
    },
    "topic-release": {
      "id": "topic-release",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "发布计划" },
      "data": { "collapsed": true }
    },
    "leaf-canvas": {
      "id": "leaf-canvas",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "画布导入" },
      "data": { "collapsed": false }
    },
    "leaf-mind": {
      "id": "leaf-mind",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 160,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "脑图概要" },
      "data": { "collapsed": false, "manualWidth": 160 }
    },
    "leaf-theme": {
      "id": "leaf-theme",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "主题系统" },
      "data": { "collapsed": false }
    },
    "leaf-beta": {
      "id": "leaf-beta",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "十月内测" },
      "data": { "collapsed": false }
    },
    "leaf-ga": {
      "id": "leaf-ga",
      "kind": "mind-child",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "十一月公测" },
      "data": { "collapsed": false }
    },
    "sum-core": {
      "id": "sum-core",
      "kind": "mind-summary",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 120,
        "height": 40,
        "derived": true,
        "outline": "roundRectangle"
      },
      "content": { "label": "核心交付" },
      "data": { "collapsed": false }
    },
    "br-0": {
      "id": "br-0",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "mind-root" },
      "target": { "cellId": "topic-features" },
      "route": { "mode": "auto" },
      "data": { "order": "00000000" }
    },
    "br-1": {
      "id": "br-1",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "mind-root" },
      "target": { "cellId": "topic-design" },
      "route": { "mode": "auto" },
      "data": { "order": "00000001" }
    },
    "br-2": {
      "id": "br-2",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "mind-root" },
      "target": { "cellId": "topic-release" },
      "route": { "mode": "auto" },
      "data": { "order": "00000002" }
    },
    "br-3": {
      "id": "br-3",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "topic-features" },
      "target": { "cellId": "leaf-canvas" },
      "route": { "mode": "auto" },
      "data": { "order": "00000000" }
    },
    "br-4": {
      "id": "br-4",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "topic-features" },
      "target": { "cellId": "leaf-mind" },
      "route": { "mode": "auto" },
      "data": { "order": "00000001" }
    },
    "br-5": {
      "id": "br-5",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "topic-design" },
      "target": { "cellId": "leaf-theme" },
      "route": { "mode": "auto" },
      "data": { "order": "00000000" }
    },
    "br-6": {
      "id": "br-6",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "topic-release" },
      "target": { "cellId": "leaf-beta" },
      "route": { "mode": "auto" },
      "data": { "order": "00000000" }
    },
    "br-7": {
      "id": "br-7",
      "kind": "mind-branch",
      "cellType": "edge",
      "source": { "cellId": "topic-release" },
      "target": { "cellId": "leaf-ga" },
      "route": { "mode": "auto" },
      "data": { "order": "00000001" }
    },
    "sum-edge": {
      "id": "sum-edge",
      "kind": "mind-summary-edge",
      "cellType": "edge",
      "source": { "cellId": "topic-features" },
      "target": { "cellId": "sum-core" },
      "route": { "mode": "auto" },
      "data": {
        "startSiblingId": "topic-features",
        "endSiblingId": "topic-design"
      }
    }
  }
}
```

### 10.4 DAG 流程

- **文件**: `doc/examples/ai-canvas/workflow-dag.verd.json`（FrameFileV2）
- **入口**: 工作区文件树「导入画布/包」
- **预期**: start→task→decision→两个分支任务，全部正交边，decision 经 `right`/`bottom` 两端口分支（标签 有货/缺货）；`graphMode:'dag'` 保证无环。

```json doc/examples/ai-canvas/workflow-dag.verd.json
{
  "format": "verd-frame",
  "version": 2,
  "frame": {
    "id": "canvas-flow-dag",
    "kind": "frame",
    "cellType": "frame",
    "name": "DAG 流程",
    "geometry": { "x": 0, "y": 0, "width": 960, "height": 480 },
    "children": ["flow-start", "task-submit", "decision-stock", "task-ship", "task-notify", "flow-1", "flow-2", "flow-3", "flow-4"],
    "groups": []
  },
  "cells": {
    "flow-start": {
      "id": "flow-start",
      "kind": "workflow-start",
      "cellType": "node",
      "geometry": {
        "x": 60,
        "y": 140,
        "width": 120,
        "height": 40,
        "outline": "terminal"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "output", "offset": 0.5 },
        {
          "id": "right",
          "side": "right",
          "direction": "output",
          "offset": 0.5
        },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "output",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "output", "offset": 0.5 }
      ],
      "content": { "label": "开始" },
      "data": {
        "graphMode": "dag",
        "origin": [60, 140],
        "memberIds": ["flow-start", "task-submit", "decision-stock", "task-ship", "task-notify"]
      }
    },
    "task-submit": {
      "id": "task-submit",
      "kind": "workflow-task",
      "cellType": "node",
      "geometry": {
        "x": 260,
        "y": 136,
        "width": 160,
        "height": 48,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "提交订单" }
    },
    "decision-stock": {
      "id": "decision-stock",
      "kind": "workflow-decision",
      "cellType": "node",
      "geometry": {
        "x": 500,
        "y": 120,
        "width": 120,
        "height": 80,
        "outline": "diamond"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "库存充足?" }
    },
    "task-ship": {
      "id": "task-ship",
      "kind": "workflow-task",
      "cellType": "node",
      "geometry": {
        "x": 700,
        "y": 80,
        "width": 160,
        "height": 48,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "安排发货" }
    },
    "task-notify": {
      "id": "task-notify",
      "kind": "workflow-task",
      "cellType": "node",
      "geometry": {
        "x": 700,
        "y": 220,
        "width": 160,
        "height": 48,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "通知补货" }
    },
    "flow-1": {
      "id": "flow-1",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "flow-start", "portId": "right" },
      "target": { "cellId": "task-submit", "portId": "left" },
      "route": { "mode": "orthogonal" }
    },
    "flow-2": {
      "id": "flow-2",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "task-submit", "portId": "right" },
      "target": { "cellId": "decision-stock", "portId": "left" },
      "route": { "mode": "orthogonal" }
    },
    "flow-3": {
      "id": "flow-3",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "decision-stock", "portId": "right" },
      "target": { "cellId": "task-ship", "portId": "left" },
      "route": { "mode": "orthogonal" },
      "labels": [{ "text": "有货" }]
    },
    "flow-4": {
      "id": "flow-4",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "decision-stock", "portId": "bottom" },
      "target": { "cellId": "task-notify", "portId": "left" },
      "route": { "mode": "orthogonal" },
      "labels": [{ "text": "缺货" }]
    }
  }
}
```

### 10.5 允许回环的流程

- **文件**: `doc/examples/ai-canvas/workflow-process.verd.json`（FrameFileV2）
- **入口**: 工作区文件树「导入画布/包」
- **预期**: `graphMode:'process'`；`task-retry → task-fill` 回边构成合法回环（DAG 模式会拒绝）；仍然不能自连或连入 start。

```json doc/examples/ai-canvas/workflow-process.verd.json
{
  "format": "verd-frame",
  "version": 2,
  "frame": {
    "id": "canvas-flow-process",
    "kind": "frame",
    "cellType": "frame",
    "name": "流程(允许回环)",
    "geometry": { "x": 0, "y": 0, "width": 960, "height": 520 },
    "children": ["pay-start", "task-fill", "task-pay", "decision-result", "task-done", "task-retry", "flow-1", "flow-2", "flow-3", "flow-4", "flow-5", "flow-6"],
    "groups": []
  },
  "cells": {
    "pay-start": {
      "id": "pay-start",
      "kind": "workflow-start",
      "cellType": "node",
      "geometry": {
        "x": 60,
        "y": 160,
        "width": 120,
        "height": 40,
        "outline": "terminal"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "output", "offset": 0.5 },
        {
          "id": "right",
          "side": "right",
          "direction": "output",
          "offset": 0.5
        },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "output",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "output", "offset": 0.5 }
      ],
      "content": { "label": "下单" },
      "data": {
        "graphMode": "process",
        "origin": [60, 160],
        "memberIds": ["pay-start", "task-fill", "task-pay", "decision-result", "task-done", "task-retry"]
      }
    },
    "task-fill": {
      "id": "task-fill",
      "kind": "workflow-task",
      "cellType": "node",
      "geometry": {
        "x": 260,
        "y": 156,
        "width": 160,
        "height": 48,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "填写信息" }
    },
    "task-pay": {
      "id": "task-pay",
      "kind": "workflow-task",
      "cellType": "node",
      "geometry": {
        "x": 500,
        "y": 156,
        "width": 160,
        "height": 48,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "发起支付" }
    },
    "decision-result": {
      "id": "decision-result",
      "kind": "workflow-decision",
      "cellType": "node",
      "geometry": {
        "x": 720,
        "y": 140,
        "width": 120,
        "height": 80,
        "outline": "diamond"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "支付成功?" }
    },
    "task-done": {
      "id": "task-done",
      "kind": "workflow-task",
      "cellType": "node",
      "geometry": {
        "x": 880,
        "y": 300,
        "width": 160,
        "height": 48,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "订单完成" }
    },
    "task-retry": {
      "id": "task-retry",
      "kind": "workflow-task",
      "cellType": "node",
      "geometry": {
        "x": 500,
        "y": 320,
        "width": 160,
        "height": 48,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both", "offset": 0.5 },
        { "id": "right", "side": "right", "direction": "both", "offset": 0.5 },
        {
          "id": "bottom",
          "side": "bottom",
          "direction": "both",
          "offset": 0.5
        },
        { "id": "left", "side": "left", "direction": "both", "offset": 0.5 }
      ],
      "content": { "label": "返回修改" }
    },
    "flow-1": {
      "id": "flow-1",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "pay-start", "portId": "right" },
      "target": { "cellId": "task-fill", "portId": "left" },
      "route": { "mode": "orthogonal" }
    },
    "flow-2": {
      "id": "flow-2",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "task-fill", "portId": "right" },
      "target": { "cellId": "task-pay", "portId": "left" },
      "route": { "mode": "orthogonal" }
    },
    "flow-3": {
      "id": "flow-3",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "task-pay", "portId": "right" },
      "target": { "cellId": "decision-result", "portId": "left" },
      "route": { "mode": "orthogonal" }
    },
    "flow-4": {
      "id": "flow-4",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "decision-result", "portId": "bottom" },
      "target": { "cellId": "task-retry", "portId": "right" },
      "route": { "mode": "orthogonal" },
      "labels": [{ "text": "失败" }]
    },
    "flow-5": {
      "id": "flow-5",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "task-retry", "portId": "left" },
      "target": { "cellId": "task-fill", "portId": "bottom" },
      "route": { "mode": "orthogonal" },
      "labels": [{ "text": "重试" }]
    },
    "flow-6": {
      "id": "flow-6",
      "kind": "workflow-edge",
      "cellType": "edge",
      "source": { "cellId": "decision-result", "portId": "bottom" },
      "target": { "cellId": "task-done", "portId": "top" },
      "route": { "mode": "orthogonal" },
      "labels": [{ "text": "成功" }]
    }
  }
}
```

### 10.6 分层架构

- **文件**: `doc/examples/ai-canvas/architecture.verd.json`（FrameFileV2）
- **入口**: 工作区文件树「导入画布/包」
- **预期**: 三个层（`data.order` 00000000–00000002）；三种模块外形齐全（box/decision/store）；跨层依赖边 `mod-order → mod-db`；层框由成员包围盒自动派生。

```json doc/examples/ai-canvas/architecture.verd.json
{
  "format": "verd-frame",
  "version": 2,
  "frame": {
    "id": "canvas-arch",
    "kind": "frame",
    "cellType": "frame",
    "name": "分层架构",
    "geometry": { "x": 0, "y": 0, "width": 960, "height": 620 },
    "children": ["layer-access", "layer-service", "layer-data", "mod-gateway", "mod-order", "mod-route", "mod-db", "dep-1", "dep-2", "dep-3"],
    "groups": []
  },
  "cells": {
    "layer-access": {
      "id": "layer-access",
      "kind": "architecture-layer",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 280,
        "height": 104,
        "derived": true,
        "outline": "rectangle"
      },
      "content": { "label": "接入层" },
      "data": { "order": "00000000", "memberIds": ["mod-gateway"] }
    },
    "layer-service": {
      "id": "layer-service",
      "kind": "architecture-layer",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 280,
        "height": 104,
        "derived": true,
        "outline": "rectangle"
      },
      "content": { "label": "服务层" },
      "data": {
        "order": "00000001",
        "memberIds": ["mod-order", "mod-route"]
      }
    },
    "layer-data": {
      "id": "layer-data",
      "kind": "architecture-layer",
      "cellType": "node",
      "geometry": {
        "x": 0,
        "y": 0,
        "width": 280,
        "height": 104,
        "derived": true,
        "outline": "rectangle"
      },
      "content": { "label": "数据层" },
      "data": { "order": "00000002", "memberIds": ["mod-db"] }
    },
    "mod-gateway": {
      "id": "mod-gateway",
      "kind": "architecture-module",
      "cellType": "node",
      "geometry": {
        "x": 60,
        "y": 64,
        "width": 240,
        "height": 44,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both" },
        { "id": "right", "side": "right", "direction": "both" },
        { "id": "bottom", "side": "bottom", "direction": "both" },
        { "id": "left", "side": "left", "direction": "both" }
      ],
      "content": { "label": "API 网关" },
      "data": { "shape": "box", "placed": true }
    },
    "mod-order": {
      "id": "mod-order",
      "kind": "architecture-module",
      "cellType": "node",
      "geometry": {
        "x": 60,
        "y": 220,
        "width": 240,
        "height": 44,
        "outline": "roundRectangle"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both" },
        { "id": "right", "side": "right", "direction": "both" },
        { "id": "bottom", "side": "bottom", "direction": "both" },
        { "id": "left", "side": "left", "direction": "both" }
      ],
      "content": { "label": "订单服务" },
      "data": { "shape": "box", "placed": true }
    },
    "mod-route": {
      "id": "mod-route",
      "kind": "architecture-module",
      "cellType": "node",
      "geometry": {
        "x": 360,
        "y": 198,
        "width": 160,
        "height": 88,
        "outline": "diamond"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both" },
        { "id": "right", "side": "right", "direction": "both" },
        { "id": "bottom", "side": "bottom", "direction": "both" },
        { "id": "left", "side": "left", "direction": "both" }
      ],
      "content": { "label": "支付路由" },
      "data": { "shape": "decision", "placed": true }
    },
    "mod-db": {
      "id": "mod-db",
      "kind": "architecture-module",
      "cellType": "node",
      "geometry": {
        "x": 60,
        "y": 360,
        "width": 160,
        "height": 88,
        "outline": "store"
      },
      "ports": [
        { "id": "top", "side": "top", "direction": "both" },
        { "id": "right", "side": "right", "direction": "both" },
        { "id": "bottom", "side": "bottom", "direction": "both" },
        { "id": "left", "side": "left", "direction": "both" }
      ],
      "content": { "label": "订单库" },
      "data": { "shape": "store", "placed": true }
    },
    "dep-1": {
      "id": "dep-1",
      "kind": "architecture-edge",
      "cellType": "edge",
      "source": { "cellId": "mod-gateway", "portId": "bottom" },
      "target": { "cellId": "mod-order", "portId": "top" },
      "route": { "mode": "orthogonal" }
    },
    "dep-2": {
      "id": "dep-2",
      "kind": "architecture-edge",
      "cellType": "edge",
      "source": { "cellId": "mod-order", "portId": "right" },
      "target": { "cellId": "mod-route", "portId": "left" },
      "route": { "mode": "orthogonal" }
    },
    "dep-3": {
      "id": "dep-3",
      "kind": "architecture-edge",
      "cellType": "edge",
      "source": { "cellId": "mod-order", "portId": "bottom" },
      "target": { "cellId": "mod-db", "portId": "top" },
      "route": { "mode": "orthogonal" }
    }
  }
}
```

### 10.7 多画布包

- **文件**: `doc/examples/ai-canvas/bundle-multi-canvas.verd.json`（`verd-canvas-bundle` v1，含 2 个 FrameFileV2）
- **入口**: 工作区文件树「导入画布/包」
- **预期**: 导入得到「总览」「订单详情」两个画布；总览中的 `frame-reference`（`targetFrameId: canvas-detail`）显示内嵌详情，画布菜单可打开详情；依赖闭包完整、无环。

```json doc/examples/ai-canvas/bundle-multi-canvas.verd.json
{
  "format": "verd-canvas-bundle",
  "version": 1,
  "files": [
    {
      "format": "verd-frame",
      "version": 2,
      "frame": {
        "id": "canvas-overview",
        "kind": "frame",
        "cellType": "frame",
        "name": "总览",
        "geometry": { "x": 0, "y": 0, "width": 960, "height": 560 },
        "children": ["ov-title", "ov-tag", "ov-ref", "ov-arrow"],
        "groups": []
      },
      "cells": {
        "ov-title": {
          "id": "ov-title",
          "kind": "geometry",
          "cellType": "node",
          "geometry": {
            "x": 64,
            "y": 48,
            "width": 240,
            "height": 44,
            "outline": "text"
          },
          "appearance": {
            "fill": "none",
            "strokeColor": "none",
            "strokeWidth": 2
          },
          "content": { "label": "订单域总览" }
        },
        "ov-tag": {
          "id": "ov-tag",
          "kind": "geometry",
          "cellType": "node",
          "geometry": {
            "x": 80,
            "y": 220,
            "width": 140,
            "height": 56,
            "outline": "roundRectangle"
          },
          "ports": [
            { "id": "top", "side": "top", "direction": "both" },
            { "id": "right", "side": "right", "direction": "both" },
            { "id": "bottom", "side": "bottom", "direction": "both" },
            { "id": "left", "side": "left", "direction": "both" }
          ],
          "appearance": {
            "fill": "#eff6ff",
            "strokeColor": "#2563eb",
            "strokeWidth": 2
          },
          "content": { "label": "订单详情" }
        },
        "ov-ref": {
          "id": "ov-ref",
          "kind": "frame-reference",
          "cellType": "node",
          "name": "订单详情",
          "geometry": { "x": 320, "y": 120, "width": 560, "height": 340 },
          "ports": [
            { "id": "top", "side": "top", "direction": "both" },
            { "id": "right", "side": "right", "direction": "both" },
            { "id": "bottom", "side": "bottom", "direction": "both" },
            { "id": "left", "side": "left", "direction": "both" }
          ],
          "appearance": {
            "fill": "#ffffff",
            "strokeColor": "#94a3b8",
            "strokeWidth": 1
          },
          "data": { "targetFrameId": "canvas-detail" }
        },
        "ov-arrow": {
          "id": "ov-arrow",
          "kind": "arrow",
          "cellType": "edge",
          "source": { "cellId": "ov-tag", "portId": "right" },
          "target": { "cellId": "ov-ref", "portId": "left" },
          "route": { "mode": "orthogonal" },
          "labels": [{ "text": "进入" }],
          "data": { "sourceMarker": "none", "targetMarker": "arrow" }
        }
      }
    },
    {
      "format": "verd-frame",
      "version": 2,
      "frame": {
        "id": "canvas-detail",
        "kind": "frame",
        "cellType": "frame",
        "name": "订单详情",
        "geometry": { "x": 0, "y": 0, "width": 960, "height": 480 },
        "children": ["d-title", "d-create", "d-pay", "d-arrow"],
        "groups": []
      },
      "cells": {
        "d-title": {
          "id": "d-title",
          "kind": "geometry",
          "cellType": "node",
          "geometry": {
            "x": 64,
            "y": 48,
            "width": 240,
            "height": 44,
            "outline": "text"
          },
          "appearance": {
            "fill": "none",
            "strokeColor": "none",
            "strokeWidth": 2
          },
          "content": { "label": "订单详情" }
        },
        "d-create": {
          "id": "d-create",
          "kind": "geometry",
          "cellType": "node",
          "geometry": {
            "x": 80,
            "y": 160,
            "width": 160,
            "height": 64,
            "outline": "roundRectangle"
          },
          "ports": [
            { "id": "top", "side": "top", "direction": "both" },
            { "id": "right", "side": "right", "direction": "both" },
            { "id": "bottom", "side": "bottom", "direction": "both" },
            { "id": "left", "side": "left", "direction": "both" }
          ],
          "appearance": {
            "fill": "#ffffff",
            "strokeColor": "#64748b",
            "strokeWidth": 2
          },
          "content": { "label": "创建订单" }
        },
        "d-pay": {
          "id": "d-pay",
          "kind": "geometry",
          "cellType": "node",
          "geometry": {
            "x": 360,
            "y": 160,
            "width": 160,
            "height": 64,
            "outline": "roundRectangle"
          },
          "ports": [
            { "id": "top", "side": "top", "direction": "both" },
            { "id": "right", "side": "right", "direction": "both" },
            { "id": "bottom", "side": "bottom", "direction": "both" },
            { "id": "left", "side": "left", "direction": "both" }
          ],
          "appearance": {
            "fill": "#ffffff",
            "strokeColor": "#64748b",
            "strokeWidth": 2
          },
          "content": { "label": "支付" }
        },
        "d-arrow": {
          "id": "d-arrow",
          "kind": "arrow",
          "cellType": "edge",
          "source": { "cellId": "d-create", "portId": "right" },
          "target": { "cellId": "d-pay", "portId": "left" },
          "route": { "mode": "auto" },
          "data": { "sourceMarker": "none", "targetMarker": "arrow" }
        }
      }
    }
  ]
}
```

### 10.8 FrameSnapshot（含嵌套 Frame）

- **文件**: `doc/examples/ai-canvas/snapshot-nested-frames.frame.json`（FrameSnapshot `{store:…}`）
- **入口**: 画布菜单「打开」（替换当前画布）或「导入」（插入当前 Frame）
- **预期**: 顶层元素 + 一个嵌套 Frame（自带局部坐标系的子画布），箭头用 `anchor` 连到子 Frame 右侧中点。注意：该文件**不能**走文件树导入——它不是 FrameFileV2/bundle。

```json doc/examples/ai-canvas/snapshot-nested-frames.frame.json
{
  "store": {
    "rootId": "snap-root",
    "cells": {
      "snap-root": {
        "id": "snap-root",
        "kind": "frame",
        "cellType": "frame",
        "name": "Snapshot 示例",
        "geometry": { "x": 0, "y": 0, "width": 960, "height": 560 },
        "children": ["snap-title", "outer-frame", "shape-top", "snap-arrow"],
        "groups": []
      },
      "snap-title": {
        "id": "snap-title",
        "kind": "geometry",
        "cellType": "node",
        "geometry": {
          "x": 64,
          "y": 48,
          "width": 320,
          "height": 44,
          "outline": "text"
        },
        "appearance": {
          "fill": "none",
          "strokeColor": "none",
          "strokeWidth": 2
        },
        "content": { "label": "FrameSnapshot 可携带嵌套 Frame" }
      },
      "outer-frame": {
        "id": "outer-frame",
        "kind": "frame",
        "cellType": "frame",
        "name": "子画布",
        "geometry": { "x": 120, "y": 140, "width": 420, "height": 280 },
        "children": ["inner-shape", "inner-text"],
        "groups": []
      },
      "inner-shape": {
        "id": "inner-shape",
        "kind": "geometry",
        "cellType": "node",
        "geometry": {
          "x": 48,
          "y": 72,
          "width": 160,
          "height": 64,
          "outline": "roundRectangle"
        },
        "ports": [
          { "id": "top", "side": "top", "direction": "both" },
          { "id": "right", "side": "right", "direction": "both" },
          { "id": "bottom", "side": "bottom", "direction": "both" },
          { "id": "left", "side": "left", "direction": "both" }
        ],
        "appearance": {
          "fill": "#ecfdf5",
          "strokeColor": "#059669",
          "strokeWidth": 2
        },
        "content": { "label": "嵌套内容" }
      },
      "inner-text": {
        "id": "inner-text",
        "kind": "geometry",
        "cellType": "node",
        "geometry": {
          "x": 48,
          "y": 168,
          "width": 220,
          "height": 40,
          "outline": "text"
        },
        "appearance": {
          "fill": "none",
          "strokeColor": "none",
          "strokeWidth": 2
        },
        "content": { "label": "子画布坐标系独立" }
      },
      "shape-top": {
        "id": "shape-top",
        "kind": "geometry",
        "cellType": "node",
        "geometry": {
          "x": 680,
          "y": 200,
          "width": 160,
          "height": 80,
          "outline": "ellipse"
        },
        "ports": [
          { "id": "top", "side": "top", "direction": "both" },
          { "id": "right", "side": "right", "direction": "both" },
          { "id": "bottom", "side": "bottom", "direction": "both" },
          { "id": "left", "side": "left", "direction": "both" }
        ],
        "appearance": {
          "fill": "#fff7ed",
          "strokeColor": "#ea580c",
          "strokeWidth": 2
        },
        "content": { "label": "顶层元素" }
      },
      "snap-arrow": {
        "id": "snap-arrow",
        "kind": "arrow",
        "cellType": "edge",
        "source": { "cellId": "shape-top", "portId": "left" },
        "target": { "cellId": "outer-frame", "anchor": [1, 0.5] },
        "route": { "mode": "auto" },
        "data": { "sourceMarker": "none", "targetMarker": "arrow" }
      }
    }
  }
}
```

### 10.9 Markdown 脑图

- **文件**: `doc/examples/ai-canvas/mind-map.md`
- **入口**: 画布菜单「打开/导入」（选 .md 文件）或「文本导入」粘贴；**不要**走文件树导入（那会创建独立文档而非脑图）
- **预期**: `#`/`##`/`###` 层级映射为「产品路线图」中心主题与两/三级子主题树，右向布局。样式、id、折叠与概要不要求——Markdown 不携带这些信息。

```markdown doc/examples/ai-canvas/mind-map.md
# 产品路线图

## 功能规划

### 画布导入

### 脑图概要

## 视觉设计

### 主题系统

## 发布计划
```

### 10.10 Mermaid 流程（workflow）

- **文件**: `doc/examples/ai-canvas/workflow-dag.mmd`
- **入口**: 在 workflow 场景画布上「导入」（选 .mmd）或「文本导入」→ Mermaid——追加为第二个分图；「打开」会被拒绝（`workflow-start` 不可删除，见 §3.5）。白板画布上「打开/导入」则生成白板图形。
- **预期**: `start`（stadium）成为 workflow-start；`{…}` 成为 decision；`%% verd:` 元数据提供固定坐标；`dag` 模式（默认）。

```text doc/examples/ai-canvas/workflow-dag.mmd
flowchart LR
  %% verd:{"positions":{"start":{"x":60,"y":140},"submit":{"x":260,"y":140},"stock":{"x":500,"y":120},"ship":{"x":700,"y":80},"notify":{"x":700,"y":220},"done":{"x":700,"y":320}}}
  start([开始]) --> submit[提交订单]
  submit --> stock{库存充足?}
  stock -->|有货| ship[安排发货]
  stock -->|缺货| notify[通知补货]
  ship --> done[完成]
  notify --> done
```

### 10.11 Mermaid 架构

- **文件**: `doc/examples/ai-canvas/architecture.mmd`
- **入口**: 在 architecture 场景画布上「打开」（选 .mmd）可替换为架构元素（锚点按 kind 校验）；「导入」/「文本导入」→ Mermaid 则追加一组层与模块
- **预期**: 三个 `subgraph` → 三个 architecture-layer；`[..]`/`{..}`/`[(..)]` 分别映射 box/decision/store 模块；跨层边保留。

```text doc/examples/ai-canvas/architecture.mmd
flowchart TB
  %% verd:{"positions":{"gw":{"x":60,"y":64},"order":{"x":60,"y":220},"route":{"x":360,"y":198},"db":{"x":60,"y":360}}}
  subgraph access["接入层"]
    gw["API 网关"]
  end
  subgraph service["服务层"]
    order["订单服务"]
    route{"支付路由"}
  end
  subgraph data["数据层"]
    db[("订单库")]
  end
  gw --> order
  order --> route
  order --> db
```

## 附录 A. kind 速查表

| kind                  | cellType | 场景 | 一句话                     |
| --------------------- | -------- | ---- | -------------------------- |
| `frame`               | frame    | 全部 | 唯一容器/文件根/嵌套画布   |
| `frame-reference`     | node     | 白板 | 跨文件嵌入实例             |
| `group`               | group    | 白板 | 分组（≥2 成员）            |
| `geometry`            | node     | 白板 | 全部内置 outline + 文本    |
| `image`               | node     | 白板 | data URL 图片              |
| `table`               | node     | 白板 | 网格单元格                 |
| `swimlane`            | node     | 白板 | 方向泳道                   |
| `freehand`            | node     | 白板 | 笔迹（局部点）             |
| `vector-line`         | node     | 白板 | 折线/曲线（局部点）        |
| `arrow`               | edge     | 白板 | 连接线/标签/标记           |
| `mind-root`           | node     | 脑图 | 中心主题（锚点）           |
| `mind-child`          | node     | 脑图 | 子主题                     |
| `mind-summary`        | node     | 脑图 | 概要节点                   |
| `mind-branch`         | edge     | 脑图 | 父子边（order）            |
| `mind-summary-edge`   | edge     | 脑图 | 概要范围边                 |
| `workflow-start`      | node     | 流程 | 开始事件（锚点）           |
| `workflow-task`       | node     | 流程 | 任务                       |
| `workflow-decision`   | node     | 流程 | 判断                       |
| `workflow-edge`       | edge     | 流程 | 有向边（必须 portId）      |
| `architecture-layer`  | node     | 架构 | 层（锚点，derived 几何）   |
| `architecture-module` | node     | 架构 | 模块（box/decision/store） |
| `architecture-edge`   | edge     | 架构 | 模块间依赖                 |

## 附录 B. 维护依据（非阅读前提）

- 核心类型与校验：`packages/engine/core/src/cell/{types,kinds,validation}.ts`
- 几何轮廓注册表：`packages/engine/core/src/geometry/{builtin-shapes,registry,shape}.ts`
- 绘制/表格/泳道/笔迹：`packages/engine/draw/src/{cell-utils,cell-commands,cell-table}.ts`
- 领域：`packages/engine/{mind,workflow,architecture}/src/cell-*.ts`
- 文件与装配：`packages/product/app/src/frames/frame-files.ts`；工作区导入 `packages/product/app/src/workspace-app.tsx`；画布导入 `packages/product/ui/src/verd-frame.tsx`、`frame-open.ts`
- 转换器：`packages/converters/{markdown-to-board,mermaid-to-board}/src`；富文本结构 `packages/engine/common/src/text/*`、编辑器 schema `packages/react/text/src/constants/editor-config.ts`
