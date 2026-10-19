import { editBody } from './body-editor';
import { selectAppAction, setAppLanguage } from './app-actions';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import {
  activateBoardTab,
  backToPreviousCanvas,
  persistedWorkspace,
} from './workspace-nav';
import { expandPropertyGroup } from './property-group';

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const title = (page: Page, id?: string) =>
  canvas(page).locator(
    id ? `[data-frame-title-id="${id}"]` : '[data-frame-title-id]',
  );
const savedCells = async (page: Page) =>
  Object.values((await persistedWorkspace(page))?.records ?? {}).flatMap(
    (record: any) => [...Object.values(record.cells), record.frame],
  );
const openReferenceSource = async (page: Page, referenceId: string) => {
  const tabCount = await page.getByRole('tab').count();
  const shell = canvas(page)
    .locator(`[data-cell-id="${referenceId}"]`)
    .locator(':scope > rect[data-frame-shell]');
  const box = (await shell.boundingBox())!;
  // The bottom margin opens the source without hitting its title editor or
  // the reference's read-only content surface.
  await page.mouse.dblclick(box.x + box.width / 4, box.y + box.height - 4);
  await expect(page.getByRole('tab')).toHaveCount(tabCount + 1);
};
const openSnapshot = async (page: Page, snapshot: object) => {
  const choosing = page.waitForEvent('filechooser');
  await selectAppAction(page, '打开');
  await (
    await choosing
  ).setFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(snapshot)),
  });
};
const node = (
  id: string,
  x: number,
  y: number,
  width = 160.5,
  height = 90.25,
) => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x, y, width, height, outline: 'rectangle' },
  content: { label: id },
});
const frame = (
  id: string,
  children: string[],
  x = 0,
  y = 0,
  width = 960,
  height = 640,
  label = '',
) => ({
  id,
  kind: 'frame',
  cellType: 'frame',
  geometry: { x, y, width, height },
  children,
  groups: [],
  content: { label },
});
const draw = async (
  page: Page,
  label: string,
  first = [350.4, 230.7],
  last = [590.2, 390.1],
) => {
  await selectDrawingTool(page, label);
  if (label === '形状') await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + first[0], box.y + first[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + last[0], box.y + last[1], { steps: 5 });
  await page.mouse.up();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
});

for (const diagram of ['思维导图', '流程图', '架构图'])
  test(`${diagram} background taps select its Frame shell and show shell properties`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setAppLanguage(page, 'zh');
    await draw(page, diagram, [300, 200], [660, 500]);
    const reference = canvas(page).locator(
      '[data-cell-kind="frame-reference"]',
    );
    const referenceId = (await reference.getAttribute('data-cell-id'))!;
    const shell = reference.locator(':scope > [data-frame-shell]');
    const background = reference.locator('svg[data-surface="nested"]').first();
    await expect(background).toBeVisible();
    const outerBox = (await canvas(page).boundingBox())!;
    const clearSelection = () =>
      page.mouse.click(outerBox.x + 120, outerBox.y + 650);
    await clearSelection();
    await expect(shell).toHaveAttribute('data-frame-active', 'false');
    const blank = await background.evaluate((element) => {
      const box = element.getBoundingClientRect();
      for (let y = box.top + 12; y < box.bottom - 12; y += 12)
        for (let x = box.left + 12; x < box.right - 12; x += 12)
          if (document.elementFromPoint(x, y) === element) return { x, y };
      throw new Error('No exposed embedded canvas background');
    });
    const geometry = await shell.evaluate((element) =>
      ['x', 'y', 'width', 'height'].map((name) => element.getAttribute(name)),
    );
    await page.mouse.click(blank.x, blank.y);
    await expect(shell).toHaveAttribute('data-frame-active', 'true');
    const inspector = page.locator(
      '.workspace-pane.is-active .frame-inspector',
    );
    await expect(inspector).toHaveAttribute(
      'data-selected-cell-id',
      referenceId,
    );
    await expect(inspector.locator('.frame-inspector__type')).toHaveText(
      '容器',
    );
    await expect(canvas(page)).toBeFocused();
    expect(
      await shell.evaluate((element) =>
        ['x', 'y', 'width', 'height'].map((name) => element.getAttribute(name)),
      ),
    ).toEqual(geometry);
    await clearSelection();
    await expect(shell).toHaveAttribute('data-frame-active', 'false');
    await expect(inspector).not.toHaveAttribute(
      'data-selected-cell-id',
      referenceId,
    );
    await expect(inspector.locator('.frame-inspector__header')).toHaveText(
      '画布设置',
    );

    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 24, blank.y + 12, { steps: 4 });
    await page.mouse.up();
    await expect(shell).toHaveAttribute('data-frame-active', 'false');
    expect(
      await shell.evaluate((element) =>
        ['x', 'y', 'width', 'height'].map((name) => element.getAttribute(name)),
      ),
    ).toEqual(geometry);
  });

test('every toolbar creation selects its outer cell and stops after one gesture', async ({
  page,
}) => {
  for (const [label, kind] of [
    ['形状', 'geometry'],
    ['文本', 'geometry'],
    ['画笔', 'freehand'],
    ['表格', 'table'],
    ['泳道', 'swimlane'],
    ['容器', 'frame-reference'],
    ['思维导图', 'frame-reference'],
    ['流程图', 'frame-reference'],
    ['架构图', 'frame-reference'],
    ['直线', 'arrow'],
    ['曲线', 'arrow'],
  ]) {
    await draw(page, label);
    const created = canvas(page).locator(`[data-cell-kind="${kind}"]`);
    await expect(created).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: '选择', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    if (kind === 'arrow')
      await expect(page.locator('.frame-inspector__header')).toHaveText('连线');
    await expect(
      page.getByRole('toolbar', { name: 'Selection actions' }),
    ).toHaveCount(0);
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + 780, box.y + 580);
    await expect(created).toHaveCount(1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(created).toHaveCount(0);
  }
});

test('shape icons show localized tooltips on hover and focus without a duplicate select', async ({
  page,
}) => {
  for (const [language, toolLabel, diamondLabel, interfaceLabel] of [
    ['zh', '形状', '菱形', '需求接口'],
    ['en', 'Shape', 'Diamond', 'Required Interface'],
  ] as const) {
    await setAppLanguage(page, language);
    await selectDrawingTool(page, toolLabel);
    const popup = page.getByRole('dialog', { name: toolLabel, exact: true });
    await expect(popup.locator('select')).toHaveCount(0);
    const buttons = popup.locator('button[data-shape]');
    await expect(buttons).toHaveCount(65);
    const labels = await buttons.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label')),
    );
    expect(
      labels.every((label) => label && !label.startsWith('shape.name.')),
    ).toBe(true);
    const diamond = popup.getByTestId('shape-diamond');
    await expect(diamond).toHaveAccessibleName(diamondLabel);
    await diamond.hover();
    await expect(page.getByRole('tooltip')).toHaveText(diamondLabel);
    const description = await diamond.getAttribute('aria-describedby');
    await expect(page.getByRole('tooltip')).toHaveAttribute('id', description!);
    await diamond.click();
    await expect(popup).toHaveCount(0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await selectDrawingTool(page, toolLabel);
    await expect(popup.getByTestId('shape-diamond')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // The last icon requires scrolling; its portal tooltip must stay visible.
    const last = popup.getByTestId('shape-requiredInterface');
    await last.hover();
    await expect(page.getByRole('tooltip')).toHaveText(interfaceLabel);
    await expect(page.getByRole('tooltip')).toBeInViewport({ ratio: 1 });
    await page.mouse.move(900, 600);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await popup.getByTestId('shape-rectangle').focus();
    await page.keyboard.press('Tab');
    await expect(popup.getByTestId('shape-roundRectangle')).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(
      language === 'zh' ? '圆角矩形' : 'Rounded Rectangle',
    );
    await page.keyboard.press('Enter');
    await expect(popup).toHaveCount(0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
});

test('shape popup tracks its trigger, enters selection while open and preserves an outside selection gesture', async ({
  page,
}) => {
  const trigger = page
    .getByRole('toolbar', { name: 'Drawing tools' })
    .getByRole('button', { name: '形状', exact: true });
  await trigger.click();
  const popup = page.getByRole('dialog', { name: '形状', exact: true });
  await expect(popup).toBeVisible();
  const buttonBox = (await trigger.boundingBox())!;
  const popupBox = (await popup.boundingBox())!;
  expect(popupBox.x).toBeGreaterThanOrEqual(buttonBox.x + buttonBox.width);
  await popup.getByTestId('shape-diamond').click();
  await expect(popup).toHaveCount(0);
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 420, box.y + 290);
  await expect(canvas(page).locator('[data-node-shape="diamond"]')).toHaveCount(
    1,
  );
  await trigger.click();
  await expect(popup.getByTestId('shape-diamond')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.mouse.click(box.x + 700, box.y + 460);
  await expect(canvas(page).locator('[data-node-shape="diamond"]')).toHaveCount(
    1,
  );
  await expect(popup).toHaveCount(0);
  await page.setViewportSize({ width: 800, height: 844 });
  await trigger.click();
  await expect(popup).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(popup).toBeInViewport({ ratio: 1 });
  // Scroll an ancestor to exercise Floating UI's scroll-position updates.
  await trigger.evaluate((button) => {
    const tools = button.closest('.frame-tools') as HTMLElement;
    tools.style.maxHeight = '45px';
    tools.style.flexDirection = 'column';
    tools.style.flexWrap = 'nowrap';
    for (const child of tools.children)
      (child as HTMLElement).style.flexShrink = '0';
    tools.style.overflowY = 'auto';
    tools.scrollTop = 28;
  });
  expect(
    await trigger.evaluate(
      (button) => button.closest('.frame-tools')!.scrollTop,
    ),
  ).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const button = (await trigger.boundingBox())!,
        panel = (await popup.boundingBox())!;
      return Math.min(
        Math.abs(panel.x - button.x - button.width - 8),
        Math.abs(button.x - panel.x - panel.width - 8),
      );
    })
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
});

test('Frame title stays inside a stable enclosing shell and preserves edits, marks and exports', async ({
  page,
}) => {
  await draw(page, '容器');
  const external = title(page);
  await expect(external).toHaveText('Frame');
  const referenceId = await external.getAttribute('data-frame-title-id');
  const shell = canvas(page).locator(
    '[data-cell-kind="frame"] > [data-frame-shell], [data-cell-kind="frame-reference"] > [data-frame-shell]',
  );
  const plate = canvas(page).locator('[data-frame-content-plate]');
  const titleBox = (await external.boundingBox())!,
    shellBox = (await shell.boundingBox())!;
  await expect(external.locator('foreignObject')).toHaveAttribute(
    'x',
    String(Number(await shell.getAttribute('x')) + 16),
  );
  expect(titleBox.y).toBeGreaterThan(shellBox.y);
  expect(titleBox.y + titleBox.height).toBeLessThan(
    (await plate.boundingBox())!.y,
  );
  await expect(shell).toHaveAttribute('data-frame-active', 'true');
  const canvasBox = (await canvas(page).boundingBox())!;
  await page.mouse.click(canvasBox.x + 280, canvasBox.y + 500);
  await expect(shell).toHaveAttribute('data-frame-active', 'false');
  expect(await external.boundingBox()).toEqual(titleBox);
  await external.click();
  await expect(shell).toHaveAttribute('data-frame-active', 'true');
  expect(await external.boundingBox()).toEqual(titleBox);
  await external.dblclick();
  const editor = page.locator(
    '[data-frame-title-editor] [contenteditable="true"]',
  );
  await expect(editor).toBeFocused();
  await editor.fill('Project Alpha');
  await editor.press('ControlOrMeta+a');
  await page
    .getByRole('toolbar', { name: 'Text formatting' })
    .getByRole('button', { name: 'Bold', exact: true })
    .click();
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(external).toHaveText('Project Alpha');
  await expect(external.locator('strong')).toHaveText('Project Alpha');
  await expect(page.getByTestId('inspector-name')).toHaveValue('Project Alpha');
  await external.dblclick();
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.press('Z');
  await editor.press('Enter');
  await expect(external).toHaveText('Project AlphaZ');
  await canvas(page).press('ControlOrMeta+z');
  await expect(external).toHaveText('Project Alpha');
  await canvas(page).press('ControlOrMeta+Shift+z');
  await expect(external).toHaveText('Project AlphaZ');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find(
          (cell: any) =>
            cell?.kind === 'frame-reference' && cell.id === referenceId,
        )?.content?.label,
    )
    .toBe('Project AlphaZ');
  await page.reload();
  await expect(external).toHaveText('Project AlphaZ');
  await expect(external.locator('strong')).toHaveText('Project AlphaZ');
  for (const format of ['svg', 'png']) {
    await selectAppAction(page, '图像导出');
    const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
    await dialog.getByLabel('Image format').selectOption(format);
    if (format === 'png')
      await dialog.getByLabel('Image scale').selectOption('1');
    const downloading = page.waitForEvent('download');
    await dialog.getByTestId('image-export-button').click();
    const path = await (await downloading).path();
    const bytes = readFileSync(path!);
    if (format === 'svg') {
      const svg = bytes.toString();
      expect(svg).toContain('Project AlphaZ');
      expect(svg).toContain('data-frame-title-id');
      expect(svg).not.toContain('data-frame-text-editor');
      expect(svg).not.toContain('contenteditable');
    } else {
      const opaqueTitlePixels = await page.evaluate(
        async (bytes) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)]),
          );
          const c = document.createElement('canvas');
          c.width = bitmap.width;
          c.height = bitmap.height;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const pixels = ctx.getImageData(
            0,
            20,
            c.width,
            Math.min(44, c.height - 20),
          ).data;
          let count = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
          bitmap.close();
          return count;
        },
        [...bytes],
      );
      expect(opaqueTitlePixels).toBeGreaterThan(20);
    }
  }
});

test('read-only nested previews preserve floats and source edits snap without changing legacy sizes', async ({
  page,
}) => {
  await openSnapshot(page, {
    store: {
      rootId: 'root',
      cells: {
        root: frame('root', ['nested']),
        nested: frame('nested', ['inner'], 350.4, 240.7, 300, 230, 'Nested'),
        inner: node('inner', -10.4, 20.7, 600.5, 300.25),
      },
    },
  });
  await expect(title(page)).toHaveText('Nested');
  const innerId = await canvas(page)
    .locator('[data-cell-kind="geometry"]')
    .getAttribute('data-cell-id');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.geometry.x,
    )
    .toBe(-10.4);
  const inner = canvas(page).locator(`[data-cell-id="${innerId}"]`);
  const referenceId = (await title(page).getAttribute('data-frame-title-id'))!;
  const previewBox = (await inner.boundingBox())!;
  await page.mouse.move(
    previewBox.x + previewBox.width / 2,
    previewBox.y + previewBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    previewBox.x + previewBox.width / 2 + 23.6,
    previewBox.y + previewBox.height / 2 + 17.3,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(
    (await savedCells(page)).find((cell: any) => cell.id === innerId).geometry,
  ).toMatchObject({ x: -10.4, y: 20.7, width: 600.5, height: 300.25 });
  await openReferenceSource(page, referenceId);
  await expect(title(page)).toHaveCount(0);
  await page.getByTestId('canvas-zoom-in').locator('visible=true').click();
  await inner.click();
  const box = (await inner.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 23.6,
    box.y + box.height / 2 + 17.3,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const g = (await savedCells(page)).find(
        (cell: any) => cell?.id === innerId,
      )?.geometry;
      return g && Number.isInteger(g.x) && Number.isInteger(g.y);
    })
    .toBe(true);
  await canvas(page).press('ControlOrMeta+z');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.geometry,
    )
    .toMatchObject({ x: -10.4, y: 20.7, width: 600.5, height: 300.25 });
  await inner.click();
  await editBody(page, 'Renamed legacy');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.content?.label,
    )
    .toBe('Renamed legacy');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.geometry.x,
    )
    .toBe(-10.4);
  await page.getByRole('spinbutton', { name: 'x', exact: true }).fill('19.6');
  await page.getByRole('spinbutton', { name: 'x', exact: true }).press('Enter');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.geometry,
    )
    .toMatchObject({ x: 20, y: 21, width: 600.5, height: 300.25 });
  await page
    .getByRole('spinbutton', { name: 'width', exact: true })
    .fill('619.6');
  await page
    .getByRole('spinbutton', { name: 'width', exact: true })
    .press('Enter');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.geometry,
    )
    .toMatchObject({ x: 20, y: 21, width: 620, height: 300 });
  await page
    .getByRole('spinbutton', { name: 'height', exact: true })
    .fill('319.6');
  await page
    .getByRole('spinbutton', { name: 'height', exact: true })
    .press('Enter');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.geometry.height,
    )
    .toBe(320);
  await canvas(page).press('ControlOrMeta+z');
  await canvas(page).press('ControlOrMeta+z');
  await expect
    .poll(
      async () =>
        (await savedCells(page)).find((cell: any) => cell?.id === innerId)
          ?.geometry,
    )
    .toMatchObject({ width: 600.5, height: 300.25 });
});

test('blank canvas retains keyboard focus without a native outline', async ({
  page,
}) => {
  await draw(page, '形状');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 100, box.y + 100);
  await expect(canvas(page)).toBeFocused();
  expect(
    await canvas(page).evaluate((svg) => getComputedStyle(svg).outlineStyle),
  ).toBe('none');
  await canvas(page).press('ControlOrMeta+a');
  await canvas(page).press('Delete');
  await expect(canvas(page).locator('[data-cell-kind="geometry"]')).toHaveCount(
    0,
  );
});

test('image upload selects the image once and failed decoding leaves the document unchanged', async ({
  page,
}) => {
  const input = page.locator('input[type="file"][accept="image/*"]');
  await input.setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(canvas(page).locator('[data-cell-kind="image"]')).toHaveCount(1);
  await expect(page.getByTestId('inspector-name')).toHaveAttribute(
    'placeholder',
    '图片',
  );
  await expect(
    page.getByRole('button', { name: '选择', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await input.setInputFiles({
    name: 'bad.png',
    mimeType: 'image/png',
    buffer: Buffer.from('invalid image'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(canvas(page).locator('[data-cell-kind="image"]')).toHaveCount(1);
});

test('nested preview titles stay visible, source shells rename and locked shells prevent editing', async ({
  page,
}) => {
  await openSnapshot(page, {
    store: {
      rootId: 'root',
      cells: {
        root: frame('root', ['outer']),
        outer: frame('outer', ['nested'], 80, 200, 280, 260, 'Outer'),
        nested: frame('nested', [], 100, 100, 560, 360, 'Inner title'),
      },
    },
  });
  const nestedTitle = title(page).filter({ hasText: 'Inner title' });
  await expect(nestedTitle).toBeVisible();
  const outerId = (await title(page)
    .filter({ hasText: 'Outer' })
    .getAttribute('data-frame-title-id'))!;
  await page.setViewportSize({ width: 800, height: 844 });
  await page.getByTestId('canvas-status-fit').click();
  // The selected frame's top resize handle sits at the title's center, so the
  // double-click lands on the left of the title strip instead.
  await nestedTitle.dblclick({ position: { x: 10, y: 2 } });
  const overlay = page.locator('[data-frame-title-editor]');
  // A regular-canvas reference is a read-only preview. Editing its nested
  // shell requires opening the owner file, whose local reference is editable.
  await expect(overlay).toHaveCount(0);
  await openReferenceSource(page, outerId);
  await expect(title(page)).toHaveCount(1);
  await nestedTitle.dblclick({ position: { x: 10, y: 2 } });
  await expect(overlay).toBeInViewport({ ratio: 1 });
  await overlay.locator('[contenteditable="true"]').fill('Nested renamed');
  await overlay.locator('[contenteditable="true"]').press('Enter');
  await expect(title(page).filter({ hasText: 'Nested renamed' })).toBeVisible();
  await backToPreviousCanvas(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const outerTitle = title(page).filter({ hasText: 'Outer' });
  await outerTitle.click();
  await expandPropertyGroup(page);
  await page.getByRole('checkbox', { name: '锁定', exact: true }).check();
  await outerTitle.dblclick();
  await expect(overlay).toHaveCount(0);
  const lockedNested = title(page).filter({ hasText: 'Nested renamed' });
  await lockedNested.dblclick();
  await expect(overlay).toHaveCount(0);
  await expect(
    page.getByTestId('inspector-name').locator('visible=true'),
  ).toHaveAttribute('disabled', '');
});

test('navigation during image decoding prevents a late image insertion', async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = Image.prototype.decode;
    Image.prototype.decode = async function () {
      await original.call(this);
      await new Promise<void>((resolve) => {
        (window as any).releaseImageDecode = resolve;
      });
      (window as any).imageDecodeFinished = true;
    };
  });
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseImageDecode))
    .toBe('function');
  await draw(page, '容器');
  // The title strip renames on double-click, so opening a frame happens on
  // the shell's bottom margin, the only part left uncovered by content —
  // off-center, since the selected frame's resize handle sits at mid-bottom.
  const frame = canvas(page)
    .locator('[data-cell-kind="frame"], [data-cell-kind="frame-reference"]')
    .first();
  const box = (await frame
    .locator(':scope > [data-frame-shell]')
    .boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 4, box.y + box.height - 4);
  await expect(
    canvas(page).locator(
      '[data-cell-kind="frame"], [data-cell-kind="frame-reference"]',
    ),
  ).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseImageDecode());
  await expect
    .poll(() => page.evaluate(() => (window as any).imageDecodeFinished))
    .toBe(true);
  await expect(canvas(page).locator('[data-cell-kind="image"]')).toHaveCount(0);
  expect(
    (await savedCells(page)).filter((cell: any) => cell?.kind === 'image'),
  ).toHaveLength(0);
});

test('Frame shells and titles move in local integer pixels, keep descendants unchanged and survive history and reload', async ({
  page,
}) => {
  await openSnapshot(page, {
    store: {
      rootId: 'root',
      cells: {
        root: frame('root', ['outer']),
        outer: frame('outer', ['nested'], 350.4, 240.7, 380, 300, 'Outer drag'),
        nested: frame('nested', ['leaf'], 70.4, 100.7, 400, 320, 'Nested drag'),
        leaf: node('leaf', -10.4, 20.7, 600.5, 300.25),
      },
    },
  });
  await expect(title(page)).toHaveCount(2);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const namedTitle = (name: string) => title(page).filter({ hasText: name });
  const outerId = (await namedTitle('Outer drag').getAttribute(
    'data-frame-title-id',
  ))!;
  const nestedId = (await namedTitle('Nested drag').getAttribute(
    'data-frame-title-id',
  ))!;
  const leafId = (await canvas(page)
    .locator('[data-cell-kind="geometry"]')
    .getAttribute('data-cell-id'))!;
  await page.getByTestId('canvas-zoom-in').click();
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('110%');
  for (const [id, handle] of [
    [outerId, 'shell'],
    [outerId, 'title'],
    [nestedId, 'title'],
  ] as const) {
    if (id === nestedId) {
      // The nested shell belongs to the outer source file; its appearance
      // inside the root preview is intentionally read-only.
      await openReferenceSource(page, outerId);
      await expect(title(page)).toHaveCount(1);
    }
    const original = await savedCells(page);
    const originalFrame = original.find((cell: any) => cell.id === id);
    const shell = canvas(page)
      .locator(`[data-cell-id="${id}"]`)
      .locator(':scope > [data-frame-shell]');
    const target =
      handle === 'shell' ? shell : title(page, id).locator(':scope > rect');
    const box = (await target.boundingBox())!;
    const scale = await target.evaluate(
      (element) => (element as SVGGraphicsElement).getScreenCTM()!.a,
    );
    const start = {
      x: box.x + (handle === 'shell' ? 10 : box.width / 2),
      y: box.y + box.height / 2,
    };
    const delta = { x: 43.6, y: 27.3 };
    const expected = {
      ...originalFrame.geometry,
      derived: false,
      x: Math.round(originalFrame.geometry.x + delta.x / scale),
      y: Math.round(originalFrame.geometry.y + delta.y / scale),
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 });
    await expect(shell).toHaveAttribute('x', String(expected.x));
    await expect(shell).toHaveAttribute('y', String(expected.y));
    // The preview moves visually without saving until the pointer is released.
    expect(
      (await savedCells(page)).find((cell: any) => cell.id === id).geometry,
    ).toEqual(originalFrame.geometry);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await savedCells(page)).find((cell: any) => cell.id === id).geometry,
      )
      .toEqual(expected);
    for (const childId of id === outerId ? [nestedId, leafId] : [leafId])
      expect(
        (await savedCells(page)).find((cell: any) => cell.id === childId),
      ).toEqual(original.find((cell: any) => cell.id === childId));
    await canvas(page).press('ControlOrMeta+z');
    await expect
      .poll(
        async () =>
          (await savedCells(page)).find((cell: any) => cell.id === id).geometry,
      )
      .toEqual(originalFrame.geometry);
    await canvas(page).press('ControlOrMeta+Shift+z');
    await expect
      .poll(
        async () =>
          (await savedCells(page)).find((cell: any) => cell.id === id).geometry,
      )
      .toEqual(expected);
  }
  await backToPreviousCanvas(page);
  const persisted = await savedCells(page);
  await page.reload();
  await activateBoardTab(page);
  await expect(title(page)).toHaveCount(2);
  expect(await savedCells(page)).toEqual(persisted);
  const target = namedTitle('Outer drag').locator(':scope > rect');
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 30,
    { steps: 5 },
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await savedCells(page)).toEqual(persisted);
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toBeDisabled();
  await namedTitle('Outer drag').click();
  await expandPropertyGroup(page);
  await page.getByRole('checkbox', { name: '锁定', exact: true }).check();
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', 'saved');
  const locked = await savedCells(page);
  const nestedBox = (await namedTitle('Nested drag').boundingBox())!;
  await page.mouse.move(
    nestedBox.x + nestedBox.width / 2,
    nestedBox.y + nestedBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    nestedBox.x + nestedBox.width / 2 + 50,
    nestedBox.y + nestedBox.height / 2 + 30,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await savedCells(page)).toEqual(locked);
});

test('readonly Frame titles cannot enter rename or move the document', async ({
  page,
}) => {
  await draw(page, '容器');
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const before = await savedCells(page);
  await page.goto('/?readonly=1');
  const external = title(page);
  await expect(external).toBeVisible();
  await external.dblclick();
  await expect(page.locator('[data-frame-title-editor]')).toHaveCount(0);
  const box = (await external.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 70,
    box.y + box.height / 2 + 30,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await savedCells(page)).toEqual(before);
});
