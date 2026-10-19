# @sue/board-react-text

## 2.0.0 接入与变更

修复 TipTap 默认导出的 CommonJS 互操作问题；ESM/CJS 入口均以真实 tarball 加载验证。

TipTap React 文本层。新增独立 DocumentEditor/DocumentPreview、查找与标题锚点、正文度量；DocumentEditor 的 onChange 通过 change.value 返回正文。

在项目 `.npmrc` 配置两个 scope：

```ini
@sue:registry=https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/
@ylib:registry=https://packages.aliyun.com/6141c43fdd62cdb60fbbdbda/npm/npm-registry/
```

两个仓库都需要获得访问授权。令牌放在用户级 `.npmrc` 或 CI secret，通过仓库管理员获取；不要提交令牌。`@ylib/tabs` 是产品包的传递依赖，只有 `@sue` 配置不足以安装完整产品。

```bash
pnpm add @sue/board-common@2.0.0 @sue/board-react-text@2.0.0 react react-dom
```

React 组件面向浏览器，支持 React 18/19；TypeScript 使用现代 Bundler 模块解析。ESM、CJS 与声明从 `dist` 加载，不导入 `src` 或未声明的深层路径。仓库开发的 Node/pnpm 要求不等同于浏览器运行时要求。

<!-- consumer-example -->

```tsx
import { useState } from 'react';
import { createBlockText } from '@sue/board-common';
import { DocumentEditor } from '@sue/board-react-text';
import '@sue/board-react-text/style.css';
export function Editor() {
  const [value, setValue] = useState(() => createBlockText('Hello'));
  return <DocumentEditor value={value} onChange={(change) => setValue(change.value)} />;
}
```

画布容器必须有明确高度。独立文本/画布加载 `@sue/board-react-text/style.css`；`VerdFrame`/`WorkspaceApp` 加载 `@sue/verd-board-ui/style.css`（已包含文本样式）。

完整发布摘要与迁移入口见 [VerdBoard 2.0](https://github.com/WinstonSue/verd-board#npm-2)；逐包变更见本包随附的 `CHANGELOG.md`。`FrameCanvas` 已存在于 1.0.0，早期 BoardCanvas/领域 Canvas 的删除不是本次新增变更。

## API 与使用细节

基于 [Tiptap](https://tiptap.dev/) 的 React 文本渲染层。运行时只使用 `BoardTextDocument`（TipTap / ProseMirror JSON），由 `BoardTextController` 封装同一个 TipTap `Editor`。

## 安装

```bash
pnpm add @sue/board-react-text @sue/board-common
```

## 快速开始

```tsx
import { Text } from '@sue/board-react-text';
import '@sue/board-react-text/style.css';
import type { BoardTextDocument } from '@sue/board-common';

function Demo({ text }: { text: BoardTextDocument }) {
  return (
    <Text
      text={text}
      readonly={false}
      onChange={(data) => {
        console.log(data.newText, data.width, data.height);
      }}
    />
  );
}
```

## 组件路由：`Text`

`Text` 接收 `BoardTextDocument`，按 `kind` 分流：

| `kind`     | 行为                                |
| ---------- | ----------------------------------- |
| `'block'`  | `ParagraphText`（多行富文本）       |
| `'inline'` | `LineText`（单行，禁止 Enter 换行） |

## 导出

| 导出                                     | 说明                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| `Text` / `ParagraphText` / `LineText`    | 文本组件                                               |
| `TextPreview`                            | 与编辑器共用 schema 和样式的静态正文，不创建编辑器实例 |
| `createBoardTextController`              | 用 TipTap `Editor` 构造 `BoardTextController`          |
| `safeFocus` / `measureContainerSize`     | 聚焦与测高                                             |
| `paragraphExtensions` / `lineExtensions` | TipTap 扩展                                            |

旧 `raw.blocks` / `children` 文档只在应用私有迁移边界读取；不提供公开的旧文本运行时或单独迁移函数。

查看和编辑共享段落、标题、列表、引用、代码、表格、空行与文字格式的排版规则。`LineText` 只限制输入与粘贴换行，不移除已有的块结构。文档或格式的外部更新不会被相同的 `plainText` 忽略，切换只读状态不会产生文字修改事件。产品的 `@sue/verd-board-ui/style.css` 已包含文字样式。
