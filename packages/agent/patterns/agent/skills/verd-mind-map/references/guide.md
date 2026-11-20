# Mind 知识树 · 编写规则

用父子关系表达分类；跨分支关系使用链接或说明，避免重复正文。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

父子关系是分类与层级的唯一来源，调整分支使用 relation.move；不要靠坐标或重复主题伪造关系。跨分支关系使用链接或说明，保留笔记与主题的独立正文。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。视觉布局需要复核预览。

```json
{
  "type": "pattern.instantiate",
  "patternId": "mind-map",
  "parameters": {
    "title": "Mind 知识树"
  },
  "dir": "mind-map"
}
```

[打开原生模板](../../../mind-map/模板.verd)
