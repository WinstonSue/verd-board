# @sue/board-layouts

## 2.0.0 接入与变更

树与 DAG 布局。新增 abstractStandardSide；已有公开签名保持不变，本次统一发布为 2.0.0。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-layouts@2.0.0
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```ts
import { layoutDag } from '@sue/board-layouts';
const layout = layoutDag([{ id: 'a', width: 120, height: 60 }], []);
console.log(layout.positions.a);
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。

## API 与使用细节

It is used to implement the mind map automatic layout algorithm. Based on an independent algorithm, the mind map node layout logic can be decoupled from other functions. The automatic layout algorithm only focuses on the location distribution of nodes.

**Layout Classification**

1. Logical layout
1. Standard layout
1. Indent layout
1. Layout nesting

> Timeline and fishbone are not supported yet

**Algorithm Implementation**

The layout algorithm in this library mainly refers to the implementation ideas in the paper [Drawing Non-layered Tidy Trees in Linear Time], and has been appropriately transformed. The abstraction of nodes also follows the abstract implementation in the paper.

### Reference

For the paper, see: [https://github.com/Klortho/d3-flextree/tree/master/papers](<>)

open source library: [https://github.com/leungwensen/mindmap-layouts](https://github.com/leungwensen/mindmap-layouts)
