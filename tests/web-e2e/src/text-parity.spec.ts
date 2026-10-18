import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  createCellStore,
  createFrameCell,
  type FrameSnapshot,
  type NodeCell,
  type FrameCell,
} from '../../../packages/engine/core/src/cell/types';
import { applyCellOperations } from '../../../packages/engine/core/src/cell/index';
import {
  createBlockText,
  createInlineText,
  Alignment,
  type BoardTextDocument,
} from '../../../packages/engine/common/src/public-api';
import {
  createMindFrameSnapshot,
  createMindChildCell,
  addMindChild,
} from '../../../packages/engine/mind/src/cell-commands';
import {
  createWorkflowFrameSnapshot,
  createWorkflowTaskCell,
  addWorkflowTask,
} from '../../../packages/engine/workflow/src/cell-commands';
import {
  createArchitectureFrameSnapshot,
  createArchitectureModuleCell,
  addArchitectureModule,
} from '../../../packages/engine/architecture/src/cell-commands';
import {
  createTableCell,
  createGeometryCell,
} from '../../../packages/engine/draw/src/cell-commands';
import { createSwimlaneCell } from '../../../packages/engine/draw/src/cell-table';
import {
  clearWorkspaceStorage,
  persistedWorkspace,
  waitForWorkspacePersisted,
} from './workspace-nav';

test.use({ actionTimeout: 6000 });

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const cell = (page: Page, id: string) =>
  canvas(page).locator(`[data-cell-id="${id}"]`);
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
});
const blocks = (): BoardTextDocument => ({
  ...createBlockText('标题\n\n长内容\n列表\n引用\n代码\n表格'),
  align: Alignment.left,
  content: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '标题 Heading' }],
      },
      paragraph(''),
      paragraph(
        '中文长内容与 LongEnglishWordWithoutSpacesThatMustWrap 一起换行',
      ),
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [paragraph('列表 Item')] }],
      },
      { type: 'blockquote', content: [paragraph('引用 Quote')] },
      {
        type: 'codeBlock',
        content: [{ type: 'text', text: 'const n = 1;\nnext();' }],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', content: [paragraph('表格 Cell')] }],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'End' }, { type: 'hardBreak' }],
      },
    ],
  },
});
const formatted = (): BoardTextDocument => ({
  ...createInlineText(
    '混合字号 Styled longEnglishWordWithoutSpacesThatMustWrap',
  ),
  align: Alignment.right,
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '混合字号 ', marks: [{ type: 'bold' }] },
          {
            type: 'text',
            text: 'Styled',
            marks: [
              { type: 'italic' },
              { type: 'underline' },
              {
                type: 'textStyle',
                attrs: {
                  fontSize: '24px',
                  fontFamily: 'Georgia',
                  color: '#ff0000',
                },
              },
              { type: 'highlight', attrs: { color: '#ffff00' } },
            ],
          },
          { type: 'text', text: ' longEnglishWordWithoutSpacesThatMustWrap' },
        ],
      },
    ],
  },
});
const node = (
  id: string,
  x: number,
  y: number,
  text?: BoardTextDocument,
): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x, y, width: 240, height: 150, outline: 'rectangle' },
  content: {
    label: text?.plainText ?? '纯文本 Plain label',
    ...(text ? { text } : {}),
  },
});
const drawingFixture = (): FrameSnapshot => {
  const root = createFrameCell('root');
  const store = createCellStore(root);
  const table = createTableCell(
    'table',
    [
      [20, 240],
      [270, 610],
    ],
    1,
    1,
  );
  table.data!.cells[0].text = blocks();
  const lane = createSwimlaneCell(
    'lane',
    [
      [310, 250],
      [580, 610],
    ],
    'horizontal',
    true,
    1,
  );
  const nodes = [
    node('plain', 20, 20),
    node('mixed', 310, 20, formatted()),
    node('blocks', 620, 20, blocks()),
    table,
    lane,
    createGeometryCell('text', 'text', [
      [650, 650],
      [890, 730],
    ]),
    {
      ...node('overflow', 620, 540, blocks()),
      geometry: {
        x: 620,
        y: 540,
        width: 240,
        height: 80,
        outline: 'rectangle',
      },
    },
  ];
  nodes[2].geometry.height = 400;
  nodes[1].geometry.rotation = Math.PI / 8;
  for (const item of nodes) {
    root.children.push(item.id);
    store.cells[item.id] = item;
  }
  root.children.push('edge');
  store.cells.edge = {
    id: 'edge',
    kind: 'arrow',
    cellType: 'edge',
    source: { point: [650, 500] },
    target: { point: [900, 500] },
    route: { mode: 'straight' },
    labels: [{ text: '纯文本 Edge' }],
  };
  return { store };
};
const open = async (page: Page, snapshot: FrameSnapshot) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  await waitForWorkspacePersisted(page);
  await page.evaluate(async (snapshot) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('VerdBoard');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('verdboard_store', 'readwrite'),
        saved = transaction.objectStore('verdboard_store');
      saved.clear();
      const frames: Record<string, string> = {};
      for (const cell of Object.values(snapshot.store.cells))
        if (cell.cellType === 'frame') {
          const frame = cell as FrameCell,
            key = `frames/${frame.id}/fixture`;
          frames[frame.id] = key;
          const cells = Object.fromEntries(
            [...frame.children, ...frame.groups]
              .map((id) => [id, snapshot.store.cells[id]])
              .filter(([, cell]) => (cell as any).cellType !== 'frame'),
          );
          saved.put({ format: 'verd-frame', version: 1, frame, cells }, key);
        }
      saved.put(
        {
          format: 'verd-workspace',
          version: 2,
          rootId: snapshot.store.rootId,
          frames,
          detachedFrameIds: [],
        },
        'main_board_content',
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, snapshot);
  await clearWorkspaceStorage(page);
  await page.reload();
  await expect(canvas(page)).toBeVisible();
  // Startup imports the legacy fixture as an undoable command (also in HEAD).
  // Reopen the saved workspace so editor-entry checks start with empty history.
  await expect
    .poll(
      async () =>
        (await persistedWorkspace(page))?.records[snapshot.store.rootId]?.frame
          .id,
    )
    .toBe(snapshot.store.rootId);
  await page.reload();
  await expect(canvas(page)).toBeVisible();
  await expect(
    page
      .getByRole('button', { name: '撤销', exact: true })
      .locator('visible=true'),
  ).toBeDisabled();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
};
// Compare actual glyph ranges as well as empty block boxes, rather than wrappers
// whose equal dimensions can hide different baselines, fonts or line wrapping.
const metrics = (content: Locator) =>
  content.evaluate((element) => {
    const box = (rectangle: DOMRect) => ({
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
    });
    const style = (element: Element) => {
      const computed = getComputedStyle(element);
      return [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'color',
        'lineHeight',
        'textAlign',
        'whiteSpace',
        'overflowWrap',
        'textDecorationLine',
      ].map((key) => computed[key as keyof CSSStyleDeclaration]);
    };
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const glyphs = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const range = document.createRange();
      range.selectNodeContents(text);
      glyphs.push({
        text: text.textContent,
        style: style(text.parentElement!),
        boxes: Array.from(range.getClientRects(), box),
      });
    }
    return {
      glyphs,
      blocks: Array.from(
        element.querySelectorAll(
          'p, h1, h2, h3, blockquote, pre, li, table, td',
        ),
        (block) => ({
          tag: block.tagName,
          box: box(block.getBoundingClientRect()),
        }),
      ),
    };
  });
type Metrics = Awaited<ReturnType<typeof metrics>>;
const sameMetrics = (before: Metrics, after: Metrics) => {
  expect(after.glyphs.map(({ text, style }) => ({ text, style }))).toEqual(
    before.glyphs.map(({ text, style }) => ({ text, style })),
  );
  expect(after.blocks.map(({ tag }) => tag)).toEqual(
    before.blocks.map(({ tag }) => tag),
  );
  const boxes = (value: Metrics) => [
    ...value.glyphs.flatMap(({ boxes }) => boxes),
    ...value.blocks.map(({ box }) => box),
  ];
  const a = boxes(before),
    b = boxes(after);
  expect(b).toHaveLength(a.length);
  a.forEach((box, index) => {
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(
        Math.abs(box[key] - b[index][key]),
        `${index}.${key}`,
      ).toBeLessThanOrEqual(1);
  });
};
const parity = async (
  page: Page,
  scope: Locator,
  enter: () => Promise<void>,
) => {
  const preview = scope
    .locator('[data-frame-rich-text] .board-text-content')
    .first();
  const before = await metrics(preview);
  await enter();
  const editor = scope.locator('[data-frame-text-editor] .ProseMirror');
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  sameMetrics(before, await metrics(editor));
  const toolbar = page.getByRole('toolbar', {
    name: 'Text formatting',
    exact: true,
  });
  await expect(toolbar).toBeVisible();
  expect(
    await toolbar.evaluate((element) => element.closest('svg')),
  ).toBeNull();
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  sameMetrics(before, await metrics(preview));
};

test('all drawing text, block content, labels and rotated table titles keep identical typography and line boxes', async ({
  page,
}) => {
  await open(page, drawingFixture());
  for (const id of ['plain', 'mixed', 'blocks', 'text', 'overflow']) {
    await canvas(page).press('Escape');
    const target = cell(page, id);
    await target.click();
    await parity(page, target, () => target.dblclick());
  }
  const table = cell(page, 'table').locator('[data-table-entry]').first();
  await table.click();
  await parity(page, table, () => table.dblclick());
  const title = cell(page, 'lane').locator('[data-table-role="title"]');
  await title.click();
  await parity(page, title, () => title.dblclick());
  const edge = cell(page, 'edge');
  await edge.locator('[data-edge-label]').click();
  await parity(page, edge, () => edge.locator('[data-edge-label]').dblclick());
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toBeDisabled();
});

test('Mind root, child and note keep their font, color and media text regions in embedded and detail views', async ({
  page,
}) => {
  const snapshot = createMindFrameSnapshot('mind', 'topic');
  snapshot.store = applyCellOperations(
    snapshot.store,
    addMindChild(
      snapshot.store,
      'topic',
      createMindChildCell('child'),
      'branch',
    ),
  );
  const child = snapshot.store.cells.child as NodeCell;
  child.content = { label: formatted().plainText, text: formatted() };
  child.data = {
    ...(child.data as object),
    note: { ...createBlockText('笔记 Note'), align: Alignment.left },
    emojis: [{ name: '🚀' }],
    image: {
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg3sAAAAASUVORK5CYII=',
      width: 64,
      height: 32,
    },
  };
  const root = createFrameCell('root');
  root.children = ['mind'];
  const inner = snapshot.store.cells.mind;
  if (inner.cellType === 'frame')
    inner.geometry = { x: 120, y: 100, width: 650, height: 400 };
  snapshot.store.cells.root = root;
  snapshot.store.rootId = root.id;
  await open(page, snapshot);
  for (const detail of [false, true]) {
    if (detail) {
      await cell(page, 'frame-ref:mind')
        .locator('[data-frame-title-id]')
        .first()
        .click();
      await page.getByTestId('frame-open').locator('visible=true').click();
    }
    for (const id of ['topic', 'child']) {
      const target = cell(page, id);
      const topicText = target
        .locator('foreignObject')
        .filter({ has: page.locator('[data-frame-rich-text]') })
        .last();
      await target.click();
      // The editor is a sibling of the topic foreignObject, while the note editor
      // lives inside its own region. Restrict the preview to the topic itself.
      const before = await metrics(topicText.locator('.board-text-content'));
      // Embedded previews render the same cells but are view-only; the detail
      // canvas is where the shared file is edited.
      if (detail) {
        await target.dblclick();
        const editor = target.locator('[data-frame-text-editor] .ProseMirror');
        await expect(editor).toBeFocused();
        sameMetrics(before, await metrics(editor));
        await editor.press('Escape');
        sameMetrics(
          before,
          await metrics(topicText.locator('.board-text-content')),
        );
      }
    }
    const note = cell(page, 'child').locator('[data-mind-note]');
    if (detail) {
      await parity(page, note, () => note.dblclick());
      await expect(
        page.getByRole('toolbar', { name: 'Text formatting', exact: true }),
      ).toHaveCount(0);
    }
  }
});

test('Mind defaults align left and notes align at the top, preserving explicit blocks and editor controls without empty history', async ({
  page,
}) => {
  const snapshot = createMindFrameSnapshot('mind', 'topic');
  const cases = [
    {
      id: 'default',
      align: undefined,
      blockAlign: undefined,
      expected: 'left',
    },
    {
      id: 'center',
      align: Alignment.center,
      blockAlign: undefined,
      expected: 'center',
    },
    {
      id: 'right',
      align: Alignment.right,
      blockAlign: undefined,
      expected: 'right',
    },
    {
      id: 'paragraph',
      align: Alignment.right,
      blockAlign: 'center',
      expected: 'center',
    },
  ];
  for (const item of cases) {
    snapshot.store = applyCellOperations(
      snapshot.store,
      addMindChild(
        snapshot.store,
        'topic',
        createMindChildCell(item.id),
        `branch-${item.id}`,
      ),
    );
    const child = snapshot.store.cells[item.id] as NodeCell;
    const text = { ...createInlineText(item.id), align: item.align };
    const note = { ...createBlockText('Note'), align: item.align };
    if (item.blockAlign) {
      text.content.content![0].attrs = { textAlign: item.blockAlign };
      note.content.content![0].attrs = { textAlign: item.blockAlign };
    }
    child.content = { label: text.plainText, text };
    child.data = { manualWidth: 160, note };
  }
  const root = createFrameCell('root');
  root.children = ['mind', 'drawing'];
  (snapshot.store.cells.mind as FrameCell).geometry = {
    x: 50,
    y: 100,
    width: 750,
    height: 700,
  };
  snapshot.store.cells.root = root;
  snapshot.store.cells.drawing = node('drawing', 900, 100);
  snapshot.store.rootId = 'root';
  await open(page, snapshot);
  await expect(
    cell(page, 'drawing').locator('[data-frame-rich-text] p'),
  ).toHaveCSS('text-align', 'center');
  for (const detail of [false, true]) {
    if (detail) {
      await cell(page, 'frame-ref:mind')
        .locator('[data-frame-title-id]')
        .first()
        .click();
      await page.getByTestId('frame-open').locator('visible=true').click();
    }
    for (const item of cases) {
      const target = cell(page, item.id);
      const title = target
        .locator('foreignObject')
        .filter({ has: page.locator('[data-frame-rich-text]') })
        .last();
      await expect(title.locator('p')).toHaveCSS('text-align', item.expected);
      const before = await metrics(title.locator('.board-text-content'));
      const note = target.locator('[data-mind-note]');
      await expect(note.locator('[data-frame-rich-text]')).toHaveCSS(
        'align-items',
        'flex-start',
      );
      await expect(note.locator('p')).toHaveCSS('text-align', item.expected);
      // Embedded previews are view-only; editor and inspector assertions run
      // on the detail canvas where the shared file is edited.
      if (!detail) continue;
      await target
        .locator('foreignObject')
        .filter({ has: page.locator('[data-frame-rich-text]') })
        .last()
        .dblclick();
      const editor = target.locator('[data-frame-text-editor] .ProseMirror');
      const inspector = page
        .getByRole('complementary', { name: 'Properties' })
        .locator('visible=true');
      await expect(editor).toBeFocused();
      await expect(editor.locator('p')).toHaveCSS('text-align', item.expected);
      await expect(
        inspector.getByLabel('Text alignment', { exact: true }),
      ).toHaveValue(item.expected);
      sameMetrics(before, await metrics(editor));
      await editor.press('Escape');
      await expect(
        inspector.getByLabel('Selection text alignment'),
      ).toHaveValue(item.expected);
      await parity(page, note, () => note.dblclick());
    }
    await expect(
      page
        .getByRole('button', { name: '撤销', exact: true })
        .locator('visible=true'),
    ).toBeDisabled();
  }
  const target = cell(page, 'default');
  // While editing, both the floating toolbar and the inspector expose a
  // 'Text alignment' select; the toolbar one drives the active text.
  const alignment = () =>
    page
      .getByRole('toolbar', { name: 'Text formatting', exact: true })
      .locator('visible=true')
      .getByLabel('Text alignment', { exact: true });
  await target
    .locator('foreignObject')
    .filter({ has: page.locator('[data-frame-rich-text]') })
    .last()
    .dblclick();
  await alignment().selectOption('center');
  await expect(alignment()).toHaveValue('center');
  await target.locator('[data-frame-text-editor] .ProseMirror').press('Escape');
  await target
    .locator('foreignObject')
    .filter({ has: page.locator('[data-frame-rich-text]') })
    .last()
    .dblclick();
  await expect(alignment()).toHaveValue('center');
  await target.locator('[data-frame-text-editor] .ProseMirror').press('Escape');
  await page
    .getByRole('button', { name: '撤销', exact: true })
    .locator('visible=true')
    .click();
  await expect(
    page.getByLabel('Selection text alignment').locator('visible=true'),
  ).toHaveValue('left');
  await page
    .getByRole('button', { name: '重做', exact: true })
    .locator('visible=true')
    .click();
  // `saved` can precede the redo's write; wait for it to reach storage.
  // Alignment persists as per-block textAlign on the document's paragraphs.
  await expect
    .poll(async () => {
      const data = await persistedWorkspace(page);
      const cell = Object.values(data?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells))
        .find((cell: any) => cell.id === 'default') as any;
      return cell?.content?.text?.content?.content?.[0]?.attrs?.textAlign;
    })
    .toBe('center');
  await page.reload();
  await expect(
    cell(page, 'default').locator('[data-frame-rich-text] p').last(),
  ).toHaveCSS('text-align', 'center');
});

for (const domain of ['workflow', 'architecture'] as const) {
  test(`${domain} nodes share viewing and editing typography`, async ({
    page,
  }) => {
    let snapshot: FrameSnapshot;
    if (domain === 'workflow') {
      snapshot = createWorkflowFrameSnapshot('root', 'start');
      snapshot.store = applyCellOperations(
        snapshot.store,
        addWorkflowTask(
          snapshot.store,
          'start',
          createWorkflowTaskCell('task'),
        ),
      );
    } else {
      snapshot = createArchitectureFrameSnapshot('root', 'layer');
      snapshot.store = applyCellOperations(
        snapshot.store,
        addArchitectureModule(
          snapshot.store,
          'layer',
          createArchitectureModuleCell('task'),
        ),
      );
    }
    const task = snapshot.store.cells.task as NodeCell;
    task.content = {
      label: '领域 Domain',
      text: createInlineText('领域 Domain'),
    };
    await open(page, snapshot);
    const target = cell(page, 'task');
    await target.click();
    await parity(page, target, () => target.dblclick());
  });
}

test('portal formatting retains selection and input, tracks zoom, survives IME Enter, history and reload', async ({
  page,
}) => {
  await open(page, drawingFixture());
  const target = cell(page, 'plain');
  await target.dblclick();
  const editor = target.locator('.ProseMirror');
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+a');
  const toolbar = page.getByRole('toolbar', {
    name: 'Text formatting',
    exact: true,
  });
  const bold = toolbar.getByRole('button', { name: 'Bold', exact: true });
  await bold.focus();
  await bold.press('Enter');
  await expect(editor.locator('strong')).toHaveText('纯文本 Plain label');
  await toolbar
    .getByLabel('Link URL', { exact: true })
    .fill('https://example.com');
  await toolbar
    .getByRole('button', { name: 'Apply link', exact: true })
    .click();
  await expect(editor.locator('a')).toHaveText('纯文本 Plain label');
  // TipTap restores DOM focus in rAF after a toolbar command. Wait for it
  // before sending a key that changes the selection.
  await expect(editor).toBeFocused();
  await editor.press('ArrowRight');
  await expect
    .poll(() => editor.evaluate(() => window.getSelection()?.isCollapsed))
    .toBe(true);
  await editor.press('Z');
  await expect(editor).toContainText('labelZ');
  await editor.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
  });
  await expect(editor).toBeVisible();
  await editor.press('Escape');
  await expect(target).toContainText('labelZ');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(target).toContainText('Plain label');
  await page
    .getByRole('button', { name: '重做', exact: true })
    .locator('visible=true')
    .click();
  await expect(target).toContainText('labelZ');
  // `saved` was already reported for the earlier commit; wait for the redo's
  // write to actually reach storage before reloading.
  await expect
    .poll(async () =>
      JSON.stringify(await persistedWorkspace(page)).includes('labelZ'),
    )
    .toBe(true);
  await page.reload();
  await expect(target).toContainText('labelZ');
  await target.dblclick();
  await expect(editor.locator('a strong, strong a')).toHaveCount(1);
  await canvas(page).evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -80,
        clientX: rect.x + 400,
        clientY: rect.y + 300,
      }),
    );
  });
  const body = target.locator('[data-frame-text-editor]');
  await expect
    .poll(async () => {
      const a = (await body.boundingBox())!,
        b = (await toolbar.boundingBox())!;
      return Math.abs(b.x - Math.max(8, Math.min(a.x, 1440 - b.width - 8)));
    })
    .toBeLessThanOrEqual(1);
});

test('Frame names share glyph metrics, truncation and placeholder geometry at fractional zoom and deep embedding', async ({
  page,
}) => {
  const root = createFrameCell('root'),
    outer = createFrameCell('outer'),
    inner = createFrameCell('inner'),
    deep = createFrameCell('deep');
  root.children = ['outer'];
  outer.geometry = { x: 100, y: 200, width: 380, height: 300 };
  outer.children = ['inner'];
  outer.content = {
    label: 'Outer label',
    text: createInlineText('Outer label'),
  };
  inner.geometry = { x: 80, y: 120, width: 540, height: 300 };
  inner.children = ['deep'];
  const rich = formatted();
  inner.content = { label: rich.plainText, text: rich };
  deep.geometry = { x: 10, y: 100, width: 360, height: 200 };
  deep.children = ['leaf'];
  const leaf = node('leaf', 20, 20);
  leaf.geometry.width = 800;
  leaf.geometry.height = 400;
  await open(page, {
    store: {
      ...createCellStore(root),
      cells: { root, outer, inner, deep, leaf },
    },
  });
  const editorBox = page.locator('[data-frame-title-editor]');
  // Each nested frame is a separate file embedded through a frame-reference;
  // its title is editable where the reference is a top-level cell — on the
  // board for `outer`, then inside each parent's detail canvas.
  for (const [level, id] of [
    [0, 'outer'],
    [1, 'inner'],
    [2, 'deep'],
  ] as const) {
    if (level > 0) {
      await canvas(page)
        .locator(
          `[data-frame-title-id="frame-ref:${['outer', 'inner'][level - 1]}"]`,
        )
        .click();
      await page.getByTestId('frame-open').locator('visible=true').click();
    }
    const refId = `frame-ref:${id}`;
    for (const zoom of [0.6, 1.4]) {
      await canvas(page).evaluate((svg, zoom) => {
        const current = Number(
          svg
            .querySelector('[data-frame-world]')!
            .getAttribute('transform')!
            .match(/scale\(([^)]+)\)/)![1],
        );
        const rect = svg.getBoundingClientRect();
        svg.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            ctrlKey: true,
            deltaY: -Math.log(zoom / current) / 0.01,
            clientX: rect.left + 400,
            clientY: rect.top + 350,
          }),
        );
      }, zoom);
      await expect(
        page.getByTestId('canvas-zoom-label').locator('visible=true'),
      ).toHaveText(`${zoom * 100}%`);
      const title = canvas(page).locator(`[data-frame-title-id="${refId}"]`);
      // Selection color is part of the shared appearance; compare selected view to editing.
      await title.click();
      const preview = title.locator('.board-text-content');
      const before = await metrics(preview);
      const beforeBox = await title.locator('foreignObject').boundingBox();
      await title.dblclick();
      const editor = editorBox.locator('[contenteditable="true"]');
      await expect(editor).toBeFocused();
      await expect(title.locator('foreignObject')).toBeHidden();
      const afterBox = await editorBox.boundingBox();
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(
          Math.abs(beforeBox![key] - afterBox![key]),
          `${id}.${key}`,
        ).toBeLessThanOrEqual(1);
      if (id === 'deep') {
        await expect(editor).toHaveText('');
        sameMetrics(
          before,
          await metrics(
            editorBox.locator('[data-frame-rich-text] .board-text-content'),
          ),
        );
      } else sameMetrics(before, await metrics(editor));
      await expect(
        page.getByRole('toolbar', { name: 'Text formatting', exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await editor.press('Escape');
      await expect(editorBox).toHaveCount(0);
      sameMetrics(before, await metrics(preview));
    }
  }
  await page.reload();
  await expect(
    canvas(page).locator('[data-frame-title-id="frame-ref:deep"]'),
  ).toHaveText('Frame');
  // A restored session has no pending writes; the status resets to idle.
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', 'idle');
});
