# @sue/board-uml

Uml 领域模型、命令、校验、布局、关系与几何策略。不依赖 React 或其他领域。领域 kind 常量与数据类型从 board-core 移至本包。

在项目 .npmrc 配置两个 scope，访问权限和令牌由仓库管理员提供；令牌保存在用户配置或 CI secret。最小编辑器只使用 @sue，完整产品的 @ylib 传递依赖也需要相应授权。

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

```bash
pnpm add @sue/board-core @sue/board-uml
```

<!-- consumer-example -->

```ts
import { createCellRegistry, createCellRuntime } from '@sue/board-core';
import { createUmlPlugin, createUmlClassFrameSnapshot } from '@sue/board-uml';
const registry = createCellRegistry({ plugins: [createUmlPlugin()] });
const snapshot = createUmlClassFrameSnapshot('frame', 'uml-root');
const runtime = createCellRuntime(snapshot, registry);
console.log(runtime.store.rootId);
```

独立调用 applyCellOperations、copyCellFragment、planCellPaste、frameScene、排列和路由等辅助函数时，显式传入同一个 registry。事务失败不改变状态、历史或通知。缺少插件会拒绝对应文件，不执行归一化或保存。

序列化字段不改名；FrameFileV2、DocumentFileV1 不升格式版本。完整契约见原生架构文档。
