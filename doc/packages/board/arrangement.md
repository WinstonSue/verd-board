# 对齐、自动排列与组合

白板、Workflow 节点和 Architecture 模块使用已保存的位置。Mind 内部继续由树布局约束；它的 Frame 外壳可以在父画布中排列。Architecture 层框继续包围自己的模块，不作为自由排列对象。

## 产品交互

右侧「排列」区域和右键菜单共用命令及可用性判断：六向对齐、水平/垂直等距分布、组合、解组、锁定、解锁，以及显式自动排列。组合快捷键为 Ctrl/Cmd+G，解组为 Ctrl/Cmd+Shift+G。

对齐以选区联合边界为基准；分布固定两端，在对象边缘间分配等距空隙。至少两个对象才能对齐，至少三个才能分布。锁定对象会阻止整次对齐或分布。

自动排列提供网格、横向、纵向；Workflow 默认按连线层级排列，Architecture 默认按层排列，仍须点击「自动排列」才修改位置。有选择时只处理选择，无选择时处理当前 Frame 可见、未锁定的直接对象；独立连线不参与，仅选连线时不会回退为排列全画布。通用排列默认间距为 32 个画布单位，网格列数为 `ceil(sqrt(n))`，按当前 y/x 稳定排序并从选区左上角排放。嵌套 Frame 只移动外壳，内部需要打开该 Frame 后排列。

按层和按连线层级排列使用长边虚拟节点、双向重心排序及相邻交换减少交叉，按实际节点尺寸压紧，并向上下游中心对齐。默认节点间距为 48、层间距为 96，预留架构层标题及连接通道；层顺序、模块归属与流程拓扑保持不变。虚拟节点仅用于计算，不写入文档。结果不依赖对象插入顺序，重复执行不继续移动；普通拖动、加载及刷新不触发重排。

拖动时匹配同 Frame 对象的边缘及中心，显示蓝色参考线。吸附阈值为 6 个屏幕像素，包含画布缩放和嵌套 Frame 的内容比例。Alt 临时关闭；设置中的「智能参考线」是默认开启的本地偏好，恢复操作速度不会重置它。参考线、组选择边框和预览不保存、不导出。

## Group

`GroupCell.members` 表达同一 Frame 的交互组合，不改变 Frame 所有权或领域归属。可嵌套，也可跨流程、跨架构层组合；白板箭头可入组，领域结构边由端点关系维护。白板组合保持连续图层块和成员原有绘制顺序；领域组合不强制重排图层。

单击选择当前层级的整组，双击逐级进入，Esc 逐级退出并选中退出的组。解组只去掉当前层级，成员提升到父组或 Frame，位置不变。Frame 成员仍是外壳单位，内部通过打开详情编辑。

锁定组可选择、复制和解锁；禁止移动、排列、删除、解组和组内编辑。锁定/解锁只改组自身的标记，保留成员原有锁定状态。含锁定成员的组合不能整体修改；未锁定的组仍可进入，以选择和解锁其中的成员。

排列将 Group 当成刚性块，递归平移节点与组内自由端点/手工路径，每个成员只移动一次。Frame 内部不展开。第一版不提供整体缩放或旋转。组收缩后形成循环时，按流程层级排列禁用；组跨架构层时，按层排列禁用。通用网格、横向和纵向排列仍可使用。

## 引擎与宿主 API

- `collectArrangementBlocks(store, frameId, ids?)` 返回当前作用域内的节点/Group 边界，采用旋转后的几何包围盒。
- `alignCells(store, ids, axis)`、`distributeCells(store, ids, axis)`、`arrangeCells(store, frameId, ids, style)` 返回纯 `CellOperation[]`，由一次事务提交；排列不改变领域关系或扩大选择。
- `ungroupCells(store, ids)` 和 `setCellsLocked(store, ids, locked)` 提供逐层解组与批量锁定。
- `CellIndex.groupOf` 只表示直接组成员；`domainOwnerOf` 表示流程起点/架构层归属。旧 `membersOf` 已弃用，兼容值优先取领域归属。
- `controller.selectionCommandState(command)` 返回可用性和原因；`executeSelectionCommand(command)` 执行对齐、分布、布局、分组、解组、锁定或解锁，返回 `FrameIntentResult`。菜单、属性面板和快捷键共用此入口，并尊重只读、异步等待及宿主拒绝。

流程起点作为排列对象时只修改自身位置和原点，不隐式移动未选成员。原有整图拖动若会移动某个 Group 的一部分，会拒绝并提示先解组。Architecture 排列保留模块所属层，层框作为派生结果更新。属性面板显式切换所属层时，仅将该模块放入目标层；`moveArchitectureModuleToLayer` 的可选 `position: inside-layer` 用于这一行为，默认 `preserve` 保留既有位置，指针拖动继续使用实际落点。

## 兼容与保存

`materializeWorkflowPositions(store)` 和 `materializeArchitecturePositions(store)` 将旧派生节点的显示坐标幂等转换为已保存坐标。已有手动位置不变，Mind 不转换，Architecture 层框继续派生。产品在加载和导入边界调用并使用原保存队列持久化，不进入用户撤销历史，不升级文件版本。第三方宿主在提供旧快照前调用同一 helper；渲染器不替宿主提交保存。

新建 Workflow/Architecture 对象只计算自身初始位置，不移动已有节点。显式布局、对齐、分布和完整拖动各只提交一次事务，因此可一步撤销并在刷新后恢复。

剪贴板的可选 `CellFragment.source` 记录来源 root/Frame 与节点领域归属，必须在剪切删除前捕获。同 Frame 粘贴保留各自归属并校验原 owner；跨 Frame 或旧片段要求明确目标，歧义原子拒绝。片段内已有的锚点及成员使用重映射后的内部归属。

验收入口：Core `arrangement.spec.ts`、各领域 `cell-arrangement.spec.ts`、React `frame-alignment.spec.ts` / `frame-interactions.spec.tsx`，以及产品 `arrangement.spec.ts` 与既有交互回归。

2026-10-14 实际验收通过：610 项单测、127 项生产 Web E2E、7 项 Desktop E2E、类型检查、lint、两端构建及隔离 consumer（严格类型、构建、浏览器运行时）。
