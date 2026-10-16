# @sue/board-react-text

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

| `kind` | 行为 |
| ------ | ---- |
| `'block'` | `ParagraphText`（多行富文本） |
| `'inline'` | `LineText`（单行，禁止 Enter 换行） |

## 导出

| 导出 | 说明 |
| --- | --- |
| `Text` / `ParagraphText` / `LineText` | 文本组件 |
| `TextPreview` | 与编辑器共用 schema 和样式的静态正文，不创建编辑器实例 |
| `createBoardTextController` | 用 TipTap `Editor` 构造 `BoardTextController` |
| `safeFocus` / `measureContainerSize` | 聚焦与测高 |
| `paragraphExtensions` / `lineExtensions` | TipTap 扩展 |

旧 `raw.blocks` / `children` 文档只在载入时由 `migrateLegacyTextDocument` 解析。

查看和编辑共享段落、标题、列表、引用、代码、表格、空行与文字格式的排版规则。`LineText` 只限制输入与粘贴换行，不移除已有的块结构。文档或格式的外部更新不会被相同的 `plainText` 忽略，切换只读状态不会产生文字修改事件。产品的 `@sue/verd-board-ui/style.css` 已包含文字样式。
