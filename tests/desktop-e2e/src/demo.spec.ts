import { electron, writeDesktopLauncher } from './desktop-launcher';
import { test, expect, type ElectronApplication } from '@playwright/test';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openWorkspaceMenu,
  setAppLanguage,
} from '../../web-e2e/src/app-actions';
import { canvasFiles } from './workspace-disk';
import { activeTabTitle } from '../../web-e2e/src/tab-actions';

const root = path.resolve(__dirname, '../../..');
const nativeFiles = async (
  dir: string,
  prefix = '',
): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.verdscrolls') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      Object.assign(
        files,
        await nativeFiles(path.join(dir, entry.name), relative),
      );
    else if (/\.verd(?:-doc)?\.json$/.test(entry.name))
      files[relative] = await readFile(path.join(dir, entry.name), 'utf8');
  }
  return files;
};

test('built-in native workspace opens its diagrams and documents, follows links and preserves edits across an upgrade', async ({
  browserName,
}, info) => {
  test.setTimeout(240_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-builtin-e2e-'));
  const userData = path.join(directory, 'user-data');
  const source = path.join(directory, 'builtin-source');
  const workspace = path.join(userData, 'workspaces', 'default');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(userData);
    await cp(path.join(root, 'workspace'), source, {
      recursive: true,
      filter: (file) => {
        const relative = path
          .relative(path.join(root, 'workspace'), file)
          .split(path.sep)
          .join('/');
        return (
          !relative.startsWith('.verdboard') &&
          (!relative.startsWith('.verdscrolls/') ||
            ['.verdscrolls/config.json', '.verdscrolls/.gitignore'].includes(
              relative,
            ))
        );
      },
    });
    const original = await nativeFiles(source);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const env = { ...process.env };

    delete env.VERDBOARD_WORKSPACE_PATH;
    env.VERDBOARD_BUILTIN_WORKSPACE_PATH = source;
    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 1100),
      );
      await expect(page.locator('.workspace-shell')).toBeVisible();
      if (await page.locator('svg[data-surface="root"]:visible').count())
        await setAppLanguage(page, 'zh');
      const skip = page.getByRole('button', { name: '跳过', exact: true });
      if (await skip.isVisible().catch(() => false)) await skip.click();
      return page;
    };
    const close = async () => {
      const page = await desktop!.firstWindow();
      const closed = page.waitForEvent('close');
      await desktop!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
      await closed;
      await desktop!.close();
      desktop = undefined;
    };
    let page = await launch();
    const active = () => page.locator('.workspace-pane.is-active');
    const canvas = () =>
      active()
        .locator('svg[aria-label="Frame canvas"][data-surface="root"]')
        .first();
    await expect(activeTabTitle(page)).toHaveText('文档导航');
    await active()
      .getByRole('link', { name: '项目导览（画布）', exact: true })
      .click({ modifiers: ['ControlOrMeta'] });
    await expect(canvas()).toBeVisible();
    await expect(
      canvas().locator(
        '[data-cell-kind="frame-reference"]:not([data-reference-card])',
      ),
    ).toHaveCount(9);
    await expect(
      canvas().locator('[data-cell-kind="document-frame"]'),
    ).toHaveCount(0);
    expect(Object.keys(await canvasFiles(userData))).toHaveLength(31);
    expect(Object.keys(await nativeFiles(workspace))).toHaveLength(
      Object.keys(original).length,
    );
    await openWorkspaceMenu(page);
    await expect(page.getByTestId('workspace-open-builtin')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: info.outputPath(`builtin-${browserName}-overview.png`),
    });

    const topics = Object.keys(original)
      .filter((file) => /^架构图\/\d{2}-[^/]+\.verd\.json$/.test(file))
      .sort();
    expect(topics).toHaveLength(9);
    const openReference = async (cellId: string) => {
      const header = canvas()
        .locator(
          `[data-cell-id="${cellId}"] > [data-frame-header] > [data-frame-title-id] > rect`,
        )
        .first();
      await header.click();
      const bounds = (await header.boundingBox())!;
      await active().getByTestId('frame-open').click();
      await expect(active()).toHaveAttribute('data-pane-entrance', 'complete');
      return bounds;
    };
    const returnToReference = async (
      cellId: string,
      bounds: { x: number; y: number; width: number; height: number },
    ) => {
      await active().getByTestId('navigation-return').click();
      const header = canvas()
        .locator(
          `[data-cell-id="${cellId}"] > [data-frame-header] > [data-frame-title-id] > rect`,
        )
        .first();
      await expect(header).toBeVisible();
      const restored = (await header.boundingBox())!;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(restored[key] - bounds[key])).toBeLessThan(3);
    };
    for (const [index, file] of topics.entries()) {
      const topic = JSON.parse(original[file]);
      const home = JSON.parse(original['架构图/项目导览.verd.json']);
      const homeRef = Object.values<any>(home.cells).find(
        (c) => c.data?.targetFrameId === topic.frame.id,
      )!;
      const homeBounds = await openReference(homeRef.id);
      await expect(
        canvas().locator(
          `[data-cell-id="project:topic/${String(index + 1).padStart(2, '0')}/document"]`,
        ),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`builtin-topic-${index + 1}.png`),
      });
      const details = Object.values<any>(topic.cells).filter(
        (c) => c.kind === 'frame-reference',
      );
      expect(details.length).toBeGreaterThanOrEqual(2);
      expect(details.length).toBeLessThanOrEqual(3);
      for (const [detailIndex, ref] of details.entries()) {
        const topicBounds = await openReference(ref.id);
        const cardId = `${ref.data.targetFrameId}/document`;
        const card = canvas().locator(`[data-cell-id="${cardId}"]`).first();
        await expect(card).toBeVisible();
        await expect(card).toHaveAttribute('data-cell-kind', 'geometry');
        await expect(card.locator('a')).not.toHaveCount(0);
        await page.screenshot({
          path: info.outputPath(
            `builtin-detail-${index + 1}-${detailIndex + 1}.png`,
          ),
        });
        if (ref.data.targetFrameId === 'project:detail/09/03') {
          await card
            .getByRole('link', { name: '连线路由算法', exact: true })
            .first()
            .click({ modifiers: ['ControlOrMeta'] });
          await expect(activeTabTitle(page)).toHaveText('排列与组合');
          await expect(
            active().getByRole('heading', {
              name: '连线路由算法',
              exact: true,
            }),
          ).toBeInViewport();
          await page.screenshot({
            path: info.outputPath('builtin-routing-chapter.png'),
          });
          await active().getByTestId('navigation-return').click();
          await expect(
            canvas().locator('[data-cell-id="demo:algorithms/route"]'),
          ).toBeVisible();
        }
        await returnToReference(ref.id, topicBounds);
      }
      await returnToReference(homeRef.id, homeBounds);
    }
    expect(await nativeFiles(workspace)).toEqual(original);

    await page
      .locator('.file-tree-name')
      .getByText('文档导航', { exact: true })
      .click();
    await expect(activeTabTitle(page)).toHaveText('文档导航');
    await page.screenshot({
      path: info.outputPath(`builtin-${browserName}-documents.png`),
    });
    await active()
      .getByRole('link', { name: '系统架构', exact: true })
      .click({ modifiers: ['ControlOrMeta'] });
    await expect(activeTabTitle(page)).toHaveText('系统架构');
    await expect(active().locator('.board-document-content')).toContainText(
      'WorkspaceSession',
    );
    await page
      .locator('.file-tree-name')
      .getByText('文档导航', { exact: true })
      .click();
    const editor = active().locator('.board-document-content');
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await editor.press('Enter');
    await editor.pressSequentially('Builtin document edit survives upgrades.');
    await expect(editor).toContainText(
      'Builtin document edit survives upgrades.',
    );
    await close();

    const docPath = Object.keys(original).find(
      (file) => JSON.parse(original[file]).id === 'project-doc:README',
    )!;
    const saved = JSON.parse(
      await readFile(path.join(workspace, docPath), 'utf8'),
    );
    expect(saved.text.plainText).toContain(
      'Builtin document edit survives upgrades.',
    );
    expect(await nativeFiles(source)).toEqual(original);
    // A newer resource is available on the next launch. The user's copy wins.
    const newer = JSON.parse(original[docPath]);
    newer.title = 'A newer bundled title';
    await writeFile(path.join(source, docPath), JSON.stringify(newer));
    page = await launch();
    await expect(activeTabTitle(page)).toHaveText('文档导航');
    await expect(active().locator('.board-document-content')).toContainText(
      'Builtin document edit survives upgrades.',
    );
    await close();
    expect(
      JSON.parse(await readFile(path.join(workspace, docPath), 'utf8')),
    ).toEqual(saved);
    expect(
      await readFile(
        path.join(userData, 'verdboard-global-config.json'),
        'utf8',
      ),
    ).toContain('desktopWorkspace');
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
