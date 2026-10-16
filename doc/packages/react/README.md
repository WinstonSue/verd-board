# React 包文档

产品和宿主接入共用 `FrameCanvas`。领域 React 包提供注册与渲染扩展，嵌入和详情通过 `frameId` 编辑同一份 CellStore。完整行为和当前迁移状态见 [Cell/Frame 画布模式](../board/canvas-modes.md)。

使用 `VerdFrame` 或 `WorkspaceApp` 的生产入口须导入 `@sue/verd-board-ui/style.css`。库构建把产品样式提取成独立 CSS；Web/Desktop 入口均显式加载。直接使用 `FrameCanvas` 的宿主自行安排画布布局。

`VerdFrame` 接收可选 `saveStatus`、`lastSavedAt`（Unix 毫秒时间）和 `onRetrySave`，显示保存状态与上次成功时间；嵌入调用方负责提供这些工作区状态。`WorkspaceApp` 自动从工作区会话恢复时间，并在保存提交成功后更新。

## 包与公共入口

| 包                              | 入口与职责                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `@sue/verd-board-ui`            | `VerdFrame` 组合统一画布、绘图工具、属性面板与导入导出；`ProductShell` 提供产品导航                                                        |
| `@sue/board-react`              | `FrameCanvas`、`FrameCanvasController`、`useFrameRuntime`、`useFrameSelection`、`FrameRichText`、`FrameTextEditor`、`frameSnapshotToImage` |
| `@sue/board-react-mind`         | `createMindFrameExtensions` 注册领域行为、树布局、媒体区域、概要括号                                                                       |
| `@sue/board-react-workflow`     | `createWorkflowFrameExtensions` 注册流程行为与布局                                                                                         |
| `@sue/board-react-architecture` | `createArchitectureFrameExtensions` 注册层、模块与依赖行为和布局                                                                           |
| `@sue/board-react-text`         | TipTap 富文本编辑器、工具栏和 `BoardTextController`                                                                                        |

三类领域包的旧 Canvas、文档 Canvas、SceneGraphic、投影宿主和样式入口已删除。board-react 中的旧 BoardCanvas、ControlledBoard、Wrapper、元素控制器、事件插件和样式入口也已删除。引擎和产品旧底座已删除；旧 JSON 定义及读取转换仅在应用私有迁移边界中保留，完整交互验收仍独立进行。

## 标准模式

`value` 是 `FrameSnapshot = {store: CellStore}`。`onChange` 接收新快照和提交事务，调用方持有最新值。主题在 `FrameCell.view`；视口只保存在当前画布内存，历史、选择与布局缓存保留在画布运行时。

```tsx
import { useState } from 'react';
import { createCellRegistry } from '@sue/board-core';
import { createMindFrameSnapshot } from '@sue/board-mind';
import { FrameCanvas } from '@sue/board-react';
import { createMindFrameExtensions } from '@sue/board-react-mind';

const registry = createCellRegistry();
const extensions = createMindFrameExtensions(registry);

export function MindEditor() {
  const [value, setValue] = useState(() => createMindFrameSnapshot('frame', 'root'));
  return <FrameCanvas value={value} registry={registry} extensions={extensions} onChange={({ snapshot }) => setValue(snapshot)} />;
}
```

白板使用 `registerDrawCells` 注册绘图 Util；产品的 Rough、表格、泳道和折线渲染位于 `packages/product/ui/src/frame-draw-extension.tsx`。嵌套 Frame 按外壳缩小居中，详情直接挂载相应 `frameId`，不建立第二份文档。

## 第三方宿主模式

`adapter.toFrameSnapshot(value)` 在接入边界转换业务数据。`onIntent(transaction)` 接收类型化 Cell 事务，宿主负责接受、拒绝和回写 `value`。接受意图不提前修改画布数据，异步等待期间禁止第二笔提交；拒绝保持原快照并可报告原因。

`readonly` 禁止编辑。`history` 可提供外部 `undo/redo`，每个画布有独立选择与运行时。自定义节点通过 `FrameRenderExtension.render` 渲染；`renderShape` 仅覆盖轮廓并保留共享文字和选择，`textBounds` 定义文字区域，`visible` 控制显示。`context.getGeometry(id)` 读取当前布局和拖动预览坐标，`context.dispatch` 发出事务。

`FrameRenderExtension.previewMove(context)` 可选地解释单节点移动，接收原始 store、节点、所属 Frame、移动后的显示几何 `preview`、目标显示几何 `geometry`、指针 `point` 和总显示比例 `scale`，返回 `{ operations, ghost?: { parentId, cellIds } }`。返回 `undefined` 使用原有 Util 移动，空操作表示忽略落点；移动与松手共用该纯回调。ghost 使用独立候选布局、`preview: true` 上下文和导出排除标记，不发送文档意图。Mind 扩展用此接口提供热区捕获和完整分支预览。

adapter 只在边界转换，渲染器直接读取 Cell。领域 React 包不再提供独立投影画布或私有文档 reducer。

## 绘制草稿与画布反馈

`FrameCanvasTool` 的 `key?` 表示稳定的工具配置身份；仅重建相同 key 的工具对象不会中断绘制。`preview?` 返回纯临时 Cell 操作，`complete` 仍兼容原三参数形式，也可接收第四参数 `FrameCanvasDrawingContext`（`zoom`、`idFor(key)`）。两者共用创建逻辑与稳定 ID，让复杂形状、文字、表格、泳道、笔迹及领域容器在松手前后保持一致；未提供 preview 的 box 工具默认显示矩形。预览只调用 preview，不能用 complete 代替它。

草稿复用正式渲染扩展；`FrameRenderContext.preview?` 标识只展示内容的上下文。扩展在此模式应省略焦点、编辑器、控件和指针副作用。画布也会禁用草稿的文档操作、端口与手柄；草稿使用独立 DOM 标识和缓存，不进入 CellRuntime、保存、历史或图片导出。

Esc、切换工具或配置、切换 Frame、只读切换、指针取消或丢失捕获、双指手势都会丢弃未完成操作。折线通过 Enter、双击或点击起点闭合完成。端口连线显示源端、随动路径和合法目标提示；擦除显示范围与候选标记，松手统一提交，取消保留对象。

产品新建直线无箭头，箭头工具保留箭头；曲线仍通过拖动创建，按吸附后的端点生成可编辑的三点弧线。控制点偏移为 `min(80, 端点距离 / 4)` 个画布单位；移动绑定端点沿用现有规则，保留用户调整过的中间点。旧文件中的路径和标记保持原数据。

## 控制器与导出

`selectionAllows(store, ids, registry, capability, mountedFrameId?)` 根据 Frame 自身所有权判断嵌入能力；最后一个参数默认 `store.rootId`，详情宿主应传当前挂载 Frame，保护挂载根。锁定的 Frame 或分组祖先会阻止修改。

通过 ref 获取 `FrameCanvasController`，提供事务提交、撤销重做、Frame 聚焦、适配、缩放、`exportImage` 和 `clipboard`（copy/cut/paste 系统剪贴板动作，返回接受或拒绝结果）。`useFrameRuntime` 和 `useFrameSelection` 供渲染扩展读取同一运行时。

画布和其内置文字、标题、表格编辑区及文字工具栏共用滚轮手势：Ctrl/Meta wheel 与触控板捏合缩放画布，并保留编辑焦点和光标；普通 wheel 优先滚动当前方向仍有容量的内容，否则平移画布。属性面板、菜单和模态窗口保持自身滚动行为。悬停只更新相关节点，相机操作不提交文档、历史或保存；扩展仍收到当前悬停状态、比例和文档。

`centerSelection(): void` 保持当前缩放，把选中节点的联合边界居中到 `viewportInsets` 定义的可用区域。组合展开为节点成员，Frame 边界包含标题，连线不参与计算；隐藏、已删除或未渲染的节点被忽略，无有效目标或拖动期间不执行。该操作保留选择，只更新内存相机，不触发事务、历史或保存；只读画布也可调用。

`fitCells(ids, options): boolean` 将已挂载对象的联合边界适配到视口，支持动画、缩放上下限与像素边距；不改变选择，无有效目标时返回 `false`。`fitBounds` 适配已有世界范围，`getContentBounds` 返回整图范围。演示模式 `inputMode="present"` 保留相机手势，禁止编辑；`onPresentTap(cellId | null)` 只在主指针位移不超过 4px 时报告对象或空白，嵌入内容映射为外壳，多指、取消和拖拽不算点击。

`FrameInstanceHost.acquire(query)` 可返回幂等释放函数；未返回时沿用 `release(query)`。产品会话通过 `retainOccurrence(id)` 共享引用挂载，最后一个租约释放才关闭实例，强制关闭后的旧释放函数不会影响新实例。引用的完整 appearance 路径与循环检测分开传递，避免不同外壳中的深层实例相互冲突；只读演示挂载不重置共用运行时的选择。

`frameSnapshotToImage` 与控制器沿用统一渲染器，支持 SVG、PNG、JPEG、选中关系闭包、分辨率、边距和背景。资源、富文本与括号保留，编辑控件被移除；导出失败报告错误并清理临时画布。Markdown/Mermaid 直接转换 FrameSnapshot，见 [Frame 转换器](../board/frame-converters.md)。

## 文本

`FrameRichText` 显示 BoardTextDocument；`FrameTextEditor` 复用 TipTap 编辑器和工具栏，把修改提交给 Cell 事务。`LineText` 和 `ParagraphText` 提供行文本与段落编辑，`BoardTextController` 控制格式操作。笔记和表格单元格使用相同文本模型。

文字查看与编辑共用内容 schema、排版样式和文字区域；`FrameTextEditor.style` 接收与 `FrameRichText.style` 相同的基础样式，`mode` 未指定时采用 `text.kind`。切换状态保持字号、颜色、行高、对齐和换行，工具栏悬浮在正文外，不参与文字度量或随节点旋转。`TextPreview` 提供无需编辑器实例的静态正文。独立使用文本或画布 React 包时需引入 `@sue/board-react-text/style.css`；产品的 `@sue/verd-board-ui/style.css` 已包含这些样式。

## 验证与开发

```bash
pnpm typecheck
pnpm --filter @sue/board-react test
pnpm --filter @sue/board-react-mind test
pnpm --filter web-e2e exec playwright test
pnpm exec turbo run build --filter=web... --filter=desktop...
pnpm test:consumer
```

隔离 consumer 从发布配置复制 dist，严格检查类型声明后构建，不读取仓库源码。构建退出成功仍需检查声明生成诊断；旧底座删除和完整功能保留是独立交付门槛。

相关文档：[架构](../../architecture/ARCHITECTURE.md)、[开发指南](../../development/README.md)、[包索引](../README.md)。

## 排列控制器

`controller.selectionCommandState(command)` 和 `executeSelectionCommand(command)` 共用排列、Group 与锁定规则。命令类型为 `{type:'align',axis}`、`{type:'distribute',axis}`、`{type:'layout',style}` 或 `{type:'group'|'ungroup'|'lock'|'unlock'}`。布局样式支持 grid/horizontal/vertical/flow/layers，领域样式按当前 Frame 限制。一次操作只提交一次事务，尊重只读、pending 及宿主接受/拒绝；布局只作用于选择，空选时作用于当前 Frame 直接对象。

`interactionSettings.smartGuides?: boolean` 默认 `true`，控制拖动参考线及吸附，Alt 临时绕过。Group 可嵌套，双击逐层进入，Esc 逐层退出；整体移动不穿透成员 Frame。

旧 Workflow/Architecture 快照在接入前使用各引擎包导出的 `materializeWorkflowPositions` / `materializeArchitecturePositions` 物化派生位置；产品已在加载/导入边界调用。Mind 的布局扩展继续保留，Workflow 使用保存位置，Architecture 扩展只派生层框。

## Sidebar、节点名称与连接交互

产品属性 Sidebar 位于画布外，固定宽 300px，通高、内部滚动、可收起。800px 和桌面窗口沿用右侧布局；工具栏和底部控制位于画布区域，适配/居中根据实际 SVG 尺寸计算。切换 Sidebar 只改变界面布局，不提交 Cell 事务或重置视口。单选显示对象属性，多选显示共有属性，空选择显示画布设置。

`NodeCell.name?: string`（Frame 继承）是独立的单行纯文本名称；`content.label/text` 仍是画布正文。名称输入只提交 `name`，正文只在画布编辑。自动名称取正文的纯文本，换行转为空格，忽略富文本格式。插入已有正文的节点时在插入事务内初始化；空节点在第一次完整正文编辑会话结束时取名。旧节点没有 `name` 时回显正文，在正文首次改变前保留原名称。`name: ''` 是有效的显式空名称。初始化和修改均使用统一事务及历史；JSON、复制、保存和跨 Frame 转移直接保留字段，无需变更存储版本。编辑正文的 `replace_cell` 可使用 `deferName: true`，由会话结束事务完成空节点命名；宿主按现有 `onIntent` 接受或拒绝整个事务。

Port 仅在节点悬停、选中、作为连接源或吸附目标时显示；只读、锁定（含祖先）和预览节点隐藏。显隐订阅节点局部状态，关联连线只更新显示路径。`edgeDisplayGeometry` 对两端 Port 圆周（半径和双方描边）做显示裁切；曲线使用原始 Bézier 分割并保留端点切线，短线不反转。逻辑绑定、路由控制点、标签布局和存储不变。图像导出以只读画布渲染，不含 Port，也没有交互避让留下的空隙；节点避障路由规则不受此改动影响。

形状按钮先展开 Popover 并进入选择态，面板不标记已激活形状；选定具体形状才激活创建，取消/外部点击/Escape 保持选择。R/O 仍直接创建矩形/椭圆。双向箭头复用 `kind: 'arrow'`、直线路由和两端 `arrow` marker；A 仍创建单向箭头。右键操作保存位置和运行时选择快照；外部 pointerdown 在捕获阶段关闭后继续原点击/拖动，选择、目标存活、Frame 或只读状态改变即关闭。

## 根据内容调整节点大小

`FrameSelectionCommand` 支持 `{ type: 'fit-content' }`，可通过 `selectionCommandState` 查询可用性、`executeSelectionCommand` 执行。命令提交当前正文编辑后，按实际文本区域和字体适配选中合格节点，复用领域 resize 行为并一次提交；支持宿主接受、拒绝和外部历史。

`createMindFrameExtensions(registry, options?)` 的可选 `MindMetricsOptions` 可提供 `maxNodeWidth`（默认 240）及 `measureText`。`layoutMindCells(store, frameId, options?)` 和 `mindCellMetrics(cell, options?)` 复用同一配置；根节点的 `maxNodeWidth` 覆盖应用默认。React 扩展默认使用 `measureBoardText`，此函数由 React text 和 React board 包导出，返回实际 schema 内容在指定宽度、字号下的尺寸；`Infinity` 表示自然宽度。应用配置或字体变化时应重建扩展以刷新布局缓存。产品已处理该刷新。
