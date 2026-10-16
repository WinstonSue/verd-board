# @sue/board-react-text 结构文档

本目录存放**包内部结构**说明（面向维护者与二次开发），使用者文档见同包根目录 [README.md](../README.md)。

## 文档列表

| 文档                           | 内容                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| [STRUCTURE.md](./STRUCTURE.md) | 源码树、模块职责、数据流、与 `@sue/board-common` / Tiptap 的边界 |

## 维护说明

变更以下任一类内容时，建议同步更新 `STRUCTURE.md` 中对应小节：

- `src/index.ts` 的公开导出
- `Text` / `LineText` / `ParagraphText` 的职责或路由规则
- `paragraphExtensions` / `lineExtensions` 或 TipTap 扩展范围
- `EditorTextProps` 在 `@sue/board-common` 中的定义变更

**最后更新**: 2026-09-18
