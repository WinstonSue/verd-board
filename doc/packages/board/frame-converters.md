# Frame 转换器

转换器直接读写 `FrameSnapshot = {store: CellStore}`，不生成 BoardElement，也不在领域文档与 CellStore 之间往返。旧数据转换只在应用迁移入口处理。

```ts
import { parseMarkdownToFrameSnapshot, serializeFrameToMarkdown } from '@sue/board-markdown-to-board';
import { parseMermaidToFrameSnapshot, serializeFrameToMermaid } from '@sue/board-mermaid-to-board';

const mind = parseMarkdownToFrameSnapshot('# Center\n## Topic');
const markdown = serializeFrameToMarkdown(mind);
const whiteboard = await parseMermaidToFrameSnapshot('flowchart LR\nA --> B');
const workflow = await parseMermaidToFrameSnapshot('flowchart LR\nstart([Start]) --> task[Task]', { scene: 'workflow' });
const architecture = await parseMermaidToFrameSnapshot('flowchart TB\nsubgraph app[App]\nA[Module]\nend', { scene: 'architecture' });
const mermaid = serializeFrameToMermaid(workflow);
```

默认 Mermaid 场景是白板；流程图、时序图、类图直接生成可编辑 Cell，其他已有支持的 Mermaid 图生成图片 Cell。流程和架构场景只接受 flowchart；结构必须通过对应领域校验。流程默认 DAG，有回环的流程可指定 `{scene:'workflow', graphMode:'process'}`；自连和连入开始事件在两种模式下都拒绝。

Markdown 转换器内部分为 mdast↔富文本（`richtext.ts`）、mdast 大纲↔Mind 树（`parse.ts`）、Mind 树→mdast（`serialize.ts`）三段，导出经 `remark-stringify` 处理转义、反引号与列表缩进。层级规则：单个 H1 为中心主题，多个 H1 各成一棵树并保持顺序；无 H1 时以最浅标题为中心，多个最浅标题合并为合成中心树；完全无标题时 `options.fallbackTitle` 作为合成中心主题名（文件入口用去扩展名后的文件名，粘贴用"中心主题"）。跳级标题挂到最近的较浅标题，首个标题之前的正文归入第一棵树的根笔记；嵌套列表逐项生成子主题，首段为标题、后续段落为笔记，空标题与空列表项保留为空主题。

主题正文与折叠状态的笔记导出为引用块；引用内的标题、列表、代码块属于笔记内容，导入时剥掉最外层笔记包装后不参与建树。粗体、斜体、行内代码与链接往返为对应 marks（含组合与引用式链接定义）；图片保留替代文字与地址，HTML 作为文字处理。第 1～6 层导出为标题，第 7 层起使用嵌套列表，深层主题的笔记放在对应列表项的引用块内。导出优先读取 `content.text`，缺失时回退 `content.label`。Markdown 不携带 id、样式、布局、视口、主题、富文本字号颜色、折叠与概要（`MARKDOWN_LOSSY_FIELDS`），往返只比较层级、顺序、内容与支持的 marks。

快照内多棵 Mind 树按实际包围盒纵向排列（树间距 80）；向已有 Mind 追加时整个导入块经 `mindLayoutBounds`+`offsetMindTreeRoots` 平移到现有内容右侧 80，只改根坐标不动派生子节点。画布导入走既有预览对话框（预览不写 store，提交时一次事务，空 Markdown 拒绝），导出预览后再由用户复制或下载；白板中的 Mind 引用导出解析到源文件。工作区文件树导入 `.md` 创建独立文档，不走 Mind 转换器。Mermaid 领域导出通过 `%% verd:` 元数据保留 Cell id、明确坐标、端口、图成员、模式和原点；样式、富文本、视口和主题不写入文本。白板含自由端点箭头、嵌套 Frame 或脑图时，Mermaid 导出会报告无法表达的内容。

产品文本导入对话框以只读 FrameCanvas 预览，确认插入后用一个事务重新映射 id 并写入当前 Frame。不同场景的导入内容作为嵌套 Frame 保留；相同场景直接插入成员（workflow 场景会并存为第二个分图）。「打开」为整帧替换且重映射全部 id：workflow 场景画布上会触发 `Cannot delete a workflow start` 而失败，mind 场景画布上打开缺少 `mind-root` 的内容同样被拒，architecture 场景则要求新内容仍含 `architecture-layer`。

两条文件入口不要混淆：**工作区文件树的「导入画布/包」**接受 `.json`/`.verd.json`（`FrameFileV2` 或 `verd-canvas-bundle`）、`.verd-doc.json`（独立文档）以及 `.md`/`.markdown`（创建独立文档，不是画布脑图）；**画布菜单的「打开/导入」**接受 `FrameSnapshot` JSON 与 `.md`、`.markdown`、`.mmd`、`.mermaid` 文本（按当前 Frame 场景经转换器解释）。`.verd.json` 不能走画布菜单，`.mmd` 不能走文件树。JSON 导出只包含当前挂载 Frame 的子树。各格式与入口的完整说明见 [面向 AI 的画布数据生成规范](../../guides/ai-canvas-data-spec.md)。

验证入口：Markdown 包的原生树结构测试；Mermaid 包的 94 个原有图例、领域往返与拒绝测试；`tests/web-e2e/src/cell-product.spec.ts` 的实际导入、编辑、导出、撤销、保存及刷新测试。

## 文档 Markdown（`@sue/board-markdown-to-text`）

独立文档转换器读写 `BoardTextDocument`，不经过 FrameSnapshot。用于 `.verd-doc.json` 文档的 `.md` 导入导出。

```ts
import { parseMarkdownToTextDocument, serializeTextDocumentToMarkdown } from '@sue/board-markdown-to-text';

const { document, warnings } = parseMarkdownToTextDocument('# Title\n\n- a\n- b', { id: 'doc-1' });
const { markdown } = serializeTextDocumentToMarkdown(document);
```

解析覆盖 CommonMark + GFM：标题、段落、强调/删除线、行内代码、链接、图片（块级原子节点）、有序/无序列表、引用、代码块、分隔线、表格与任务列表。定义式链接、脚注、HTML 块等模型无法表达的结构降级为可读文本并在 `warnings` 中报告，绝不静默丢弃。导出对无法 Markdown 化的标记（字号、字体、颜色、高亮等）保留文本并告警。往返测试覆盖全部支持的结构。

验证入口：`packages/converters/markdown-to-text/src/index.spec.ts` 的解析、序列化与往返测试。
