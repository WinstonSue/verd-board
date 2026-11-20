# UML 类图 · 编写规则

使用类、接口与关系表达静态契约；区分继承、组合及关联。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

类、接口、抽象类与枚举表达静态契约；成员与关系跟随对应类身份。区分继承、实现、关联、依赖、聚合和组合，不用布局代替关系语义。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。视觉布局需要复核预览。

```json
{
  "type": "pattern.instantiate",
  "patternId": "uml-class",
  "parameters": {
    "title": "UML 类图"
  },
  "dir": "uml-class"
}
```

[打开原生模板](../../../uml-class/模板.verd)
