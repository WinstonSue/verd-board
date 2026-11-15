# 白板说明板 · 编写规则

按信息区域编排图形、标注、表格与箭头；分组表达编辑整体。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

以区域、注释、组合和表格组织内容；组合表示编辑整体，不代替领域归属。普通内容泳道可作为表格使用，只有结构图成员才填写 laneMembers。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。视觉布局需要复核预览。

```json
{
  "type": "pattern.instantiate",
  "patternId": "whiteboard",
  "parameters": {
    "title": "白板说明板"
  },
  "dir": "whiteboard"
}
```

[打开原生模板](../../../whiteboard/模板.verd.json)

基础白板展示图形、连线和人工复核链接入口，不是一份完整业务流程。用于真实流程时，需根据已有规则补齐判断结果与后续处理，不从图形样例推导业务门槛。
