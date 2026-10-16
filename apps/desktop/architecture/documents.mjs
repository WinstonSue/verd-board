/** Native demo source. Package relationships come from workspace manifests. */
export const DEMO_DATE = '2026-10-14';
export const DEMO_SOURCE = 'apps/desktop/architecture/documents.mjs';
export const TOPICS = [
  [
    'board/20:architecture-layered',
    '① 项目分层与依赖',
    '两个应用 · 十七个公开包 · 职责与主要直接依赖',
  ],
  [
    'board/22:architecture-data-flow',
    '② 运行时协作',
    '共享画布 · 领域扩展 · 标准与宿主接入',
  ],
  [
    'board/5:Ybbcn',
    '③ Cell/Frame 核心模型',
    '所有权、领域锚点、历史和持久化边界',
  ],
  [
    'demo:workspace-load',
    '④ 加载与迁移',
    '首次使用、清单升级、旧数据备份和错误恢复',
  ],
  [
    'board/5:wfArc',
    '⑤ 编辑、事务与历史',
    '候选执行、校验、原子提交和宿主接受/拒绝',
  ],
  [
    'demo:save-close',
    '⑥ 保存与安全关闭',
    '不可变记录、清单提交、重试与两端生命周期',
  ],
  [
    'demo:import-export',
    '⑦ 导入、打开与导出',
    '格式转换、预览、ID 重映射和表达能力边界',
  ],
  [
    'detached/25:mind/mind-mudf73s2-9hi9x8',
    '⑧ 开发与验收',
    '源码入口、开发命令、质量检查和发布流程',
  ],
].map(([id, title, summary]) => ({ id, title, summary }));
export const EXISTING_FRAME_IDS = TOPICS.filter(
  (_, i) => ![3, 5, 6].includes(i),
).map((t) => t.id);
export const HOME_IDS = [
  'r:title',
  'r:sub',
  'demo:home/intro',
  'demo:home/guide',
  ...['whiteboard', 'mind', 'workflow', 'architecture'].map(
    (s) => 'demo:home/capability/' + s,
  ),
  ...TOPICS.flatMap((_, i) => [
    'demo:home/title/' + i,
    'demo:home/summary/' + i,
  ]),
];
const COLORS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#b45309',
  '#0f766e',
  '#2563eb',
];
const ports = (start = false) =>
  ['top', 'right', 'bottom', 'left'].map((side) => ({
    id: side,
    side,
    direction: start ? 'output' : 'both',
    offset: 0.5,
  }));
export const textDocument = (
  id,
  label,
  size = 20,
  color = '#1e293b',
  bold = false,
  kind = 'inline',
) => ({
  schemaVersion: 1,
  id: id + '/text',
  kind,
  plainText: label,
  content: {
    type: 'doc',
    content: label.split('\n').map((line) => ({
      type: 'paragraph',
      content: line
        ? [
            {
              type: 'text',
              text: line,
              marks: [
                ...(bold ? [{ type: 'bold' }] : []),
                { type: 'textStyle', attrs: { fontSize: size + 'px', color } },
              ],
            },
          ]
        : [],
    })),
  },
});
const content = (id, label, size, color, bold) => ({
  label,
  text: textDocument(id, label, size, color, bold),
});
const record = (topic, cells) => ({
  format: 'verd-frame',
  version: 1,
  frame: {
    id: topic.id,
    kind: 'frame',
    cellType: 'frame',
    geometry: { x: 0, y: 0, width: 680, height: 470, derived: false },
    children: cells.map((c) => c.id),
    groups: [],
    data: { demoSource: DEMO_SOURCE },
    content: content(topic.id, topic.title, 14),
    appearance: { fill: '#ffffff', strokeColor: '#cbd5e1', strokeWidth: 2 },
    view: { theme: { themeColorMode: 'default', boardBackground: '#ffffff' } },
  },
  cells: Object.fromEntries(cells.map((c) => [c.id, c])),
});
const packageGroups = [
  [
    '应用入口',
    [
      ['apps/desktop', 'Electron 桌面 · preload / IPC'],
      ['apps/web', '浏览器 · Web StorageAdapter'],
    ],
  ],
  [
    '产品层',
    [
      ['packages/product/app', '工作区、导航、加载与保存队列'],
      ['packages/product/ui', '工具、属性、设置与导入导出'],
    ],
  ],
  [
    'React 适配',
    [
      ['packages/react/board', '唯一 FrameCanvas 与控制器'],
      ['packages/react/text', 'TipTap 编辑器与文本控制器'],
      ['packages/react/mind', '脑图行为、布局与渲染扩展'],
      ['packages/react/workflow', '流程端口、校验与布局扩展'],
      ['packages/react/architecture', '架构层、模块与布局扩展'],
    ],
  ],
  [
    '基础引擎',
    [
      ['packages/engine/core', 'Cell / 事务 / 几何 / Group / 排列'],
      ['packages/engine/common', '文本模型、转换与测量'],
      ['packages/engine/layouts', '树布局与通用 DAG 算法'],
      ['packages/engine/text', '独立文本工具 · mark / 链接 / 剪贴板'],
    ],
  ],
  [
    '领域引擎',
    [
      ['packages/engine/draw', '原生形状、表格与 Rough 路径'],
      ['packages/engine/mind', '主题、分支、概要与树命令'],
      ['packages/engine/workflow', '开始事件、任务、DAG / process'],
      ['packages/engine/architecture', '层、模块、归属与依赖路由'],
    ],
  ],
  [
    '导入导出边界',
    [
      [
        'packages/converters/markdown-to-board',
        'Markdown ↔ Mind FrameSnapshot',
      ],
      ['packages/converters/mermaid-to-board', 'Mermaid ↔ 白板 / 流程 / 架构'],
    ],
  ],
];
export const PACKAGE_DIRECTORIES = packageGroups.flatMap(([, entries]) =>
  entries.map(([p]) => p),
);
export function packageArchitecture(manifests) {
  const nodes = packageGroups.flatMap(([, entries]) =>
    entries.map(([directory, role]) => {
      const manifest = manifests[directory];
      if (!manifest) throw new Error('Missing package manifest: ' + directory);
      return {
        id: manifest.name,
        label: manifest.name + '\n' + role,
        directory,
        manifest,
      };
    }),
  );
  const known = new Set(nodes.map((n) => n.id));
  const direct = nodes.flatMap((n) =>
    Object.keys(n.manifest.dependencies ?? {})
      .filter((p) => known.has(p))
      .sort()
      .map((p) => [n.id, p]),
  );
  const hasPath = (source, target, excluded, visited = new Set()) => {
    if (source === target) return true;
    if (visited.has(source)) return false;
    visited.add(source);
    return direct.some(
      (e) =>
        e !== excluded &&
        e[0] === source &&
        hasPath(e[1], target, excluded, visited),
    );
  };
  for (const e of direct) {
    if (hasPath(e[1], e[0], e)) throw new Error('Cyclic workspace dependency');
  }
  return {
    layers: packageGroups.map(([label, entries]) => ({
      label,
      nodes: entries.map(([p]) => nodes.find((n) => n.directory === p)),
    })),
    edges: direct.filter((e) => !hasPath(e[0], e[1], e)),
    direct,
  };
}
export const runtimeArchitecture = {
  layers: [
    {
      label: '产品工作区 · 嵌入与详情共享数据',
      nodes: [
        {
          id: 'app',
          label: 'VerdBoardApp\n工作区状态 · 内存导航栈 · 保存队列',
        },
        {
          id: 'ui',
          label: 'VerdFrame / ProductShell\n工具 · 属性 · 导入导出 · 设置',
        },
      ],
    },
    {
      label: '统一画布 · 领域通过扩展注册',
      nodes: [
        {
          id: 'canvas',
          label: 'FrameCanvas\nvalue / onChange 或 adapter / onIntent',
        },
        {
          id: 'extensions',
          label: 'FrameRenderExtension\nMind / Workflow / Architecture 扩展',
        },
        {
          id: 'text',
          label: 'BoardTextController / TipTap\n富文本编辑 → CellTransaction',
        },
      ],
    },
    {
      label: '运行时 · 历史、索引、选择不进入快照',
      nodes: [
        {
          id: 'runtime',
          label: 'CellRuntime\n候选操作 → 归一化 → 校验 → 提交',
        },
        {
          id: 'registry',
          label: 'CellRegistry / Util\n领域约束 · 几何 · 移动与复制行为',
        },
        {
          id: 'camera',
          label: 'FrameCanvas camera\n缩放 / 平移 / fit · 当前会话内存',
        },
      ],
    },
    {
      label: '数据与宿主 · 业务 value 由宿主持有',
      nodes: [
        {
          id: 'store',
          label:
            'FrameSnapshot = { store }\nrootId + cells · children / groups',
        },
        {
          id: 'host',
          label: '第三方宿主\n投影 value · 接受/拒绝意图 · 外部历史',
        },
        {
          id: 'queue',
          label: 'WorkspaceSaveQueue\n标准文档变化入队 · 防抖与 flush',
        },
      ],
    },
    {
      label: '持久化边界 · 启动时选定端适配器',
      nodes: [
        {
          id: 'adapter',
          label: 'StorageAdapter\ngetItem / setItem / removeItem / listKeys',
        },
        {
          id: 'desktop',
          label: 'Desktop · preload → IPC\n主进程串行写文件 · 原子 rename',
          shape: 'store',
        },
        {
          id: 'web',
          label: 'Web · localforage\nIndexedDB 优先 · localStorage 回退',
          shape: 'store',
        },
      ],
    },
  ],
  edges: [
    ['app', 'ui', '挂载'],
    ['ui', 'canvas', '挂载'],
    ['extensions', 'canvas', '扩展注入'],
    ['text', 'canvas', '编辑事务'],
    ['canvas', 'runtime', '标准事务'],
    ['runtime', 'registry', '调用'],
    ['runtime', 'store', '提交快照'],
    ['store', 'app', 'onChange'],
    ['canvas', 'host', 'onIntent'],
    ['host', 'canvas', 'adapter.toFrameSnapshot'],
    ['canvas', 'camera', '视图交互'],
    ['app', 'queue', 'enqueue'],
    ['queue', 'adapter', '记录与清单'],
    ['adapter', 'desktop'],
    ['adapter', 'web'],
  ],
};
function architectureRecord(topic, model, prefix) {
  const cells = [];
  model.layers.forEach((layer, i) => {
    const id = prefix + '/layer/' + i;
    const step = prefix === 'demo:runtime' ? 460 : 396;
    const offset = ((5 - layer.nodes.length) * step) / 2;
    const members = layer.nodes.map((n, column) => {
      const nid = prefix + '/module/' + n.id;
      return {
        id: nid,
        kind: 'architecture-module',
        cellType: 'node',
        geometry: {
          x: 20 + offset + column * step,
          y: i * 220 + 54,
          width: 372,
          height: 98,
          derived: false,
          outline:
            n.shape === 'store'
              ? 'store'
              : { kind: 'roundRectangle', radius: 8 },
        },
        ports: ports(),
        content: content(nid, n.label, 18),
        data: { shape: n.shape ?? 'box', placed: true },
        appearance: {
          fill: [
            '#f0fdfa',
            '#eff6ff',
            '#f5f3ff',
            '#fffbeb',
            '#f0fdfa',
            '#eff6ff',
          ][i],
          strokeColor: '#94a3b8',
          strokeWidth: 1.5,
        },
      };
    });
    cells.push(
      {
        id,
        kind: 'architecture-layer',
        cellType: 'node',
        geometry: { x: 0, y: i * 220, width: 1980, height: 170, derived: true },
        content: content(id, layer.label, 16, '#475569', true),
        data: {
          order: String(i).padStart(8, '0'),
          fontSize: 24,
          memberIds: members.map((n) => n.id),
        },
        appearance: { fill: '#f8fafc', strokeColor: '#e2e8f0', strokeWidth: 1 },
      },
      ...members,
    );
  });
  cells.push(
    ...model.edges.map(([source, target, label], i) => ({
      id: prefix + '/edge/' + i,
      kind: 'architecture-edge',
      cellType: 'edge',
      source: { cellId: prefix + '/module/' + source },
      target: { cellId: prefix + '/module/' + target },
      route: { mode: 'orthogonal' },
      ...(label ? { labels: [{ text: label, position: 0.5 }] } : {}),
      appearance: { strokeColor: '#64748b', strokeWidth: 1.5 },
    })),
  );
  return record(topic, cells);
}
const modelTree = [
  [
    '公开快照',
    [
      'FrameSnapshot = { store }',
      'CellStore = rootId + cells 扁平表',
      'Node / Frame / Edge / Group 四类 Cell',
    ],
  ],
  [
    'Frame 与所有权',
    [
      'children：直接所有权 + 绘制顺序',
      'groups：本 Frame 的分组列表',
      '嵌套 Frame：单独记录，仍有父 Frame',
      'detached：没有父级的独立 Frame',
      'view.theme 持久化；camera 不持久化',
    ],
  ],
  [
    'Node / Edge / Group',
    [
      'Node：geometry / appearance / ports / content',
      'Edge：source / target / route / labels',
      'Group：members 引用，可嵌套与独立锁定',
      '对齐、分布、自动排列；Mind 保持树布局',
    ],
  ],
  [
    '领域锚点',
    [
      '无锚点：自由白板',
      'mind-root：分支边表达主题树',
      'workflow-start：成员、端口、DAG / process',
      'architecture-layer：层顺序、模块归属、依赖',
      '一个 Frame 不混合领域场景',
    ],
  ],
  [
    '事务与历史',
    [
      '候选操作 → 关系归一化 → 最终校验',
      '成功才整体提交；失败保留原快照',
      '历史记录实际前后差异；级联删除可撤销',
      '跨 Frame 转移与复制闭包维护完整关系',
    ],
  ],
  [
    '运行时与磁盘',
    [
      '历史 / 索引 / 选择 / 缓存 / DOM 不落盘',
      '相机与导航是内存状态，不产生保存事务',
      'Frame 记录 v1；工作区清单 v2',
      '清单关联嵌套与独立 Frame；加载后组装',
    ],
  ],
];
const developmentTree = [
  [
    '环境与运行',
    [
      'Node ≥ 22 · pnpm ≥ 11.18.0',
      'pnpm install',
      'pnpm start：Desktop',
      'pnpm dev:web：Web',
    ],
  ],
  [
    '源码入口',
    [
      'apps/：端入口与存储适配器',
      'packages/product/：生命周期与产品工具',
      'packages/react/：画布、领域扩展、文本',
      'packages/engine/：模型、事务、几何与领域',
      'packages/converters/：导入导出边界',
    ],
  ],
  [
    '基础检查',
    [
      'pnpm typecheck',
      'pnpm test：Vitest',
      'pnpm lint',
      'pnpm build：公开包与 Web',
    ],
  ],
  [
    '产品与消费验收',
    [
      'pnpm build:web · pnpm build:desktop',
      'pnpm test:e2e:prod：最新 Web 产物',
      'pnpm test:e2e:desktop：真实 Electron',
      'pnpm test:consumer：隔离消费与严格类型',
      '构建后验收；不使用旧 dist 宣称通过',
    ],
  ],
  [
    '发布与协作',
    [
      'Conventional Commits · workspace:*',
      'pnpm changeset：记录版本变更',
      'pnpm release → pnpm pub：版本与发布',
      '发布由维护者执行；demo 不自动发布',
    ],
  ],
  [
    '文档与 demo 维护',
    [
      'doc/ 为技术文档入口；中英主文档同步',
      'pnpm --filter desktop generate-architecture',
      '追加 --check：只读检查 demo 漂移',
      '追加 --output 路径：隔离预览文件',
      '保留非托管内容；写入前检查并发变化',
    ],
  ],
];
function mindRecord(topic, branches, prefix, label, sourceNote) {
  const root = prefix + '/root';
  const cells = [
    {
      id: root,
      kind: 'mind-root',
      cellType: 'node',
      geometry: {
        x: 0,
        y: 0,
        width: 300,
        height: 64,
        derived: false,
        outline: 'roundRectangle',
      },
      content: content(root, label, 24, '#ffffff', true),
      appearance: { fill: '#0f766e', strokeColor: '#0f766e' },
      data: {
        layout: 'standard',
        rightNodeCount: 3,
        note: textDocument(
          root + '/note',
          sourceNote,
          16,
          '#475569',
          false,
          'block',
        ),
        noteCollapsed: true,
      },
    },
  ];
  const add = (label, parent, key, order, color, depth) => {
    const id = prefix + '/node/' + key;
    const size = depth === 1 ? 20 : 18;
    // Native fallback metrics count every character as 0.6em. Give Chinese
    // demo labels enough explicit width to stay on one line without clipping.
    const manualWidth =
      Math.ceil(
        [...label].reduce(
          (width, char) =>
            width + size * (char.codePointAt(0) > 255 ? 1.05 : 0.7),
          0,
        ),
      ) + 32;
    cells.push(
      {
        id,
        kind: 'mind-child',
        cellType: 'node',
        geometry: {
          x: 0,
          y: 0,
          width: 240,
          height: 48,
          derived: true,
          outline: 'roundRectangle',
        },
        content: content(
          id,
          label,
          depth === 1 ? 20 : 18,
          depth === 1 ? color : '#334155',
          depth === 1,
        ),
        appearance: {
          fill: depth === 1 ? '#f0fdfa' : '#ffffff',
          strokeColor: color,
          strokeWidth: depth === 1 ? 2 : 1,
        },
        data: {
          manualWidth,
          collapsed: false,
          branchAppearance: { strokeColor: color, strokeWidth: 2 },
        },
      },
      {
        id: prefix + '/branch/' + key,
        kind: 'mind-branch',
        cellType: 'edge',
        source: { cellId: parent },
        target: { cellId: id },
        route: { mode: 'auto' },
        data: { order: String(order).padStart(8, '0') },
        appearance: { strokeColor: color, strokeWidth: 2 },
      },
    );
    return id;
  };
  branches.forEach(([label, leaves], i) => {
    const id = add(label, root, String(i), i, COLORS[i], 1);
    leaves.forEach((leaf, j) => add(leaf, id, i + '-' + j, j, COLORS[i], 2));
  });
  return record(topic, cells);
}
// Entries: [key, label, column, row, kind?]. Edges: [source, target, label?, from?, to?].
const loadFlow = {
  prefix: 'demo:load',
  nodes: [
    ['start', '启动应用', 0, 0, 'start'],
    ['adapter', '选择 Web / Desktop 适配器\n注册完整 CellRegistry', 0, 1],
    ['format', '工作区格式？', 0, 2, 'decision'],
    ['new', '首次使用，无旧记录\n创建空工作区', 0, 3],
    ['v2', 'verd-workspace v2\n按清单读取 Frame 记录', 1, 2],
    ['v1', '清单 v1\n读取旧备份并修复候选快照', 1, 3],
    ['legacy', '旧格式：枚举记录\n转换白板及领域数据', 1, 4],
    ['copy', '共享文档复制为独立容器\n未挂载文档保留为 detached', 2, 4],
    ['validate-old', '校验迁移候选\n原样备份后提交新工作区', 3, 4],
    ['partition', '校验 Frame 分区与全局 ID\n组装并验证 CellStore', 2, 2],
    ['repair', '校验修复候选\n提交 v2 工作区清单', 2, 3],
    ['materialize', '物化流程 / 架构旧派生位置\n有变化则入保存队列', 3, 2],
    ['mount', '设置工作区与根 frameId\nVerdFrame → FrameCanvas', 3, 1],
    ['error', '读取 / 转换 / 校验失败\n显示加载错误，保留原数据', 0, 5],
    ['retry', '用户重新加载\n重新读取工作区', 1, 5],
  ],
  edges: [
    ['start', 'adapter'],
    ['adapter', 'format'],
    ['format', 'new', '无数据'],
    ['format', 'v2', 'v2', 'right', 'left'],
    ['format', 'v1', 'v1', 'right', 'left'],
    ['format', 'legacy', '旧格式', 'right', 'left'],
    ['new', 'materialize'],
    ['v2', 'partition', '', 'right', 'left'],
    ['v1', 'repair', '', 'right', 'left'],
    ['legacy', 'copy', '', 'right', 'left'],
    ['copy', 'validate-old', '', 'right', 'left'],
    ['validate-old', 'materialize', '', 'top', 'bottom'],
    ['repair', 'materialize'],
    ['partition', 'materialize', '', 'right', 'left'],
    ['materialize', 'mount', '', 'top', 'bottom'],
    ['adapter', 'error', '失败', 'left', 'left'],
    ['partition', 'error', '失败'],
    ['repair', 'error', '失败'],
    ['legacy', 'error', '失败'],
    ['validate-old', 'error', '失败'],
    ['error', 'retry', '重试', 'right', 'left'],
    ['retry', 'adapter', '', 'right', 'right'],
  ],
};
const editFlow = {
  prefix: 'demo:edit',
  nodes: [
    ['start', '用户操作', 0, 0, 'start'],
    [
      'command',
      '指针 / 键盘 / 富文本 / 属性\n生成事务，检查只读/锁定/pending',
      0,
      1,
    ],
    ['gate', '允许编辑？', 0, 2, 'decision'],
    ['deny', '拒绝操作\n保持原快照', 0, 3],
    ['mode', '接入模式？', 1, 2, 'decision'],
    ['candidate', '标准：候选 operations\n维护关系并归一化', 2, 1],
    ['valid', '最终校验通过？', 3, 1, 'decision'],
    ['commit', '原子提交 CellStore\n记录实际前后 diff', 3, 0],
    [
      'change',
      'onChange：snapshot + transaction\n应用更新状态并 enqueue',
      4,
      0,
    ],
    ['history', '撤销 / 重做\n恢复事务前后 Cell 值', 4, 1],
    ['local', '宿主先本地校验 → onIntent\n异步等待期间阻止新事务', 2, 3],
    ['accept', '宿主接受？', 3, 3, 'decision'],
    ['reject', '拒绝 / 异常：onReject\n保留宿主原 value', 3, 4],
    ['project', '宿主更新业务 value\nadapter.toFrameSnapshot', 4, 3],
    ['replace', 'runtime.replace → 重绘\n撤销重做使用宿主外部 history', 4, 2],
    ['camera', '平移 / 缩放 / fit / 选择\n仅内存变化，不进入保存队列', 1, 0],
  ],
  edges: [
    ['start', 'command'],
    ['start', 'camera', '视图操作', 'right', 'left'],
    ['command', 'gate'],
    ['gate', 'deny', '否'],
    ['gate', 'mode', '是', 'right', 'left'],
    ['mode', 'candidate', '标准', 'top', 'left'],
    ['mode', 'local', '宿主', 'bottom', 'left'],
    ['candidate', 'valid', '', 'right', 'left'],
    ['valid', 'deny', '否', 'bottom', 'right'],
    ['valid', 'commit', '是', 'top', 'bottom'],
    ['commit', 'change', '', 'right', 'left'],
    ['change', 'history', '用户撤销/重做'],
    ['history', 'change', '发布变化', 'right', 'right'],
    ['local', 'accept', '', 'right', 'left'],
    ['local', 'reject', '校验失败'],
    ['accept', 'reject', '否'],
    ['accept', 'project', '是', 'right', 'left'],
    ['project', 'replace', '', 'top', 'bottom'],
  ],
};
const saveFlow = {
  prefix: 'demo:save',
  nodes: [
    ['start', '文档变化', 0, 0, 'start'],
    ['queue', '保存最新快照，递增 seq\n400ms 合并 / 显式 flush', 1, 0],
    ['channel', '适配器串行存储通道\n校验工作区，按 Frame 拆分', 2, 0],
    ['same', '全部未变？', 3, 0, 'decision'],
    ['reuse', '复用已有记录 key\n无需重新写入', 3, 1],
    [
      'write',
      '复用未变记录，写变化 Frame\nverd-frame v1 不可变记录\n逐条读回新记录',
      2,
      1,
    ],
    ['verify', '读回一致？', 2, 2, 'decision'],
    ['manifest', '写 main_board_content\nverd-workspace v2：唯一提交点', 3, 2],
    [
      'saved',
      '更新 committedSeq / lastSavedAt\n报告 saved · 回收未引用记录',
      3,
      3,
    ],
    ['newer', '有更新 seq？', 2, 3, 'decision'],
    ['done', '保存完成\nflush 已覆盖调用时最新序号', 1, 3],
    ['fail', '提交前失败：清单不变\n报告 error，保留待保存快照', 0, 2],
    ['retry', '用户重试 flush', 0, 1],
    ['gc', 'GC 失败只记维护错误\n已提交保存仍成功', 3, 4],
  ],
  edges: [
    ['start', 'queue', '', 'right', 'left'],
    ['queue', 'channel', '', 'right', 'left'],
    ['channel', 'same', '', 'right', 'left'],
    ['same', 'reuse', '是'],
    ['same', 'write', '否', 'bottom', 'right'],
    ['write', 'verify'],
    ['reuse', 'manifest'],
    ['verify', 'manifest', '是', 'right', 'left'],
    ['verify', 'fail', '否', 'left', 'right'],
    ['channel', 'fail', '写入失败', 'bottom', 'top'],
    ['manifest', 'fail', '清单写失败', 'left', 'bottom'],
    ['fail', 'retry', '', 'top', 'bottom'],
    ['retry', 'channel', '重试', 'top', 'top'],
    ['manifest', 'saved'],
    ['saved', 'newer', '', 'left', 'right'],
    ['newer', 'channel', '是', 'top', 'bottom'],
    ['newer', 'done', '否', 'left', 'right'],
    ['saved', 'gc', '维护异常'],
  ],
};
const closeFlow = {
  prefix: 'demo:close',
  offsetY: 1050,
  nodes: [
    ['start', '关闭 / 离开页面', 0, 0, 'start'],
    ['request', 'Desktop 主进程阻止关闭\nflush-request → preload', 1, 0],
    ['editor', 'blur 提交编辑内容\n下一事件循环冻结编辑', 2, 0],
    ['flush', '等待同一保存队列 flush\n覆盖最新序号', 3, 0],
    ['ok', 'flush 成功？', 3, 1, 'decision'],
    ['exit', 'flush-result ok\n允许 close / quit', 3, 2],
    [
      'failure',
      'flush-result error · 恢复编辑\n窗口保持打开，显示失败原因',
      2,
      1,
    ],
    ['choice', '用户选择？', 1, 1, 'decision'],
    ['continue', '继续编辑\n保留未保存的工作区', 1, 2],
    ['web', 'Web：hidden / beforeunload\n尽力 flush，无法等待确认关闭', 0, 2],
  ],
  edges: [
    ['start', 'request', '', 'right', 'left'],
    ['request', 'editor', '', 'right', 'left'],
    ['editor', 'flush', '', 'right', 'left'],
    ['flush', 'ok'],
    ['ok', 'exit', '是'],
    ['ok', 'failure', '否', 'left', 'right'],
    ['failure', 'choice', '', 'left', 'right'],
    ['choice', 'request', '重试关闭', 'top', 'bottom'],
    ['choice', 'continue', '继续编辑'],
    ['start', 'web', 'Web 离页事件', 'left', 'left'],
  ],
};
const importFlow = {
  prefix: 'demo:import',
  nodes: [
    ['start', '文件 / 文本入口', 0, 0, 'start'],
    ['format', '输入格式？', 1, 0, 'decision'],
    ['json', '原生 JSON → FrameSnapshot\n旧 JSON → 私有迁移解析器', 2, 0],
    ['markdown', 'Markdown 标题 / 列表\n→ Mind 主题树', 2, 1],
    ['mermaid', 'Mermaid 按 scene 解析\n→ 白板 / 流程 / 架构', 2, 2],
    ['validate', '物化旧位置并校验\n文本：200ms → 只读预览', 3, 1],
    ['action', '选择操作？', 3, 2, 'decision'],
    ['open', '打开：替换当前 Frame\n可撤销事务 → fit', 4, 2],
    ['scene', '场景相同？', 3, 3, 'decision'],
    ['members', '同场景：插入成员', 4, 3],
    ['nested', '不同场景：嵌套整个 Frame', 4, 4],
    ['paste', 'planCellPaste 重映射 ID\n单事务插入 → fit → 自动保存', 3, 4],
    ['error', '解析 / 校验 / 事务失败\n提示错误并保留原文档', 0, 2],
  ],
  edges: [
    ['start', 'format', '', 'right', 'left'],
    ['format', 'json', 'JSON', 'right', 'left'],
    ['format', 'markdown', 'Markdown', 'bottom', 'left'],
    ['format', 'mermaid', 'Mermaid', 'bottom', 'left'],
    ['json', 'validate', '', 'right', 'top'],
    ['markdown', 'validate', '', 'right', 'left'],
    ['mermaid', 'validate', '', 'right', 'bottom'],
    ['format', 'error', '不支持'],
    ['validate', 'error', '失败', 'left', 'right'],
    ['validate', 'action'],
    ['action', 'open', '打开文件', 'right', 'left'],
    ['action', 'scene', '确认导入'],
    ['scene', 'members', '是', 'right', 'left'],
    ['scene', 'nested', '否', 'bottom', 'left'],
    ['members', 'paste', '', 'bottom', 'right'],
    ['nested', 'paste', '', 'left', 'right'],
    ['paste', 'error', '失败', 'left', 'bottom'],
    ['open', 'error', '失败', 'top', 'top'],
  ],
};
const exportFlow = {
  prefix: 'demo:export',
  offsetY: 1030,
  nodes: [
    ['start', '导出当前挂载 Frame', 0, 0, 'start'],
    ['tree', '复制当前 Frame 完整子树\n排除相机、历史与选择', 1, 0],
    ['format', '导出格式？', 2, 0, 'decision'],
    ['json', 'JSON：完整 Frame 子树\n可重新打开与编辑', 3, 0],
    ['md', 'Markdown：文本树\n不保留 ID、样式、主题与布局', 3, 1],
    ['mmd', 'Mermaid：按场景序列化\n领域元数据保留 ID / 坐标 / 端口', 2, 2],
    ['image', '图像：临时画布渲染\nPNG / JPEG / SVG', 1, 2],
    ['download', '下载结果文件', 3, 3],
    ['reject', '格式无法表达：提示错误\n白板自由端点 / 嵌套 Frame 等', 1, 3],
  ],
  edges: [
    ['start', 'tree', '', 'right', 'left'],
    ['tree', 'format', '', 'right', 'left'],
    ['format', 'json', 'JSON', 'right', 'left'],
    ['format', 'md', 'Markdown', 'bottom', 'left'],
    ['format', 'mmd', 'Mermaid'],
    ['format', 'image', '图像', 'bottom', 'top'],
    ['json', 'download', '', 'right', 'right'],
    ['md', 'download', '', 'right', 'right'],
    ['mmd', 'download', '', 'right', 'left'],
    ['image', 'download', '', 'bottom', 'left'],
    ['mmd', 'reject', '不支持', 'left', 'right'],
  ],
};
function workflowRecord(topic, flows) {
  const cells = [];
  for (const flow of flows) {
    const ids = flow.nodes.map(([key]) => flow.prefix + '/' + key);
    flow.nodes.forEach(([key, label, column, row, kind]) => {
      const id = flow.prefix + '/' + key;
      const decision = kind === 'decision',
        start = kind === 'start';
      cells.push({
        id,
        kind: start
          ? 'workflow-start'
          : decision
            ? 'workflow-decision'
            : 'workflow-task',
        cellType: 'node',
        geometry: {
          x: column * 400 + (decision ? 30 : 0),
          y: (flow.offsetY ?? 0) + row * 180,
          width: decision ? 300 : 360,
          height: decision ? 132 : 106,
          derived: false,
          outline: start ? 'terminal' : decision ? 'diamond' : 'roundRectangle',
        },
        ports: ports(start),
        content: content(id, label, 20, start ? '#ffffff' : '#1e293b', start),
        appearance: {
          fill: start
            ? '#0f766e'
            : decision
              ? '#fffbeb'
              : ['fail', 'error', 'reject', 'failure'].includes(key)
                ? '#fff1f2'
                : '#f0fdfa',
          strokeColor: start ? '#0f766e' : decision ? '#d97706' : '#94a3b8',
          strokeWidth: 1.5,
        },
        ...(start
          ? {
              data: {
                graphMode: 'process',
                origin: [column * 400, flow.offsetY ?? 0],
                memberIds: ids,
              },
            }
          : {}),
      });
    });
    cells.push(
      ...flow.edges.map(
        ([source, target, label, from = 'bottom', to = 'top'], i) => ({
          id: flow.prefix + '/edge/' + i,
          kind: 'workflow-edge',
          cellType: 'edge',
          source: { cellId: flow.prefix + '/' + source, portId: from },
          target: { cellId: flow.prefix + '/' + target, portId: to },
          route: { mode: 'orthogonal' },
          ...(label ? { labels: [{ text: label, position: 0.5 }] } : {}),
          appearance: {
            strokeColor:
              label === '失败' || label === '否' ? '#be123c' : '#64748b',
            strokeWidth: 1.5,
          },
        }),
      ),
    );
  }
  return record(topic, cells);
}
function homeNode(
  id,
  label,
  x,
  y,
  width,
  height,
  size,
  color,
  fill = 'none',
  bold = false,
) {
  return {
    id,
    kind: 'geometry',
    cellType: 'node',
    geometry: {
      x,
      y,
      width,
      height,
      outline: fill === 'none' ? 'text' : 'roundRectangle',
      derived: false,
    },
    content: content(id, label, size, color, bold),
    appearance: {
      fill,
      strokeColor: fill === 'none' ? 'none' : '#cbd5e1',
      strokeWidth: 1,
    },
    ports: ports(),
  };
}
export function createHome() {
  const cells = [
    homeNode(
      'r:title',
      '青编 VerdBoard · 项目导览',
      0,
      0,
      2960,
      92,
      56,
      '#0f766e',
      'none',
      true,
    ),
    homeNode(
      'r:sub',
      '一体化白板 · 本地优先 · Web / Desktop · 演示文档 ' + DEMO_DATE,
      0,
      104,
      2960,
      54,
      28,
      '#64748b',
    ),
    homeNode(
      'demo:home/intro',
      '用同一块画布组织想法、流程与系统结构。下面的专题也是原生图表，可继续编辑。',
      0,
      172,
      2960,
      68,
      32,
      '#334155',
    ),
    homeNode(
      'demo:home/guide',
      '阅读方法：放大查看总览 → 选中图框点「打开」进入详情 → 左上角返回定位原外壳。\n依赖箭头指向被依赖包；省略可经其他节点到达的冗余直接边。流程按箭头阅读。',
      0,
      402,
      2960,
      108,
      26,
      '#475569',
    ),
  ];
  [
    [
      'whiteboard',
      '自由白板\n形状、富文本、连线、表格、组合与排列',
      '#f0fdfa',
      '#0f766e',
    ],
    [
      'mind',
      '思维导图\n主题树、布局、概要、折叠、媒体与笔记',
      '#eff6ff',
      '#2563eb',
    ],
    [
      'workflow',
      '流程图\n稳定成员与端口、DAG / process、显式排列',
      '#f5f3ff',
      '#7c3aed',
    ],
    [
      'architecture',
      '架构图\n分层、模块归属、依赖连线与正交路由',
      '#fffbeb',
      '#b45309',
    ],
  ].forEach(([key, label, fill, color], i) =>
    cells.push(
      homeNode(
        'demo:home/capability/' + key,
        label,
        i * 760,
        270,
        680,
        108,
        27,
        color,
        fill,
        true,
      ),
    ),
  );
  const placements = TOPICS.map((t, i) => {
    const x = (i % 4) * 760,
      y = 630 + Math.floor(i / 4) * 750;
    cells.push(
      homeNode(
        'demo:home/title/' + i,
        t.title,
        x,
        y - 114,
        680,
        58,
        34,
        COLORS[i % COLORS.length],
        'none',
        true,
      ),
      homeNode(
        'demo:home/summary/' + i,
        t.summary,
        x,
        y - 52,
        680,
        42,
        21,
        '#64748b',
      ),
    );
    return { id: t.id, x, y, width: 680, height: 470 };
  });
  return { cells, placements };
}
export function mermaidReference(model, comment) {
  const aliases = new Map(
    model.layers.flatMap((l) => l.nodes).map((n, i) => [n.id, 'n' + i]),
  );
  const escape = (s) =>
    s
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('\n', '<br/>');
  const lines = [
    '%% Generated by generate.mjs; edit documents.mjs instead.',
    '%% ' + comment,
    'flowchart TB',
  ];
  model.layers.forEach((l, i) => {
    lines.push('  subgraph layer' + i + '["' + escape(l.label) + '"]');
    l.nodes.forEach((n) =>
      lines.push('    ' + aliases.get(n.id) + '["' + escape(n.label) + '"]'),
    );
    lines.push('  end');
  });
  model.edges.forEach(([source, target, label]) =>
    lines.push(
      '  ' +
        aliases.get(source) +
        ' -->' +
        (label ? '|' + escape(label) + '|' : '') +
        ' ' +
        aliases.get(target),
    ),
  );
  return lines.join('\n') + '\n';
}
export function createDemoDocuments(manifests) {
  const packages = packageArchitecture(manifests);
  return {
    records: [
      architectureRecord(TOPICS[0], packages, 'demo:packages'),
      architectureRecord(TOPICS[1], runtimeArchitecture, 'demo:runtime'),
      mindRecord(
        TOPICS[2],
        modelTree,
        'demo:model',
        'Cell / Frame 核心模型',
        '源码：packages/engine/core/src/cell/types.ts、index.ts、runtime.ts、validation.ts。\n持久化：packages/product/app/src/frames/workspace-storage.ts。\n嵌套和 detached 是不同的所有权关系，均按 Frame 独立存储。',
      ),
      workflowRecord(TOPICS[3], [loadFlow]),
      workflowRecord(TOPICS[4], [editFlow]),
      workflowRecord(TOPICS[5], [saveFlow, closeFlow]),
      workflowRecord(TOPICS[6], [importFlow, exportFlow]),
      mindRecord(
        TOPICS[7],
        developmentTree,
        'demo:development',
        '开发 → 验收 → 发布',
        '命令真值：根 package.json；规范入口：doc/development/README.md、doc/packages/README.md。\n源码索引：doc/guides/配置与源码索引.md。\n不要通过 demo 日期或固定测试数量推断项目已验收。',
      ),
    ],
    home: createHome(),
    references: {
      'layered.mmd': mermaidReference(
        packages,
        '箭头指向被依赖包；省略冗余传递边。',
      ),
      'data-flow.mmd': mermaidReference(
        runtimeArchitecture,
        '运行时协作关系；事务和保存顺序见 demo 流程专题。',
      ),
    },
  };
}
