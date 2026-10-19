// Display metadata only. Each scene owns its entries; identical bindings in
// different scenes are intentional. Keyboard dispatch stays with the editors.
export type ShortcutLocale = 'zh' | 'en';
export type ShortcutScene =
  | 'whiteboard'
  | 'mind'
  | 'workflow'
  | 'architecture'
  | 'uml-class'
  | 'uml-sequence'
  | 'document'
  | 'presentation';
export type ShortcutCategory = 'common' | ShortcutScene;
export type ShortcutPlatform = 'mac' | 'other';
type LocalizedText = Record<ShortcutLocale, string>;

export interface ShortcutDefinition {
  id: string;
  label: LocalizedText;
  keys: readonly (readonly string[])[];
  condition?: LocalizedText;
}

const entry = (
  id: string,
  zh: string,
  en: string,
  keys: ShortcutDefinition['keys'],
  condition?: [string, string],
): ShortcutDefinition => ({
  id,
  label: { zh, en },
  keys,
  condition: condition ? { zh: condition[0], en: condition[1] } : undefined,
});

export const shortcutLabels = {
  zh: {
    title: '快捷键',
    close: '关闭快捷键帮助',
    search: '搜索操作、按键或使用条件',
    categories: '快捷键分类',
    all: '全部',
    allHint:
      '快捷键按使用场景分组，在对应界面获得焦点时生效；只读内容不执行编辑操作。',
    empty: '没有找到匹配的快捷键',
    noSpecific: '此画布暂无专属快捷键，可使用下方通用画布操作。',
    canvasHint: '画布快捷键在画布获得焦点时生效；文本输入时使用编辑器操作。',
    documentHint:
      '文档快捷键在正文编辑器获得焦点时生效；只读文档不执行编辑操作。',
    presentationHint: '演示快捷键在演示画面获得焦点时生效。',
    or: '或',
  },
  en: {
    title: 'Keyboard shortcuts',
    close: 'Close keyboard shortcuts',
    search: 'Search actions, keys or conditions',
    categories: 'Shortcut categories',
    all: 'All',
    allHint:
      'Shortcuts are grouped by context and work when that surface has focus. Editing commands are unavailable in read-only content.',
    empty: 'No matching shortcuts',
    noSpecific:
      'This canvas has no dedicated shortcuts yet. Use the common canvas actions below.',
    canvasHint:
      'Canvas shortcuts work when the canvas has focus. While typing, use the text editor commands.',
    documentHint:
      'Document shortcuts work in the body editor. Editing commands are unavailable in read-only documents.',
    presentationHint:
      'Presentation shortcuts work when the presentation has focus.',
    or: 'or',
  },
};

export const shortcutCategoryLabels: Record<ShortcutCategory, LocalizedText> = {
  common: { zh: '通用画布操作', en: 'Common canvas actions' },
  whiteboard: { zh: '白板', en: 'Whiteboard' },
  mind: { zh: '脑图', en: 'Mind map' },
  workflow: { zh: '流程图', en: 'Workflow' },
  architecture: { zh: '架构图', en: 'Architecture' },
  'uml-class': { zh: 'UML 类图', en: 'UML Class Diagram' },
  'uml-sequence': { zh: 'UML 时序图', en: 'UML Sequence Diagram' },
  document: { zh: '文字文档', en: 'Document' },
  presentation: { zh: '演示', en: 'Presentation' },
};

const selected: [string, string] = ['选中对象时', 'With objects selected'];
const topic: [string, string] = [
  '选中脑图主题时，白板中的脑图同样适用',
  'With a mind topic selected, including topics on a whiteboard',
];
const child: [string, string] = [
  '选中脑图子主题时',
  'With a child mind topic selected',
];

export const shortcutCatalog: Record<
  ShortcutCategory,
  readonly ShortcutDefinition[]
> = {
  common: [
    entry('select', '选择工具', 'Selection tool', [['V']]),
    entry('hand', '手形工具', 'Hand tool', [['H']]),
    entry(
      'pan',
      '临时平移画布',
      'Temporarily pan the canvas',
      [['Space']],
      ['按住空格并拖动', 'Hold Space and drag'],
    ),
    entry('all', '全选当前容器', 'Select all in the current container', [
      ['Mod', 'A'],
    ]),
    entry('copy', '复制', 'Copy', [['Mod', 'C']], selected),
    entry('cut', '剪切', 'Cut', [['Mod', 'X']], selected),
    entry('paste', '粘贴', 'Paste', [['Mod', 'V']]),
    entry('duplicate', '复制副本', 'Duplicate', [['Mod', 'D']], selected),
    entry(
      'delete',
      '删除选中对象',
      'Delete selected objects',
      [['Delete'], ['Backspace']],
      selected,
    ),
    entry(
      'group',
      '组合',
      'Group',
      [['Mod', 'G']],
      ['选中可组合对象时', 'With groupable objects selected'],
    ),
    entry(
      'ungroup',
      '取消组合',
      'Ungroup',
      [['Mod', 'Shift', 'G']],
      ['选中组合时', 'With a group selected'],
    ),
    entry('undo', '撤销', 'Undo', [['Mod', 'Z']]),
    entry('redo', '重做', 'Redo', [['Mod', 'Shift', 'Z']]),
    entry('zoom-in', '放大', 'Zoom in', [
      ['Mod', '='],
      ['Mod', '+'],
    ]),
    entry('zoom-out', '缩小', 'Zoom out', [['Mod', '-']]),
    entry('zoom-reset', '缩放至 100%', 'Zoom to 100%', [['Mod', '0']]),
    entry('fit', '适应画布内容', 'Fit canvas content', [['Mod', 'Shift', '+']]),
    entry('image', '导入图片', 'Import image', [['Mod', 'U']]),
    entry('export', '导出画布文件', 'Export canvas file', [['Mod', 'S']]),
    entry('export-image', '导出图像', 'Export image', [['Mod', 'Shift', 'E']]),
    entry(
      'clear',
      '清空当前容器',
      'Clear current container',
      [
        ['Mod', 'Delete'],
        ['Mod', 'Backspace'],
      ],
      ['打开确认窗口', 'Opens a confirmation dialog'],
    ),
    entry(
      'escape',
      '取消操作或退出当前层级',
      'Cancel or leave the current level',
      [['Escape']],
    ),
  ],
  whiteboard: [
    entry('mind', '脑图工具', 'Mind map tool', [['M']]),
    entry('pen', '画笔', 'Pen', [['P']]),
    entry('erase', '橡皮擦', 'Eraser', [['E']]),
    entry(
      'arrow',
      '箭头工具',
      'Arrow tool',
      [['A']],
      ['未选中对象时', 'With no objects selected'],
    ),
    entry('rectangle', '矩形', 'Rectangle', [['R']]),
    entry('ellipse', '椭圆', 'Ellipse', [['O']]),
    entry('text', '文字工具', 'Text tool', [['T']]),
    entry('forward', '上移一层', 'Bring forward', [['Mod', ']']], selected),
    entry('backward', '下移一层', 'Send backward', [['Mod', '[']], selected),
    entry(
      'front',
      '置于顶层',
      'Bring to front',
      [
        ['Mod', 'Shift', ']'],
        ['Mod', 'Alt', ']'],
      ],
      selected,
    ),
    entry(
      'back',
      '置于底层',
      'Send to back',
      [
        ['Mod', 'Shift', '['],
        ['Mod', 'Alt', '['],
      ],
      selected,
    ),
    entry(
      'finish',
      '完成折线绘制',
      'Finish polyline',
      [['Enter']],
      ['正在绘制折线时', 'While drawing a polyline'],
    ),
  ],
  mind: [
    entry('child', '添加子主题', 'Add child topic', [['Tab']], topic),
    entry('sibling', '添加同级主题', 'Add sibling topic', [['Enter']], child),
    entry(
      'type',
      '直接编辑主题文字',
      'Type to edit the topic',
      [['Character']],
      [
        '选中主题时，避开当前画布的工具快捷键',
        'With a topic selected, except active canvas tool shortcuts',
      ],
    ),
    entry(
      'collapse',
      '展开或收起分支',
      'Expand or collapse branch',
      [['/'], ['Mod', '/']],
      child,
    ),
    entry(
      'note',
      '打开主题笔记',
      'Open topic note',
      [['Mod', 'Shift', 'N']],
      topic,
    ),
  ],
  workflow: [],
  architecture: [],
  'uml-class': [],
  'uml-sequence': [],
  document: [
    entry('undo', '撤销', 'Undo', [['Mod', 'Z']]),
    entry('redo', '重做', 'Redo', [
      ['Mod', 'Shift', 'Z'],
      ['Ctrl', 'Y'],
    ]),
    entry('copy', '复制文字', 'Copy text', [['Mod', 'C']]),
    entry('cut', '剪切文字', 'Cut text', [['Mod', 'X']]),
    entry('paste', '粘贴文字', 'Paste text', [['Mod', 'V']]),
    entry('find', '查找', 'Find', [['Mod', 'F']]),
    entry('replace', '替换', 'Replace', [['Mod', 'Shift', 'H']]),
    entry(
      'find-next',
      '下一个匹配项',
      'Next match',
      [['Enter']],
      ['查找框中', 'In the find field'],
    ),
    entry(
      'find-previous',
      '上一个匹配项',
      'Previous match',
      [['Shift', 'Enter']],
      ['查找框中', 'In the find field'],
    ),
    entry('bold', '加粗', 'Bold', [['Mod', 'B']]),
    entry('italic', '斜体', 'Italic', [['Mod', 'I']]),
    entry('underline', '下划线', 'Underline', [['Mod', 'U']]),
    entry('strike', '删除线', 'Strikethrough', [['Mod', 'Shift', 'S']]),
    entry('code', '行内代码', 'Inline code', [['Mod', 'E']]),
    ...[1, 2, 3, 4, 5, 6].map((level) =>
      entry(`heading-${level}`, `${level} 级标题`, `Heading ${level}`, [
        ['Mod', 'Alt', String(level)],
      ]),
    ),
    entry('paragraph', '正文段落', 'Paragraph', [['Mod', 'Alt', '0']]),
    entry('bullet', '无序列表', 'Bullet list', [['Mod', 'Shift', '8']]),
    entry('ordered', '有序列表', 'Numbered list', [['Mod', 'Shift', '7']]),
    entry('code-block', '代码块', 'Code block', [['Mod', 'Alt', 'C']]),
    entry('left', '左对齐', 'Align left', [['Mod', 'Shift', 'L']]),
    entry('center', '居中对齐', 'Align center', [['Mod', 'Shift', 'E']]),
    entry('right', '右对齐', 'Align right', [['Mod', 'Shift', 'R']]),
    entry('justify', '两端对齐', 'Justify', [['Mod', 'Shift', 'J']]),
    entry('break', '软换行', 'Line break', [
      ['Shift', 'Enter'],
      ['Mod', 'Enter'],
    ]),
    entry(
      'list-indent',
      '增加列表缩进',
      'Indent list item',
      [['Tab']],
      ['列表项中', 'In a list item'],
    ),
    entry(
      'list-outdent',
      '减少列表缩进',
      'Outdent list item',
      [['Shift', 'Tab']],
      ['列表项中', 'In a list item'],
    ),
    entry(
      'table-next',
      '下一个单元格',
      'Next table cell',
      [['Tab']],
      ['表格内；末尾会新增一行', 'In a table; adds a row at the end'],
    ),
    entry(
      'table-previous',
      '上一个单元格',
      'Previous table cell',
      [['Shift', 'Tab']],
      ['表格内', 'In a table'],
    ),
    entry(
      'escape',
      '关闭查找或当前弹出面板',
      'Close find or the current popup',
      [['Escape']],
    ),
  ],
  presentation: [
    entry('next', '下一步', 'Next step', [
      ['ArrowRight'],
      ['ArrowDown'],
      ['PageDown'],
      ['Enter'],
    ]),
    entry('previous', '上一步', 'Previous step', [
      ['ArrowLeft'],
      ['ArrowUp'],
      ['PageUp'],
    ]),
    entry('overview', '返回总览', 'Return to overview', [['0'], ['Home']]),
    entry('laser', '切换激光笔', 'Toggle laser pointer', [['L']]),
    entry(
      'pan',
      '临时平移画面',
      'Temporarily pan the view',
      [['Space']],
      ['按住空格并拖动', 'Hold Space and drag'],
    ),
    entry('toolbar', '切换工具栏按钮', 'Navigate toolbar buttons', [
      ['Tab'],
      ['Shift', 'Tab'],
    ]),
    entry(
      'exit',
      '退出演示',
      'Exit presentation',
      [['Escape']],
      ['帮助打开时，先关闭帮助', 'Closes help first when help is open'],
    ),
  ],
};

export function shortcutKeyLabel(
  key: string,
  platform: ShortcutPlatform,
  locale: ShortcutLocale,
): string {
  if (key === 'Mod') return platform === 'mac' ? 'Cmd' : 'Ctrl';
  if (key === 'Alt') return platform === 'mac' ? 'Option' : 'Alt';
  if (key === 'Space') return locale === 'zh' ? '空格' : 'Space';
  if (key === 'Character') return locale === 'zh' ? '文字键' : 'Character';
  return (
    {
      Escape: 'Esc',
      ArrowRight: '→',
      ArrowLeft: '←',
      ArrowUp: '↑',
      ArrowDown: '↓',
    }[key] ?? key
  );
}

export function shortcutGroups(
  scene: ShortcutScene | 'all',
): ShortcutCategory[] {
  if (scene === 'all')
    return [
      'common',
      'whiteboard',
      'mind',
      'workflow',
      'architecture',
      'document',
      'presentation',
    ];
  return scene === 'document' || scene === 'presentation'
    ? [scene]
    : [scene, 'common'];
}

export function matchesShortcut(
  item: ShortcutDefinition,
  query: string,
  platform: ShortcutPlatform,
  locale: ShortcutLocale,
): boolean {
  const searchable = [
    item.label[locale],
    item.condition?.[locale] ?? '',
    ...item.keys.map((keys) =>
      keys.map((key) => shortcutKeyLabel(key, platform, locale)).join('+'),
    ),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => searchable.includes(word));
}
