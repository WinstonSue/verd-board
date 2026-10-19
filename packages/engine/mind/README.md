# @sue/board-mind

## 2.0.0 接入与变更

原生 Mind 模型、命令与树布局。新增分支移动规划、多根树布局、配色和节点最大宽度选项；扩展布局/Util 时检查新增上下文。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-mind@2.0.0
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```ts
import { createMindFrameSnapshot } from '@sue/board-mind';
const snapshot = createMindFrameSnapshot('frame', 'topic');
console.log(snapshot.store.rootId);
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。

## API 与使用细节

Implementation of the core logic of the mind map plugin.

**Basic functions**

1. Layout: logical layout, standard layout, indented layout
1. Node quick creation (Tab, Enter), deletion (Delete, Backspace)
1. Node theme text editing
1. Expand and collapse nodes
1. Copy and paste nodes
1. Insert pictures
1. Insert Emoji
1. Node Abstract
1. Color theme
1. Width adjustment
1. Multiple main topics

> @sue/board-mind The core only includes data rendering and core interaction implementation, and does not include interface-based interaction implementations such as toolbars and attribute settings. Because these functions depend on specific interface styles (the plug-in layer does not want to introduce UI libraries), we The design tends to leave this part of the function to the user for custom implementation, and the plugin layer only provides event support and special configuration support.

#### Dependence

- `@sue/board-core`
- `@sue/board-common`
- `@sue/board-text`
- `@sue/board-layouts`
