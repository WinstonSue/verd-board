# DAG 流程 · 编写规则

适合无回环依赖；明确分支、汇合与执行条件，可使用 DAG 自动布局。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

使用 DAG 模式，不用回边表达重试。明确每个分支的结果、汇合和完成条件；需要重试或人工交接时改用 process 范式。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。视觉布局需要复核预览。 先确定主流程方向，再选端口：横向流程默认右出左入，纵向流程默认下出上入；不要用显式端口绕过普通流程的方向偏好。validate/plan 的 workflow\.port-direction 是非阻断提示，每条提示都要修正或确认是必要的分支、回路，并结合预览自检；允许保留例外，不自动改口。

```json
{
  "type": "pattern.instantiate",
  "patternId": "workflow-dag",
  "parameters": {
    "title": "DAG 流程"
  },
  "dir": "workflow-dag"
}
```

[打开原生模板](../../../workflow-dag/模板.verd.json)
