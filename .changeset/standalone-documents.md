---
'@sue/board-common': minor
'@sue/board-react-text': minor
'@sue/board-react': minor
'@sue/verd-board-ui': minor
'@sue/verd-board-app': major
'@sue/board-markdown-to-text': minor
---

独立文档成为工作区一等文件类型：与画布共用文件树、标签页、存储、回收站与统一撤销历史。

- 新增 `DocumentFileV1` 与 `WorkspaceFile` 联合类型；文档以 `.verd-doc.json` 持久化，正文复用 `BoardTextDocument`。三类 Host（内存 / Web IndexedDB / Desktop 文件系统）统一识别与读写文档；快照拆分为 `files`（画布）/ `documents` / `entries`。
- `WorkspaceSession` 文件命令泛化：创建 / 更新 / 重命名 / 移动 / 回收 / 还原 / 复制 / 导入对两种文件类型生效；撤销历史带 `group` / `name` / `primaryFileId` / `selection` 元数据，连续同组编辑合并为一步，画布与文档共享同一时间线；保存队列修复版本链缺陷（已提交操作不再重复入队），`flush()` 对 I/O 失败返回 `false` 而非抛错。
- 冲突与外部变更覆盖文档：外部写入同步进干净文档，脏文档标记 `conflicted`，`resolveConflict` 支持 keep-local / load-disk 且可撤销。
- 新增 `DocumentEditor`（`@sue/board-react-text`）：连续页编辑、工具栏状态订阅、标题层级/TOC、查找替换、表格与自定义图片节点、IME 合成与输入分组；提供中央历史适配器时关闭本地 TipTap undo，undo/redo 恢复编辑器选区。
- 新增 `DocumentPage`（`@sue/verd-board-ui`）：标题栏、保存状态、固定工具栏、可折叠目录、查找替换栏、表格操作、图片插入与 JSON/Markdown 导出菜单；`FileTree` / `WorkspaceTabs` / `WorkspaceEmpty` 支持文档的创建、图标与操作。
- `WorkspaceApp` 接入共享历史适配器（同时传给 `VerdFrame` 与 `DocumentPage`）；注册 `host.onShutdown(flush)`，Desktop 退出前等待落盘，Web 增加 `pagehide` best-effort flush；导入接受 `.md`（生成新文档）与 `.verd-doc.json`，导出支持原生 JSON 与 Markdown，转换降级告警经 notice 横幅呈现。
- 新包 `@sue/board-markdown-to-text`：remark/GFM 双向转换——标题、段落、强调/删除线、链接、图片、列表、引用、代码块、分隔线、表格；无法表达的结构降级为可读文本并返回告警，绝不静默丢弃。

升级注意：`WorkspaceSessionSnapshot.files` 现在仅含画布，文档经 `documents` 访问；`tabs` 统一为 `{fileId}`（旧 `{frameId}` 自动归一化）；`VerdBoardApp` 仍由 `WorkspaceApp` 取代。
