# 回环与人工交接 · 编写规则

允许重试回环；明确失败出口、停止条件和人工交接，保持 process 模式。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

使用 process 模式表达重试；仍禁止自环。失败分支需说明停止当前自动流程还是进入人工处理，重试边标明人工处理后的触发，不能让停止节点默认继续执行。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。构图、端口选择和预览复核遵循上方图表编写规范。

```json
{
  "type": "pattern.instantiate",
  "patternId": "workflow-process",
  "parameters": {
    "title": "回环与人工交接"
  },
  "dir": "workflow-process"
}
```

[打开原生模板](../../../workflow-process/模板.verd.json)
