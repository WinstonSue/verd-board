# 富文本文档 · 编写规则

围绕读者问题组织章节；图文引用保持独立源文件。

[通用内容编写规范](../../verd-authoring/references/writing.md)

## 读者、结论与证据

先明确读者问题和本篇结论，再按所选范式展开。方案写推荐与取舍，ADR 标明真实决策状态，需求区分行为与方案假设；每类文档只使用与任务有关的章节。长内容先给对象与关系全景，使用目录和稳定链接组织细节，不把必要事实藏进折叠内容。

数字、条件、例外与来源保持完整；实测、推断和未知分开。可复用文档记录依据与更新时间，图表提供关系信息而不引入新事实。进度、阻塞、决策、复盘和验收的具体结构按通用规范对应章节读取。

比较同维度对象用表格，各有不同职责的对象分别成节；原始日志与长输出放在需要时可查的附录。先执行可完成的检查，再列真实开放问题，不硬套“需要决定”或“要核对”。

实例化参数：title 为根文件标题；工具自动生成独立身份。模板实例化会重新映射整个引用闭包。

编辑示例：先 inspect 获得身份与正文块，再使用 document.splice、node.upsert 或对应关系操作，plan 后 validate 与 preview。

结构规则：以 verd rules 和 describe 返回的已安装版本为准。视觉布局需要复核预览。

```json
{
  "type": "pattern.instantiate",
  "patternId": "rich-document",
  "parameters": {
    "title": "富文本文档"
  },
  "dir": "rich-document"
}
```

[打开原生模板](../../../rich-document/模板.verd-doc.json)

## 原生编辑与引用

先 inspect 确认文件与正文块，用 document.splice 增量修改；保留未修改的 marks、attrs.blockId、表格及引用。document.set 只用于明确需要重写全文的场景，不能用 plainText 覆盖富文本。工具从 content 派生 plainText，document.id 与 text.id 必须一致。

段落链接使用稳定 block: 身份；documentExcerpt 引用源文档与源段落，删除或循环引用保留明确反馈。文件链接、标题 slug 与图元链接分别保留各自目标语义。正文嵌图保持独立源文件；修改图表时先读图表编写规范。

[图表编写规范](../../verd-authoring/references/diagram-quality.md)

通过 describe 查询当前独立文档的真实 schema。details、LaTeX、attachment、webEmbed 等只用于已注册的独立文档及文档 Frame，不照搬到画布短标签或 Mind 笔记。HTTPS 嵌入保存 URL 与属性，不写任意 iframe HTML。

verd resource-import --input FILE --workspace DIRECTORY 会立即保存内容寻址资源并返回 attachment 属性；随后再通过 document.set/splice 的计划引用该资源。这两个步骤不是同一个原子计划，正文失败不会撤销已保存的资源。PDF 页码链接使用 verd://asset/\<hash.ext>#page=N，N 为从 1 开始的物理页码。

## 文档范式选用

### 技术方案

范式 ID：technical-proposal。比较方案并说明取舍，写清目标、范围约束、设计接口、实施与验收。验收应能对应目标，开放问题保持显式，不将候选方案写成已决定事实。

[打开技术方案模板](../../../technical-proposal/模板.verd-doc.json)

### ADR 决策记录

范式 ID：adr。记录一个明确决策的背景、备选、决定、理由和影响；标注真实状态与复查条件。草案不冒充已接受决定，被替代时保留原决策身份及替代链接。

[打开ADR 决策记录模板](../../../adr/模板.verd-doc.json)

### 系统设计

范式 ID：system-design。描述目标场景、系统边界、组件数据流、数据接口、异常与演进。按需链接独立架构图和时序图，核对正文与图的职责、接口及失败处理一致。

[打开系统设计模板](../../../system-design/模板.verd-doc.json)

### 需求梳理

范式 ID：requirements。先明确用户与问题，再写流程、需求清单、验收场景和开放问题。区分需求与方案假设，给出输入、操作、预期结果和边界，不自行补业务门槛。

[打开需求梳理模板](../../../requirements/模板.verd-doc.json)

## 验收边界

validate 检查身份、正文 schema、缓存、引用和链接；不会判断需求是否完整、ADR 是否已获同意或方案是否符合业务。交付前对照读者问题审阅正文，检查模板占位、阅读布局和嵌入；图表另执行质量规范闭环。
