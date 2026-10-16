# @sue/board-react-text 结构

```
src/
├── text.tsx                 # 按 BoardTextDocument.kind 路由
├── components/
│   ├── line/line-text.tsx
│   └── paragraph/paragraph-text.tsx
├── hooks/useParagraphEditor.ts
├── utils/controller.ts      # createBoardTextController
└── constants/editor-config.ts
```

`onCreate` 调用 `createBoardTextController`，得到 `BoardTextController`。活动编辑器、选区、marks、链接和 commit 都走同一个 TipTap `Editor`。
