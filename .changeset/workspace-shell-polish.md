---
'@sue/verd-board-ui': minor
'@sue/verd-board-app': patch
---

工作区外壳视觉与交互修整：文件树行菜单（⋯ 与右键）、按深度缩进与类型图标、可折叠回收区；标签栏、图表库、整理预览与设置页统一为画布的 slate + 靛蓝风格；工作区设置改为独立全屏页（`WorkspaceSettings` 新增 `onBack`、`defaultName`，移除 `globalContent`），`FrameSettingsPage` 导出并支持 `backLabel`。修复工作区配置输入回滚，以及提交在途时改配置导致同批写入被丢弃；导入失败改为通知，不再替换整个工作区。
