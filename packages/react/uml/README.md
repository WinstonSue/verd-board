# @sue/board-react-uml

以下为下一主版本的源码接入方式。本轮只交付代码与 Changesets，不升级版本、不发布；请用本仓构建的真实 tarball 验证，已发布的 2.0.0 不包含这些新入口。

完整 uml UI 插件：渲染、交互、创建工具、属性、快捷键、设置与语言贡献。由 createUmlUIPlugin() 显式组合对应引擎，不通过 import 副作用注册。

在项目 .npmrc 配置两个 scope，访问权限和令牌由仓库管理员提供；令牌保存在用户配置或 CI secret。最小编辑器只使用 @sue，完整产品的 @ylib 传递依赖也需要相应授权。

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

```bash
pnpm add @sue/board-core @sue/board-uml @sue/board-react @sue/board-react-uml react react-dom
```

只需四个 Board 包；共享文本、布局自动安装。不会引入其他领域、产品包或转换器。支持 React 18/19、ESM/CJS、严格 TypeScript 声明。

<!-- consumer-example -->

```tsx
import { useState } from 'react';
import { createUmlClassFrameSnapshot } from '@sue/board-uml';
import { FrameEditor } from '@sue/board-react';
import { createUmlUIPlugin } from '@sue/board-react-uml';
import '@sue/board-react/style.css';
import '@sue/board-react-uml/style.css';
const plugins = [createUmlUIPlugin()];
export function Editor() {
  const [value, setValue] = useState(createUmlClassFrameSnapshot('frame', 'uml-root'));
  return (
    <div style={{ height: 600 }}>
      <FrameEditor plugins={plugins} value={value} onChange={(change) => setValue(change.snapshot)} />
    </div>
  );
}
```

FrameCanvas 的底层接入使用 createFramePluginSet(plugins) 后传入 pluginSet；预览、嵌套引用、图像导出复用同一个集合。FrameEditor 同时支持 adapter/onIntent、readonly 和外部 history。

必须加载 UI 核心和所用领域的公开 style.css；核心样式已包含内置富文本。Markdown/Mermaid 转换器由宿主另行安装，再通过 importers/exporters 注入。

完整契约与迁移见仓库原生文档“系统架构”“React 接入”“2.0 接入与迁移”的下一主版本章节；变更见 CHANGELOG.md。
