# @sue/verd-board-ui

## 2.0.0 接入与变更

VerdFrame 产品界面。新增 DocumentPage、文件树、标签组、图表库、工作区设置、回收站和外观偏好；VerdFrame 增加引用、工作区历史与宿主回调。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-core@2.0.0 @sue/verd-board-ui@2.0.0 react react-dom
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```tsx
import { useState } from 'react';
import { createCellStore, createFrameCell } from '@sue/board-core';
import { VerdFrame } from '@sue/verd-board-ui';
import '@sue/verd-board-ui/style.css';
export function Editor() {
  const [value, setValue] = useState(() => ({ store: createCellStore(createFrameCell('root')) }));
  return <VerdFrame value={value} frameId="root" onChange={({ snapshot }) => setValue(snapshot)} onOpenFrame={() => {}} />;
}
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。
