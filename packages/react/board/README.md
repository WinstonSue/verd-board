# @sue/board-react

统一 Cell/Frame React 画布，提供标准受控快照、第三方宿主意图、控制器和渲染扩展。白板与领域画布共用 `FrameCanvas`，通过 `frameId` 打开根或嵌套 Frame。

## 安装与使用

安装 `@sue/board-react`、React 与 React DOM，并按场景注册 core 和领域 Util。

```tsx
import { useState } from 'react';
import { createCellStore, createFrameCell } from '@sue/board-core';
import { FrameCanvas } from '@sue/board-react';
import '@sue/board-react-text/style.css';

export function Editor() {
  const [value, setValue] = useState(() => ({
    store: createCellStore(createFrameCell('root')),
  }));
  return <FrameCanvas value={value} onChange={({ snapshot }) => setValue(snapshot)} />;
}
```

`value` 为 `FrameSnapshot`，`onChange` 同时提供新快照和事务。主题保存在 `FrameCell.view`；视口只保存在当前画布内存，选择、历史、索引与派生布局只存在于运行时。

第三方模式使用 `adapter.toFrameSnapshot(value)` 和 `onIntent(transaction)`。宿主接受后回写 value，拒绝不修改当前快照，等待期间禁用重复提交。`readonly`、外部 `history`、独立选择和自定义节点渲染共用此入口。

## 操作手感

`FrameCanvas` 的可选 `interactionSettings: FrameCanvasInteractionSettings` 接受 `zoomSensitivity` 与 `dragPanSpeed`，两项都是相对默认手感的倍率，缺省为 `1`，有效范围 `0.25–3`。非有限数值回退为 `1`，超范围数值被限制到边界。

```tsx
<FrameCanvas value={value} onChange={({ snapshot }) => setValue(snapshot)} interactionSettings={{ zoomSensitivity: 0.5, dragPanSpeed: 1.5 }} />
```

缩放倍率影响触控板捏合及 Ctrl/Meta 滚轮的指数缩放，保留指针锚点和 `0.1–8` 的缩放边界。拖动倍率影响手型、Space、中键及右键拖动画布，每次拖动开始时固定本次倍率。滚轮平移、对象拖拽、触屏双指缩放与按钮缩放保持原行为。更新参数保留画布运行时，不触发 `onChange` / `onIntent`、历史或文档保存；画布本身不读取偏好存储。

## 公共 API

| 入口                                    | 职责                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `FrameCanvas`                           | 统一挂载、绘制和交互                                                                                      |
| `FrameCanvasController`                 | runtime、dispatch、undo/redo、focus、fit、centerSelection、setZoom、clipboard、moveSelection、exportImage |
| `useFrameRuntime` / `useFrameSelection` | 渲染扩展读取当前运行时与选择                                                                              |
| `FrameRenderExtension`                  | layout、render、renderShape、textBounds、visible                                                          |
| `FrameRenderContext.getGeometry`        | 读取当前布局和预览几何                                                                                    |
| `FrameRichText` / `FrameTextEditor`     | 共享文本显示与编辑                                                                                        |
| `frameSnapshotToImage`                  | 原生 SVG/PNG/JPEG 导出                                                                                    |

文字查看态与编辑态共享文字区域和排版。向两者传入同一份 `style`，编辑器未指定 `mode` 时采用文档的 `kind`；浮动工具栏不占正文空间。独立接入画布时引入 `@sue/board-react-text/style.css`，产品样式入口已包含它。

`controller.centerSelection()` 在当前比例下居中选中的节点；多选和组合使用节点联合边界，Frame 包含标题，连线不参与。定位考虑派生布局、旋转、嵌套坐标与 `viewportInsets`，不修改选择、文档或撤销历史。没有可见目标或拖动期间不执行，只读模式仍可定位。

旧 BoardCanvas、ControlledBoard、Wrapper、元素控制器、事件桥接和样式入口已删除，不提供公开兼容层。领域 React 包注册 Frame 扩展，不另建画布。产品布局和外观由调用方控制，无需引入旧样式文件。

详细模式与迁移状态见 [画布模式](../../../workspace/文档/包/画布模式.verd-doc.json)，[React 包文档](../../../workspace/文档/包/React接入.verd-doc.json) 和 [源码结构](./doc/STRUCTURE.md)。

## 排列控制器

`controller.selectionCommandState(command)` 和 `executeSelectionCommand(command)` 共用排列、Group 与锁定规则。命令类型为 `{type:'align',axis}`、`{type:'distribute',axis}`、`{type:'layout',style}` 或 `{type:'group'|'ungroup'|'lock'|'unlock'}`。布局样式支持 grid/horizontal/vertical/flow/layers，领域样式按当前 Frame 限制。一次操作只提交一次事务，尊重只读、pending 及宿主接受/拒绝；布局只作用于选择，空选时作用于当前 Frame 直接对象。

`interactionSettings.smartGuides?: boolean` 默认 `true`，控制拖动参考线及吸附，Alt 临时绕过。Group 可嵌套，双击逐层进入，Esc 逐层退出；整体移动不穿透成员 Frame。

旧 Workflow/Architecture 快照在接入前使用各引擎包导出的 `materializeWorkflowPositions` / `materializeArchitecturePositions` 物化派生位置；产品已在加载/导入边界调用。Mind 的布局扩展继续保留，Workflow 使用保存位置，Architecture 扩展只派生层框。
