---
name: verd-multi-system
description: '在青编工作区中使用导航与多系统方案范式创建或维护内容。总图只表达边界和交接，各系统内部图展开步骤；共享能力独立维护。'
---

# 导航与多系统方案

先阅读通用 [VerdBoard 编写 Skill](../verd-authoring/SKILL.md)，再按当前范式读取细则。

- [范式规则说明](references/guide.md)
- [图表编写规范](../verd-authoring/references/diagram-quality.md)：创建或修改图表时读取。

规则正文直接读取 Markdown。通过 `verd patterns multi-system --json` 获取当前安装版本的 `templatePaths`，按路径读取原生执行模板：

- [原生模板 1](../../multi-system/协作总图.verd.json)
- [原生模板 2](../../multi-system/工单接入内部图.verd.json)
- [原生模板 3](<../../multi-system/Agent 开发内部图.verd.json>)
- [原生模板 4](../../multi-system/代码发布内部图.verd.json)
- [原生模板 5](../../multi-system/文档导航.verd-doc.json)

结合工作区通用与对应范式补充要求；自定义 Skill 根据描述按需读取。原生模板与产物继续使用原生格式和结构校验，编辑经过计划、校验、预览与条件提交。
