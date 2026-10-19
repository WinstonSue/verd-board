# @sue/board-core

## 2.0.0 接入与变更

CellStore、事务、历史、注册表与共享几何。新增 Frame/文档引用、NodeCell.name、UML 类型及命令支持；CellKind、Cell 等联合类型扩展，穷尽分支需更新。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-core@2.0.0
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```ts
import { createCellStore, createFrameCell, createCellRuntime } from '@sue/board-core';
const snapshot = { store: createCellStore(createFrameCell('root')) };
const runtime = createCellRuntime(snapshot);
console.log(runtime.store.rootId);
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。

## API 与使用细节

[中文](./README.zh-CN.md)

The Board engine core library includes core data model, data transformation functions, plugin mechanisms, etc. In addition, it also includes plugin element rendering base class and board components containing basic whiteboard interactions.

> Currently @sue/board-core takes on too many responsibilities, including the core data model, plugin mechanism, the bridging layer of the front-end framework layer, and some basic drawing-related plugins, because currently it only needs some basic drawing board requirements (such as frame selection, dragging and moving element positions) will all be in the core, and more detailed package divisions may be considered in the future.

#### **Basic whiteboard functions**

1. Provide a drawing board component (based on React)
1. Zoom in, zoom out, and drag the canvas
1. Integrated canvas scrolling solution
1. Undo, redo
1. Click/drag to select elements
1. Drag to adjust element position
1. Theme plan

#### **Design ideas**

Board is a framework designed for all-in-one whiteboard tool, its core is plugin mechanism and data model. The plugin mechanism is the external manifestation, it allows developers to extend the functionality of the whiteboard in the form of plugins. The framework provides the necessary extension bridges and communication mechanisms to serve plugin development. The data model is the kernel, providing definitions for data and functions for data operation, and is the internal representation of the plugin.

**Plugin mechanism**

The plugin mechanism builds an extension bridge based on override methods. It currently supports custom interaction and custom rendering. In terms of custom interaction, `@sue/board-core` currently directly defines basic DOM events as override methods in the most primitive way, such as: PointerDown, pointerUp, pointerMove, keyDown, keyUp, etc. do not have too many business-level encapsulations. Custom rendering currently supports extending the rendering of plugins in the form of React components.

**Data Model**

Mainly provides the following capabilities:

1. Provide basic data model
1. Provide atomic-based data change methods (Transforms)
1. Based on immutable data model (based on Immer)
1. Provide a Change mechanism to cooperate with the framework to complete data-driven rendering.
1. Integrated with the plugin mechanism, the data modification process can be intercepted and processed

#### Dependence

- `roughjs`
- `is-hotkey`
