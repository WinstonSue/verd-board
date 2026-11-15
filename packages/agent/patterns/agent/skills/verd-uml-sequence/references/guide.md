# UML 时序图 · 编写规则

按参与者和事件顺序编排；alt/opt/loop 表达分支和循环。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

参与者次序与事件次序分别维护，使用 sequence.reorder、sequence.move 和 sequence.activation。alt/opt/loop 的事件归属于正确操作数；激活区间须对应存活事件。消息沿生命线连接，不改成流程图正交边。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。视觉布局需要复核预览。

```json
{
  "type": "pattern.instantiate",
  "patternId": "uml-sequence",
  "parameters": {
    "title": "UML 时序图"
  },
  "dir": "uml-sequence"
}
```

[打开原生模板](../../../uml-sequence/模板.verd.json)
