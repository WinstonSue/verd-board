---
'@sue/board-react-text': minor
'@sue/verd-board-ui': minor
'@sue/verd-board-app': minor
'@sue/board-markdown-to-text': patch
'@sue/board-core': minor
'@sue/board-common': minor
'@sue/board-react': minor
---

原生项目文档迁入根工作区，并支持按稳定文件身份打开文档或画布及定位标题章节。

- 独立文档提供标题锚点；DocumentPage 增加可选链接打开和导航请求接口，编辑态使用 Cmd/Ctrl 单击，只读态直接单击。
- WorkspaceApp 支持可选工作区切换，保存成功后再更换会话；Host 可在激活后记住目录选择。
- Desktop 使用内置项目工作区，新安装复制可编辑副本，已有资料与用户修改继续保留。
- Markdown 行内代码按编辑器 schema 保留 code 标记，不能组合的外层格式返回明确降级告警。
- 四类画布可放置独立文档引用，固定窗口中只读滚动全文；文档可插入原生画布预览，源文件内容共享并支持双向循环引用。
- 文件副本及原生图文包携带完整嵌入闭包，统一重映射文档、画布和内部链接；项目导览拥有八张专题子图，并提供核心文档预览入口。
- 后台快照若已被本地编辑或保存超越，等待队列落盘后重新读取，避免把自己的保存误报为外部冲突并阻断撤销。
- 通用画布新增可编辑的 document-frame，与四类画布中的只读文档引用区分；双击正文编辑同一份源文档，撤销恢复原画布实例。八张专题子图补齐主文档卡和稳定章节链接。
