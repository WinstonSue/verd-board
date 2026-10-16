import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  createFrameCell,
  createCellStore,
  type FrameSnapshot,
} from '../../../packages/engine/core/src/cell/types';
import {
  createMindFrameSnapshot,
  createMindChildCell,
  addMindChild,
} from '../../../packages/engine/mind/src/cell-commands';
import { createWorkflowFrameSnapshot } from '../../../packages/engine/workflow/src/cell-commands';
import { createArchitectureFrameSnapshot } from '../../../packages/engine/architecture/src/cell-commands';
import { applyCellOperations } from '../../../packages/engine/core/src/cell/index';
import { setAppLanguage } from './app-actions';
test.use({ actionTimeout: 6000 });

const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  pane(page).locator('svg[aria-label="Frame canvas"]');
const panel = (page: Page) => pane(page).locator('.frame-inspector');
const node = (page: Page, id: string) => {
  if (id === 'a' || id === 'b')
    return canvas(page)
      .locator('[data-cell-kind="geometry"]')
      .filter({ hasText: id === 'a' ? 'Alpha' : 'Beta' });
  if (id === 'edge') return canvas(page).locator('[data-cell-kind="arrow"]');
  if (id === 'child')
    return canvas(page).locator('[data-cell-kind="mind-child"]');
  return canvas(page).locator(
    '[data-cell-kind="mind-root"], [data-cell-kind="workflow-start"], [data-cell-kind="architecture-layer"]',
  );
};
function fixture(): FrameSnapshot {
  const root = createFrameCell('frame');
  root.children = ['a', 'b', 'edge'];
  return {
    store: {
      ...createCellStore(root),
      cells: {
        frame: root,
        a: {
          id: 'a',
          kind: 'geometry',
          cellType: 'node',
          geometry: {
            x: 100,
            y: 120,
            width: 120,
            height: 60,
            outline: 'rectangle',
          },
          appearance: { strokeWidth: 2 },
          content: { label: 'Alpha' },
        },
        b: {
          id: 'b',
          kind: 'geometry',
          cellType: 'node',
          geometry: {
            x: 350,
            y: 120,
            width: 120,
            height: 60,
            outline: 'rectangle',
          },
          appearance: { strokeWidth: 4 },
          content: { label: 'Beta' },
        },
        edge: {
          id: 'edge',
          kind: 'arrow',
          cellType: 'edge',
          source: { point: [200, 300] },
          target: { point: [400, 300] },
          route: { mode: 'straight' },
        },
      },
    },
  };
}
async function open(page: Page, snapshot = fixture()) {
  await page.goto('/');
  await pane(page)
    .locator('input[type="file"][accept^="application/json"]')
    .nth(1)
    .setInputFiles({
      name: 'properties.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });
  await expect(canvas(page)).toBeVisible();
}
async function hit(target: Locator, modifiers: 'Shift'[] = []) {
  const point = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    for (let y = box.top + 4; y < box.bottom - 4; y += 4)
      for (let x = box.left + 4; x < box.right - 4; x += 4) {
        const hit = document.elementFromPoint(x, y);
        if (
          hit?.closest('[data-cell-id]') === element &&
          !hit.closest(
            '[data-mind-add], [data-port-id], [data-selection-handles]',
          )
        )
          return { x, y };
      }
    throw new Error('No visible hit point');
  });
  for (const modifier of modifiers) await target.page().keyboard.down(modifier);
  await target.page().mouse.click(point.x, point.y);
  for (const modifier of modifiers) await target.page().keyboard.up(modifier);
}
const x = (page: Page) =>
  panel(page).getByRole('spinbutton', { name: 'x', exact: true });

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
])
  for (const language of ['zh', 'en'] as const)
    test(`property layout, draft history and canvas session at ${viewport.width} ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await open(page);
      await setAppLanguage(page, language);
      await hit(node(page, 'a'));
      await expect(panel(page).getByTestId('inspector-name')).toHaveValue(
        'Alpha',
      );
      expect((await panel(page).boundingBox())!.width).toBe(300);
      await page.screenshot({
        path: `/tmp/properties-${viewport.width}-${language}.png`,
      });
      const groups = await panel(page)
        .locator('[data-property-group]')
        .evaluateAll((elements) =>
          elements.map((el) => el.getAttribute('data-property-group')),
        );
      expect(groups).toEqual([
        'geometry',
        'appearance',
        'text',
        'specific',
        'arrangement',
        'actions',
      ]);
      const arrange = panel(page).locator(
        '[data-property-group="arrangement"] > button',
      );
      await expect(arrange).toHaveAttribute('aria-expanded', 'false');
      await arrange.click();
      await expect(arrange).toHaveAttribute('aria-expanded', 'true');
      const header = await panel(page)
        .locator('.frame-inspector__header')
        .boundingBox();
      await panel(page)
        .locator('.frame-inspector__scroll')
        .evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
      expect(
        await panel(page).locator('.frame-inspector__header').boundingBox(),
      ).toEqual(header);
      await panel(page)
        .locator('.frame-inspector__scroll')
        .evaluate((el) => {
          el.scrollTop = 0;
        });
      const before = await node(page, 'a').boundingBox();
      await x(page).fill('240');
      expect(await node(page, 'a').boundingBox()).toEqual(before);
      await x(page).press('Enter');
      await panel(page).getByTestId('inspector-name').focus();
      await pane(page)
        .getByRole('button', {
          name: language === 'zh' ? '撤销' : 'Undo',
          exact: true,
        })
        .click();
      await expect(x(page)).toHaveValue('100');
      await pane(page)
        .getByRole('button', {
          name: language === 'zh' ? '重做' : 'Redo',
          exact: true,
        })
        .click();
      await expect(x(page)).toHaveValue('240');
      await x(page).fill('');
      await x(page).press('Enter');
      await expect(x(page)).toHaveAttribute('aria-invalid', 'true');
      await x(page).press('Escape');
      await expect(x(page)).toHaveValue('240');
      await hit(node(page, 'b'));
      await expect(arrange).toHaveAttribute('aria-expanded', 'true');
      expect(
        await panel(page)
          .locator('input,select,button')
          .evaluateAll((elements) =>
            elements
              .filter((el) => {
                if (!el.getClientRects().length) return false;
                const panel = el
                    .closest('.frame-inspector')!
                    .getBoundingClientRect(),
                  box = el.getBoundingClientRect();
                return box.left < panel.left || box.right > panel.right + 1;
              })
              .map((el) => el.getAttribute('aria-label') ?? el.textContent),
          ),
      ).toEqual([]);
      await expect(pane(page).getByTestId('save-status')).toHaveAttribute(
        'data-save-state',
        'saved',
      );
      await page.reload();
      await hit(node(page, 'a'));
      await expect(x(page)).toHaveValue('240');
      await expect(arrange).toHaveAttribute('aria-expanded', 'false');
      await hit(node(page, 'b'), ['Shift']);
      await expect(
        panel(page).locator('.frame-inspector__header'),
      ).toContainText('2');
      const stroke = panel(page).getByLabel('Stroke width', { exact: true });
      await expect(stroke).toHaveValue('');
      await expect(stroke).toHaveAttribute(
        'placeholder',
        language === 'zh' ? '混合值' : 'Mixed values',
      );
      await stroke.focus();
      await stroke.blur();
      await stroke.fill('3.5');
      await stroke.press('Enter');
      await hit(node(page, 'a'));
      await expect(stroke).toHaveValue('3.5');
      const edgePoint = await node(page, 'edge')
        .locator('[data-edge-hit]')
        .evaluate((path: SVGPathElement) => {
          const point = path.getPointAtLength(path.getTotalLength() / 2);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(
            path.getScreenCTM()!,
          );
          return { x: screen.x, y: screen.y };
        });
      await page.mouse.click(edgePoint.x, edgePoint.y);
      await expect(
        panel(page).getByLabel('Edge route', { exact: true }),
      ).toBeVisible();
      await canvas(page).click({ position: { x: 700, y: 500 } });
      await expect(panel(page).locator('.frame-inspector__header')).toHaveText(
        language === 'zh' ? '画布设置' : 'Canvas settings',
      );
      await expect(panel(page).getByLabel('Canvas grid size')).toBeVisible();
    });

async function selectDomain(
  page: Page,
  snapshot: FrameSnapshot,
  domain: string,
  viewport: { width: number; height: number },
  language: 'zh' | 'en',
) {
  await page.setViewportSize(viewport);
  await open(page, snapshot);
  await setAppLanguage(page, language);
  await hit(node(page, 'topic'));
  await expect(
    panel(page).locator('[data-property-group="geometry"]'),
  ).toBeVisible();
  await expect(
    panel(page).getByLabel('Selection font size', { exact: true }),
  ).toHaveValue('16px');
  await page.screenshot({
    path: `/tmp/properties-${domain}-${viewport.width}-${language}.png`,
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
])
  for (const language of ['zh', 'en'] as const) {
    test(`domain properties show effective settings for mind ${viewport.width} ${language}`, async ({
      page,
    }) => {
      const snapshot = createMindFrameSnapshot('frame', 'topic');
      const child = createMindChildCell('child');
      child.content = {
        label: 'Long content that wraps to the effective width '.repeat(10),
      };
      snapshot.store = applyCellOperations(
        snapshot.store,
        addMindChild(snapshot.store, 'topic', child, 'branch'),
      );
      await selectDomain(page, snapshot, 'mind', viewport, language);
      await page
        .getByRole('button', { name: /^(工作区设置|Workspace settings)$/ })
        .click();
      await page.getByTestId('workspace-settings-mind-width').fill('336');
      await page.getByTestId('workspace-settings-back').click();
      await hit(node(page, 'topic'));
      await expect(panel(page)).toContainText('336');
      const width = async () =>
        Number(
          await node(page, 'child')
            .locator('foreignObject')
            .last()
            .getAttribute('width'),
        ) + 16;
      await expect.poll(width).toBe(336);
      await panel(page).getByTestId('mind-width-mode').selectOption('custom');
      await expect(panel(page).getByTestId('mind-max-width')).toHaveValue(
        '336',
      );
      await panel(page).getByTestId('mind-max-width').fill('200');
      await panel(page).getByTestId('mind-max-width').press('Enter');
      await expect.poll(width).toBe(200);
    });

    test(`domain properties show effective settings for workflow ${viewport.width} ${language}`, async ({
      page,
    }) => {
      await selectDomain(
        page,
        createWorkflowFrameSnapshot('frame', 'topic'),
        'workflow',
        viewport,
        language,
      );
      await expect(
        panel(page).getByTestId('workflow-graph-mode'),
      ).toBeVisible();
    });

    test(`domain properties show effective settings for architecture ${viewport.width} ${language}`, async ({
      page,
    }) => {
      await selectDomain(
        page,
        createArchitectureFrameSnapshot('frame', 'topic'),
        'architecture',
        viewport,
        language,
      );
      await panel(page)
        .locator('[data-property-group="arrangement"] > button')
        .click();
      await expect(
        panel(page).getByLabel('Move layer up', { exact: true }),
      ).toBeDisabled();
    });
  }
