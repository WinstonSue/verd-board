# @sue/board-common

## 2.0.0 接入与变更

BoardTextDocument 与纯文本工具。新增结构校验、纯文本派生与批量格式工具；BoardTextController 新增可选 getActiveAlign，现有实现无需补齐必需方法。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-common@2.0.0
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```ts
import { createInlineText, deriveBoardTextPlainText } from '@sue/board-common';
const text = createInlineText('Hello');
console.log(deriveBoardTextPlainText(text.content));
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

`BoardTextController` 仅新增可选的 `getActiveAlign`；已有实现保持兼容。其他纯文本与格式工具均为新增导出。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。

## API 与使用细节

Pure shared text, Action and workspace-link contracts. This package has no runtime dependency on React or `@sue/board-core`.

## 下一主版本源码：Actions 与稳定链接

The current source adds `ActionDefinition`, `ActionState`, `ActionResult`, `createActionRegistry`, `WorkspaceTarget`, `createWorkspaceLink`, `parseWorkspaceLink`, `parseExternalLink` and `remapWorkspaceLink`. These are next-major source APIs; prepare Changesets and validate real tarballs before publishing. The published 2.0.0 API is described separately above.

Actions declare a stable ID, arguments, effect, availability and execution. Registries are instance-scoped and sealed. Menus capture actions before moving focus; asynchronous work rechecks the captured target through `signal` / `checkpoint()`. Content operations wait for the host flush barrier. `beforeFlush` starts user-activation-sensitive transport and exposes its result as `invocation.preflight`. `beforeQueue` then prepares the captured editor before acquiring the content lane, so native editor submissions can complete without waiting behind their own command; cancellation and target/permission checks run again before enqueueing.

Workspace targets are `{kind:'file',fileId}`, `{kind:'heading',fileId,slug}` or `{kind:'cell',fileId,cellId}`. A cell fragment encodes `cell:<CellId>` once after `#`. Cell identity is globally unique within the workspace; the live owner index follows moves, and the URL file ID remains a hint/fallback. Internal links do not encode physical paths, camera state or occurrence identity.

`mapBoardTextLinks` visits link marks in explicit rich-text slots and skips literal code. `mapStandardCellLinks` uses structural typing for Node/Frame text and Edge label text, so common remains independent of the Cell model. Domain plugins handle their own table/note slots. Copied targets use the new Cell ID and owner; targets outside the copied set retain their original identity.
