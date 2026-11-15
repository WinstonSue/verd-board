# 分层架构 · 编写规则

层表达职责边界，模块恰属一个层；连线标明接口或数据含义。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

层表达职责边界，模块恰属一个层；用 architecture.reorder 调整层序、relation.move 调整归属。连线标明接口或数据含义，不将展示坐标当作层成员关系。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。视觉布局需要复核预览。

```json
{
  "type": "pattern.instantiate",
  "patternId": "architecture",
  "parameters": {
    "title": "分层架构"
  },
  "dir": "architecture"
}
```

[打开原生模板](../../../architecture/模板.verd.json)
