# FrameCanvas 源码结构

## 当前文件

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 原生 Frame 公共入口 |
| `src/frame-canvas.tsx` | CellRuntime 生命周期、受控和宿主模式、嵌套挂载、选择、事务、绘制与指针交互 |
| `src/frame-selection-handles.tsx` | 原生缩放与旋转手柄 |
| `src/frame-rich-text.tsx` | BoardTextDocument 静态显示 |
| `src/frame-text-editor.tsx` | TipTap 文本编辑与格式工具栏 |
| `src/frame-export.tsx` | 同一只读渲染器生成 SVG/PNG/JPEG，嵌入资源、裁剪并清除编辑控件 |
| `src/frame-canvas.spec.tsx` | 画布隔离、宿主意图、只读与外部历史 |
| `src/frame-export.spec.ts` | 导出参数、嵌套裁剪、样式保留与控件清理 |

## 数据与提交

FrameCanvas 为每个挂载实例创建独立 CellRuntime。标准模式提交候选状态验证后的事务，再向宿主发布快照和事务；选择归一化后同步发布选择回调。宿主模式先校验操作，等待 onIntent，数据只随外部 value 更新。

Frame.children 决定所有权和绘制顺序。领域扩展提供派生几何，嵌套 Frame 对内容使用统一缩小居中变换。FrameRenderContext.getGeometry 返回当前布局和拖动预览坐标；扩展不把布局缓存写入快照。

FrameCanvas 共享节点文字编辑、边标签、选择和手柄。领域包接入布局与专用渲染，产品包接入绘图工具和属性编辑。图像导出临时挂载同一只读 FrameCanvas，保留内容而剔除端口、命中路径和手柄。

## 旧底座

旧 BoardCanvas、ControlledBoard、Wrapper、renderer registry、元素控制器和插件事件桥接已删除。core 和产品目录中其他旧底座仍待全量清理；本包删除完成不代表整个迁移已经交付。
