# 分层架构 · 编写规则

层表达职责边界，模块可独立摆放或归属一个层；连线标明接口或数据含义。

[图表编写规范](../../verd-authoring/references/diagram-quality.md) · 判断语义、文字适配、路径与泳道规则，以及 validate → preview → 看图的交付闭环。

层表达职责边界，模块可独立摆放或归属一个层；用 architecture.reorder 调整层序、relation.move 调整归属。连线标明接口或数据含义，不将展示坐标当作层成员关系。

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

[打开原生模板](../../../architecture/模板.verd)

## 容器与关系

层、模块、存储和卡片使用画布放置交互。层整体移动携带成员；模块完整拖入正文区加入，越过边界脱离。内容尺寸变化、显式加入和自动布局可扩容，主动拖出不撑大原层。relation.move 的 parentId 可传文件根 Frame ID 表示无所属层。架构图默认使用层，不新增泳道或判断节点；旧图保留兼容。

architecture-edge 连接层与层，或模块与模块，不跨抽象层级。data.relation 为 dependency 时用虚线开放箭头，依赖方指向被依赖方；flow 使用实线实心箭头，发送方指向接收方。层间线较粗、沿容器外围走，模块线连接具体模块。层间关系独立编写，不从模块连线自动汇总，也不改变归属与层序。每条边写清具体依赖或传递内容。旧边未指定 relation 时保留原义，不从线型推断。

所有支持文本的图都可用 card 承载标题和说明，正文存于 content.text 的块文本；卡片自由摆放，不加入层、泳道或领域自动布局，不参与业务连线。Mermaid 不承载卡片，含卡片等原生结构的图通过原生 JSON 编辑并保留原生源文件；预览与图片导出遵循[通用内容编写规范](../../verd-authoring/references/writing.md#交付与自查)。
