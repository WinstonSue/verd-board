---
'@sue/board-core': major
'@sue/board-react': major
'@sue/verd-board-ui': major
'@sue/verd-board-app': major
---

项目数据存储治理：画布按文件持久化，工作区取代平铺快照。

- 每个可独立打开的 Frame 持久化为一份 `.verd.json`（FrameFileV2）；文件间以 `frame-reference` 引用壳互链，同一文件可被多处嵌入，壳几何/外观/思维导图偏移按实例保存，目标内容共享。
- 新增 `WorkspaceHost` 存储抽象：Desktop 真实文件夹（事务日志崩溃恢复）、Web IndexedDB 虚拟目录；写入带 expectedVersion 条件提交，外部变更经订阅同步，冲突走 load-disk / keep-local / save-copy 显式解决。
- 新增 `WorkspaceSession` 统一写入入口：命令经候选校验后原子提交，驱动统一撤销历史与去抖保存队列；支持文件创建/移动/回收区还原、普通引用复制与依赖闭包独立复制、导入导出。
- 产品外壳 `WorkspaceApp`：文件树、`@ylib/tabs` 多标签（frameId 即标签身份）、工作区设置、空态与来源导航；首次启动自动迁移旧平铺存储为工作区文件。
- 移除 `VerdBoardApp` 与平铺 manifest 保存队列（旧存储保留只读迁移路径）；`FrameCanvas` 新增引用渲染分支与按实例 mind 偏移。

升级注意：旧平铺存储数据在首次打开时自动迁移到新工作区，原记录保留备份；`VerdBoardApp` 已删除，宿主改用 `WorkspaceApp` + `createDesktopWorkspaceHost`/`createWebWorkspaceHost`。
