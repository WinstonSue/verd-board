# @sue/board-markdown-to-text

## 2.0.0

### Major Changes

- 首次发布：Markdown 与独立 BoardTextDocument 双向转换，支持 CommonMark/GFM 并返回有损转换 warnings；修正发布后的声明入口。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

### Minor Changes

- b556617: 独立文档成为工作区一等文件类型：与画布共用文件树、标签页、存储、回收站与统一撤销历史。

  - 新增 `DocumentFileV1` 与 `WorkspaceFile` 联合类型；文档以 `.verd-doc.json` 持久化，正文复用 `BoardTextDocument`。三类 Host（内存 / Web IndexedDB / Desktop 文件系统）统一识别与读写文档；快照拆分为 `files`（画布）/ `documents` / `entries`。
  - `WorkspaceSession` 文件命令泛化：创建 / 更新 / 重命名 / 移动 / 回收 / 还原 / 复制 / 导入对两种文件类型生效；撤销历史带 `group` / `name` / `primaryFileId` / `selection` 元数据，连续同组编辑合并为一步，画布与文档共享同一时间线；保存队列修复版本链缺陷（已提交操作不再重复入队），`flush()` 对 I/O 失败返回 `false` 而非抛错。
  - 冲突与外部变更覆盖文档：外部写入同步进干净文档，脏文档标记 `conflicted`，`resolveConflict` 支持 keep-local / load-disk 且可撤销。
  - 新增 `DocumentEditor`（`@sue/board-react-text`）：连续页编辑、工具栏状态订阅、标题层级/TOC、查找替换、表格与自定义图片节点、IME 合成与输入分组；提供中央历史适配器时关闭本地 TipTap undo，undo/redo 恢复编辑器选区。
  - 新增 `DocumentPage`（`@sue/verd-board-ui`）：标题栏、保存状态、固定工具栏、可折叠目录、查找替换栏、表格操作、图片插入与 JSON/Markdown 导出菜单；`FileTree` / `WorkspaceTabs` / `WorkspaceEmpty` 支持文档的创建、图标与操作。
  - `WorkspaceApp` 接入共享历史适配器（同时传给 `VerdFrame` 与 `DocumentPage`）；注册 `host.onShutdown(flush)`，Desktop 退出前等待落盘，Web 增加 `pagehide` best-effort flush；导入接受 `.md`（生成新文档）与 `.verd-doc.json`，导出支持原生 JSON 与 Markdown，转换降级告警经 notice 横幅呈现。
  - 新包 `@sue/board-markdown-to-text`：remark/GFM 双向转换——标题、段落、强调/删除线、链接、图片、列表、引用、代码块、分隔线、表格；无法表达的结构降级为可读文本并返回告警，绝不静默丢弃。

  升级注意：`WorkspaceSessionSnapshot.files` 现在仅含画布，文档经 `documents` 访问；`tabs` 统一为 `{fileId}`（旧 `{frameId}` 自动归一化）；`VerdBoardApp` 仍由 `WorkspaceApp` 取代。

### Patch Changes

- 6da91da: 原生项目文档迁入根工作区，并支持按稳定文件身份打开文档或画布及定位标题章节。

  - 独立文档提供标题锚点；DocumentPage 增加可选链接打开和导航请求接口，编辑态使用 Cmd/Ctrl 单击，只读态直接单击。
  - WorkspaceApp 支持可选工作区切换，保存成功后再更换会话；Host 可在激活后记住目录选择。
  - Desktop 使用内置项目工作区，新安装复制可编辑副本，已有资料与用户修改继续保留。
  - Markdown 行内代码按编辑器 schema 保留 code 标记，不能组合的外层格式返回明确降级告警。
  - 四类画布可放置独立文档引用，固定窗口中只读滚动全文；文档可插入原生画布预览，源文件内容共享并支持双向循环引用。
  - 文件副本及原生图文包携带完整嵌入闭包，统一重映射文档、画布和内部链接；项目导览拥有八张专题子图，并提供核心文档预览入口。
  - 后台快照若已被本地编辑或保存超越，等待队列落盘后重新读取，避免把自己的保存误报为外部冲突并阻断撤销。
  - 通用画布新增可编辑的 document-frame，与四类画布中的只读文档引用区分；双击正文编辑同一份源文档，撤销恢复原画布实例。八张专题子图补齐主文档卡和稳定章节链接。

- Updated dependencies
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
- Updated dependencies [b556617]
  - @sue/board-common@2.0.0
