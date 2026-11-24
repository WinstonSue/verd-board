import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  openSettings,
  selectAppAction,
  selectHistoryAction,
  setAppLanguage,
} from '../web-e2e/src/app-actions';
import {
  expectPropertyValue,
  propertyOptions,
  selectPropertyValue,
} from './property-select';
import { selectSetting } from './settings-controls';
import { roleTone } from '../web-e2e/src/theme-role-values';
import { readable } from '../web-e2e/src/text-color-checks';

export async function selectNode(node: Locator, modifiers: 'Shift'[] = []) {
  const outline = node.locator(
    '[data-frame-node-outline], [data-uml-class-body]',
  );
  const box = (await (
    (await outline.count()) ? outline.first() : node
  ).boundingBox())!;
  const page = node.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const point = await node.evaluate((element) => {
    const outline =
      element.querySelector(
        '[data-frame-node-outline], [data-uml-class-body]',
      ) ?? element;
    const box = outline.getBoundingClientRect();
    for (const xRatio of [0.25, 0.5, 0.75])
      for (const yRatio of [0.25, 0.5, 0.75]) {
        const x = box.left + box.width * xRatio;
        const y = box.top + box.height * yRatio;
        const hit = document.elementFromPoint(x, y);
        const owner = hit?.closest('[data-cell-id]');
        if (
          hit &&
          (!owner || owner === element) &&
          !hit.closest(
            '[data-control-hit], [data-port-id], [data-selection-handles]',
          )
        )
          return { x, y };
      }
    throw new Error('No node hit point clear of connection controls');
  });
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    for (const modifier of modifiers) await page.keyboard.up(modifier);
  }
  await expect(
    page
      .locator('.workspace-pane.is-active')
      .getByRole('group', { name: '风格色', exact: true }),
  ).toBeVisible();
}

/** Both hosts exercise the same user controls and native files. */
export async function checkDiagramColors(
  page: Page,
  info: TestInfo,
  download: (action: () => Promise<void>) => Promise<Buffer> = async (
    action,
  ) => {
    const pending = page.waitForEvent('download');
    await action();
    const stream = await (await pending).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  },
) {
  await page.emulateMedia({ colorScheme: 'light' });
  await setAppLanguage(page, 'zh');
  const pane = page.locator('.workspace-pane.is-active');
  const styles = () => pane.getByRole('group', { name: '风格色', exact: true });
  for (const diagram of [
    'mind-map',
    'whiteboard-advanced',
    'workflow-process',
    'uml-class',
    'architecture',
  ]) {
    const file = JSON.parse(
      readFileSync(
        path.resolve(__dirname, `../fixtures/ai-canvas/${diagram}.verd.json`),
        'utf8',
      ),
    );
    if (diagram === 'whiteboard-advanced') {
      for (const [at, outline] of ['rectangle', 'diamond'].entries()) {
        const id = `color-shape-${at}`;
        file.cells[id] = {
          id,
          kind: 'geometry',
          cellType: 'node',
          geometry: {
            x: 64 + at * 220,
            y: 540,
            width: 180,
            height: 90,
            outline,
          },
          content: { label: `Shape ${at + 1}` },
        };
        file.frame.children.push(id);
      }
    }
    if (diagram === 'uml-class') {
      const original = Object.values<any>(file.cells).find(
        (cell) => cell.kind === 'uml-class' && cell.data.classifier === 'class',
      )!;
      const duplicate = JSON.parse(JSON.stringify(original));
      duplicate.id = 'color-second-class';
      duplicate.content = { label: 'Second class' };
      duplicate.geometry.y += duplicate.geometry.height + 100;
      file.cells[duplicate.id] = duplicate;
      file.frame.children.push(duplicate.id);
    }
    for (const [backgroundName, background] of [
      ['white', '#ffffff'],
      ['yellow', '#f4d35e'],
      ['dark', '#121b2f'],
    ]) {
      const id = `colors-${diagram}-${backgroundName}`;
      const variant = JSON.parse(JSON.stringify(file));
      variant.frame.id = id;
      variant.frame.name = id;
      variant.frame.view = {
        theme: {
          themeColorMode: 'colorful',
          backgroundMode: 'custom',
          boardBackground: background,
        },
      };
      await page
        .locator(
          'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
        )
        .setInputFiles({
          name: `${id}.verd`,
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(variant)),
        });
      const canvas = pane.locator('svg[data-surface="root"]').first();
      const openVariant = async () => {
        await page.getByRole('button', { name: id, exact: true }).click();
        await expect(
          page.locator(`[role="tab"][data-tab-id="${id}"]`),
        ).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.workspace-content')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        await expect(canvas).toBeVisible();
      };
      await openVariant();
      const selector =
        diagram === 'uml-class'
          ? '[data-cell-kind="uml-class"]'
          : diagram === 'workflow-process'
            ? '[data-cell-kind="workflow-task"]'
            : diagram === 'architecture'
              ? '[data-cell-kind="architecture-module"]'
              : diagram === 'mind-map'
                ? '[data-cell-kind="mind-root"], [data-cell-kind="mind-child"]'
                : '[data-cell-kind="geometry"]:not([data-node-shape="text"])';
      await expect
        .poll(() => canvas.locator(selector).count())
        .toBeGreaterThan(1);
      await canvas.press('Escape');
      await readable(canvas);
      if (diagram === 'workflow-process') {
        const fills = await canvas
          .locator(selector)
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('fill')),
          );
        expect(new Set(fills).size).toBe(1);
      }
      if (diagram === 'uml-class') {
        const fills = await canvas
          .locator('[data-uml-class-body]')
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('fill')),
          );
        expect(new Set(fills).size).toBe(2);
      }
      if (backgroundName === 'white' && diagram !== 'architecture') {
        const nodeId = (await canvas
          .locator(selector)
          .first()
          .getAttribute('data-cell-id'))!;
        const node = canvas.locator(`[data-cell-id="${nodeId}"]`).first();
        const originalFill = await node.getAttribute('fill');
        if (diagram === 'workflow-process') {
          const originalStroke = await node.getAttribute('stroke');
          await selectNode(node);
          await expect(
            styles().getByRole('button', { name: '自动', exact: true }),
          ).toHaveAttribute('aria-pressed', 'true');
          await styles()
            .getByRole('button', { name: '风格色 1', exact: true })
            .click();
          await expect(node).toHaveAttribute('fill', originalFill!);
          await expect(node).toHaveAttribute('stroke', originalStroke!);
          await styles()
            .getByRole('button', { name: '自动', exact: true })
            .click();
          await expect(
            styles().getByRole('button', { name: '自动', exact: true }),
          ).toHaveAttribute('aria-pressed', 'true');
          await expect(node).toHaveAttribute('fill', originalFill!);
        }
        await selectNode(node);
        await styles()
          .getByRole('button', { name: '风格色 5', exact: true })
          .click();
        await expect(node).not.toHaveAttribute('fill', originalFill!);
        await expect(
          styles().getByRole('button', { name: '风格色 5', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        await canvas.press('Escape');
        await page.mouse.move(0, 0);
        await canvas.screenshot({
          path: info.outputPath(`${diagram}-white-manual.png`),
          animations: 'disabled',
        });
        if (diagram === 'workflow-process') {
          await page.reload();
          await openVariant();
          await selectNode(node);
          await expect(
            styles().getByRole('button', { name: '风格色 5', exact: true }),
          ).toHaveAttribute('aria-pressed', 'true');
        } else await selectNode(node);
        await styles()
          .getByRole('button', { name: '自动', exact: true })
          .click();
        await expect(node).toHaveAttribute('fill', originalFill!);
        if (diagram === 'workflow-process') {
          await selectHistoryAction(page, '撤销');
          await expect(node).not.toHaveAttribute('fill', originalFill!);
          await selectHistoryAction(page, '重做');
          await expect(node).toHaveAttribute('fill', originalFill!);
          await selectNode(node);
          const fillInput = pane.getByLabel('填充', { exact: true });
          await fillInput.evaluate((input: HTMLInputElement) => {
            input.value = '#ffffff';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await styles()
            .getByRole('button', { name: '风格色 6', exact: true })
            .click();
          await expect(node).toHaveAttribute('fill', '#ffffff');
          await expect(styles()).toContainText('手动填充或描边优先');
          await pane.getByLabel('Reset fill to theme', { exact: true }).click();
          await expect(node).not.toHaveAttribute('fill', '#ffffff');
          await styles()
            .getByRole('button', { name: '自动', exact: true })
            .click();
          await expect(node).toHaveAttribute('fill', originalFill!);
          await canvas.press('Escape');
          const secondId = (
            await canvas
              .locator(selector)
              .evaluateAll((nodes) =>
                nodes
                  .map((node) => node.getAttribute('data-cell-id'))
                  .filter((id) => id !== null),
              )
          ).find((id) => id !== nodeId)!;
          const second = canvas.locator(`[data-cell-id="${secondId}"]`).first();
          await selectNode(node);
          await selectNode(second, ['Shift']);
          await expect(
            pane.getByRole('heading', { name: '已选择 2 个对象', exact: true }),
          ).toBeVisible();
          await styles()
            .getByRole('button', { name: '风格色 3', exact: true })
            .click();
          await expect(node).not.toHaveAttribute('fill', originalFill!);
          await expect(second).not.toHaveAttribute('fill', originalFill!);
          await selectHistoryAction(page, '撤销');
          await expect(node).toHaveAttribute('fill', originalFill!);
          await expect(second).toHaveAttribute('fill', originalFill!);
        }
      }
      await canvas.press('Escape');
      await page.mouse.move(0, 0);
      await readable(canvas);
      await canvas.screenshot({
        path: info.outputPath(`${diagram}-${backgroundName}-automatic.png`),
        animations: 'disabled',
      });
      if (backgroundName === 'dark') {
        await selectAppAction(page, '图像导出');
        const dialog = page.getByRole('dialog', {
          name: '图像导出',
          exact: true,
        });
        await dialog.getByLabel('Image format').selectOption('svg');
        await dialog.getByLabel('Image background').selectOption('transparent');
        const exported = (
          await download(() =>
            dialog.getByTestId('image-export-button').click(),
          )
        ).toString();
        const fills = await page.evaluate(
          ({ source, selector }) => {
            const svg = new DOMParser().parseFromString(
              source,
              'image/svg+xml',
            );
            return [...svg.querySelectorAll(selector)].map((node) =>
              node.getAttribute('fill'),
            );
          },
          {
            source: exported,
            selector:
              diagram === 'uml-class'
                ? '[data-uml-class-body], [data-uml-class-header]'
                : selector,
          },
        );
        expect(fills.length).toBeGreaterThan(1);
        for (const fill of fills) {
          if (fill !== 'none') expect(fill).toMatch(/^#[\da-f]{6}$/i);
        }
        await info.attach(`${diagram}-dark-flattened.svg`, {
          body: exported,
          contentType: 'image/svg+xml',
        });
      }
    }
  }
  await exerciseMindThemeColors(page, info);
}

/** Both hosts use persisted native data and the same inspector and theme picker. */
export async function exerciseMindThemeColors(page: Page, info: TestInfo) {
  const file = JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../fixtures/ai-canvas/mind-map.verd.json'),
      'utf8',
    ),
  );
  const idMap = Object.fromEntries(
    Object.keys(file.cells).map((id) => [id, `theme-${id}`]),
  );
  const remap = (value: any): any =>
    typeof value === 'string'
      ? (idMap[value] ?? value)
      : Array.isArray(value)
        ? value.map(remap)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value).map(([key, item]) => [
                idMap[key] ?? key,
                key === 'kind' ? item : remap(item),
              ]),
            )
          : value;
  const remapped = remap(file);
  Object.assign(file, remapped);
  file.frame.id = 'mind-theme-families';
  file.frame.name = 'Mind theme families';
  // An explicit unknown value resolves to Classic; unmarked stale paint is ignored.
  file.frame.view = {
    theme: { themeColorMode: 'missing-theme', boardBackground: '#aabbcc' },
    mind: { colorScheme: 'missing-mind-theme' },
  };
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
    .setInputFiles({
      name: 'mind-theme-families.verd',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Mind theme families$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  const canvas = pane.locator('svg[data-surface="root"]').first();
  const root = canvas.locator('[data-cell-id="theme-mind-root"]').first();
  const child = canvas.locator('[data-cell-id="theme-topic-features"]').first();
  const branch = canvas.locator(
    '[data-cell-id="theme-br-0"] path[data-frame-node-outline]',
  );
  const descendantBranch = canvas.locator(
    '[data-cell-id="theme-br-3"] path[data-frame-node-outline]',
  );
  const styles = () => pane.getByRole('group', { name: '风格色', exact: true });
  const theme = () => pane.getByLabel('Theme', { exact: true });
  const scheme = () => pane.getByLabel('Mind color scheme', { exact: true });
  await expectPropertyValue(theme(), 'default');
  await expectPropertyValue(scheme(), 'default');
  expect(
    (await propertyOptions(theme())).map((option) => option.value),
  ).toEqual(['default', 'colorful', 'soft', 'retro', 'dark']);
  expect(
    (await propertyOptions(scheme())).map((option) => option.value),
  ).toEqual(['inherit', 'default', 'colorful', 'soft', 'retro', 'dark']);
  await selectPropertyValue(scheme(), 'inherit');
  await selectNode(root);
  await styles().getByRole('button', { name: '风格色 5', exact: true }).click();
  await selectNode(child);
  await styles().getByRole('button', { name: '风格色 3', exact: true }).click();
  for (const id of ['default', 'colorful', 'soft', 'retro', 'dark']) {
    for (const appearance of ['light', 'dark'] as const) {
      await canvas.press('Escape');
      await selectPropertyValue(theme(), id);
      const settings = await openSettings(page);
      await selectSetting(
        settings.getByTestId('settings-appearance'),
        appearance,
      );
      await page.getByTestId('my-back').click();
      const rootTone = await roleTone(page, id, appearance, 4, 'strong');
      const branchTone = await roleTone(page, id, appearance, 2);
      await expect(root).toHaveAttribute('fill', rootTone.fill);
      await expect(child).toHaveAttribute('fill', 'none');
      await expect(child).toHaveAttribute('stroke', branchTone.strokeColor);
      await expect(branch).toHaveAttribute('stroke', branchTone.strokeColor);
      await expect(descendantBranch).toHaveAttribute(
        'stroke',
        branchTone.strokeColor,
      );
      await selectNode(child);
      await expect(
        styles().getByRole('button', { name: '风格色 3', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await canvas.press('Escape');
      await page.mouse.move(0, 0);
      await canvas.screenshot({
        path: info.outputPath(`mind-six-families-${id}-${appearance}.png`),
        animations: 'disabled',
      });
    }
  }
  // Explicit Mind identity changes the palette while the real canvas is retained.
  await selectPropertyValue(scheme(), 'retro');
  const explicitFill = await root.getAttribute('fill');
  await selectPropertyValue(theme(), 'colorful');
  await expect(root).toHaveAttribute('fill', explicitFill!);
  await page.reload();
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Mind theme families$/ })
    .click();
  await expectPropertyValue(scheme(), 'retro');
  await selectNode(root);
  await expect(
    styles().getByRole('button', { name: '风格色 5', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('fill', explicitFill!);
  await canvas.press('Escape');
  await selectPropertyValue(scheme(), 'inherit');
  await expect(root).toHaveAttribute(
    'fill',
    (await roleTone(page, 'colorful', 'dark', 4, 'strong')).fill,
  );
  await expect(
    page.getByText('Ungroup first to move part of a group', { exact: true }),
  ).toHaveCount(0);
}
