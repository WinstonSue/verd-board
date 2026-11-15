---
name: verd-workflow-dag
description: '在青编工作区中使用DAG 流程范式创建或维护内容。适合无回环依赖；明确分支、汇合与执行条件，可使用 DAG 自动布局。'
---

# DAG 流程

先阅读通用 [VerdBoard 编写 Skill](../verd-authoring/SKILL.md)，再按当前范式读取细则。

- [范式规则说明](references/guide.md)
- [图表编写规范](../verd-authoring/references/diagram-quality.md)：创建或修改图表时读取。

规则正文直接读取 Markdown。通过 `verd patterns workflow-dag --json` 获取当前安装版本的 `templatePaths`，按路径读取原生执行模板：

- [原生模板 1](../../workflow-dag/模板.verd.json)

结合工作区通用与对应范式补充要求；自定义 Skill 根据描述按需读取。原生模板与产物继续使用原生格式和结构校验，编辑经过计划、校验、预览与条件提交。
