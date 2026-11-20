# @sue/board-text

## 接入

提供文字格式、对齐、链接与剪贴板辅助。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-text@0.1.0
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```ts
import { isUrl } from '@sue/board-text';
console.log(isUrl('https://example.com'));
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

## API 与使用细节

#### Dependence

- `@sue/board-core`
