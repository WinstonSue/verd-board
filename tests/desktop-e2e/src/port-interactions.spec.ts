import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openActiveFile, setAppLanguage } from '../../web-e2e/src/app-actions';
import {
  exercisePortInteractions,
  exerciseWorkflowEndpoints,
  exerciseWaypointRemoval,
  portCanvas,
  portFixture,
  waypointFixture,
} from '../../web-e2e/src/port-interactions';

interface NativeCursorSample {
  type: string;
  time: number;
  empty: boolean;
  scale: number;
  size: { width: number; height: number };
  hotspot: { x: number; y: number };
  imageSize: { width: number; height: number };
  physical: { x: number; y: number };
  focused: boolean;
}
interface NativeCursorProbe {
  events: NativeCursorSample[];
  image?: string;
}
type ProbeGlobal = typeof globalThis & { portCursorProbe?: NativeCursorProbe };

async function focusDesktopWindow(desktop: ElectronApplication, page: Page) {
  await desktop.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    app.focus({ steal: true });
    window.show();
    window.focus();
  });
  await page.bringToFront();
  await expect
    .poll(() =>
      desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFocused(),
      ),
    )
    .toBe(true);
}

async function observeNativeCursor(desktop: ElectronApplication, page: Page) {
  await desktop.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const state: NativeCursorProbe = { events: [] };
    (globalThis as ProbeGlobal).portCursorProbe = state;
    window.webContents.on(
      'cursor-changed',
      (_event, type, image, scale, size, hotspot) => {
        state.events.push({
          type,
          time: Date.now(),
          empty: image?.isEmpty() ?? true,
          scale,
          size,
          hotspot,
          imageSize: image?.getSize(),
          physical: screen.getCursorScreenPoint(),
          focused: window.isFocused(),
        });
        if (state.events.length > 512) state.events.shift();
        if (type === 'custom' && !image.isEmpty())
          state.image = image.toDataURL();
      },
    );
  });
  return async (point: { x: number; y: number }) => {
    // Native cursor samples require the test window to own OS focus, including
    // after history-menu interactions. Refresh the cursor at the same point.
    await focusDesktopWindow(desktop, page);
    await page.mouse.move(point.x, point.y);
    await expect
      .poll(() =>
        desktop.evaluate(() => {
          const sample = (globalThis as ProbeGlobal).portCursorProbe?.events.at(
            -1,
          );
          return { type: sample?.type, focused: sample?.focused };
        }),
      )
      .toEqual({ type: 'custom', focused: true });
    const native = await desktop.evaluate(() =>
      (globalThis as ProbeGlobal).portCursorProbe!.events.at(-1)!,
    );
    expect(native.focused).toBe(true);
    expect(native.empty).toBe(false);
    expect(native.scale).toBeGreaterThan(0);
    // Electron reports device pixels (48px / scale 2 on the Retina display).
    expect(native.size.width / native.scale).toBe(24);
    expect(native.size.height / native.scale).toBe(24);
    expect(native.hotspot.x / native.scale).toBe(12);
    expect(native.hotspot.y / native.scale).toBe(12);
    expect(native.imageSize).toEqual(native.size);
  };
}

async function runDesktopPorts(
  fixture: ReturnType<typeof portFixture>,
  exercise: typeof exercisePortInteractions,
  edgeCount: number,
  verify: (cells: Record<string, any>, page: Page) => void | Promise<void>,
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-port-interactions-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const project = path.join(directory, 'project');
    const userData = path.join(directory, 'user-data');
    await mkdir(project);
    await mkdir(userData);
    const filename = path.join(project, 'ports.verd.json');
    await writeFile(filename, JSON.stringify(fixture));
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const launch = async () => {
      desktop = await electron.launch({
        args: [launcher],
        env: { ...process.env, VERDBOARD_WORKSPACE_PATH: project },
      });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 1000),
      );
      await focusDesktopWindow(desktop, page);
      await expect(page.locator('.workspace-shell')).toBeVisible();
      const skip = page.getByRole('button', { name: '跳过', exact: true });
      if (await skip.isVisible()) await skip.click();
      await openActiveFile(page);
      return page;
    };
    const page = await launch();
    await setAppLanguage(page, 'zh');
    await focusDesktopWindow(desktop!, page);
    await page.mouse.move(2, 2);
    await expect(portCanvas(page)).toHaveAttribute(
      'data-frame-cursor-mode',
      'tool',
    );
    const nativeCursor = await observeNativeCursor(desktop!, page);
    await portCanvas(page).evaluate((svg) => {
      const state: Record<string, unknown>[] = [];
      (
        window as typeof window & { portCursorTrace?: typeof state }
      ).portCursorTrace = state;
      let point: { x: number; y: number; pointerId: number } | undefined;
      const sample = (type: string) => {
        const hit = point && document.elementFromPoint(point.x, point.y);
        state.push({
          type,
          time: Date.now(),
          point,
          target: hit?.getAttribute('data-control-hit'),
          logical: svg.getAttribute('data-frame-cursor'),
          owner: svg.getAttribute('data-frame-cursor-owner'),
          mode: svg.getAttribute('data-frame-cursor-mode'),
          captured: point ? svg.hasPointerCapture(point.pointerId) : false,
          cursor: hit ? getComputedStyle(hit).cursor : '',
        });
        if (state.length > 512) state.shift();
      };
      for (const type of [
        'pointerover',
        'pointermove',
        'pointerdown',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ])
        svg.addEventListener(
          type,
          (event) => {
            const pointer = event as PointerEvent;
            point = {
              x: pointer.clientX,
              y: pointer.clientY,
              pointerId: pointer.pointerId,
            };
            queueMicrotask(() => sample(type));
          },
          true,
        );
      new MutationObserver(() => sample('cursor-update')).observe(svg, {
        attributes: true,
        attributeFilter: [
          'style',
          'data-frame-cursor',
          'data-frame-cursor-owner',
          'data-frame-cursor-mode',
        ],
      });
    });
    const saved = async () =>
      JSON.parse(await readFile(filename, 'utf8')).cells;
    try {
      await exercise(page, saved, nativeCursor);
    } catch (error) {
      if (!page.isClosed())
        await page
          .screenshot({ path: test.info().outputPath('port-failure.png') })
          .catch(() => {});
      throw error;
    } finally {
      // Preserve the original interaction failure if the app/window already exited.
      const [nativeResult, rendererResult] = await Promise.allSettled([
        desktop!.evaluate(() => (globalThis as ProbeGlobal).portCursorProbe),
        page.evaluate(
          () =>
            (window as typeof window & { portCursorTrace?: unknown })
              .portCursorTrace,
        ),
      ]);
      const native =
        nativeResult.status === 'fulfilled' ? nativeResult.value : undefined;
      const renderer =
        rendererResult.status === 'fulfilled'
          ? rendererResult.value
          : undefined;
      const tracePath = test.info().outputPath('port-cursor-trace.json');
      await writeFile(
        tracePath,
        JSON.stringify(
          {
            native: native?.events,
            renderer,
            collectionErrors: [nativeResult, rendererResult].flatMap(
              (result) =>
                result.status === 'rejected' ? [String(result.reason)] : [],
            ),
          },
          null,
          2,
        ),
      );
      await test.info().attach('port-cursor-trace', {
        path: tracePath,
        contentType: 'application/json',
      });
      if (native?.image) {
        const cursorPath = test.info().outputPath('native-move-cursor.png');
        await writeFile(
          cursorPath,
          Buffer.from(native.image.split(',')[1], 'base64'),
        );
        await test.info().attach('native-move-cursor', {
          path: cursorPath,
          contentType: 'image/png',
        });
      }
    }
    await verify(await saved(), page);
    await desktop!.close();
    desktop = undefined;
    const restarted = await launch();
    await expect(portCanvas(restarted).locator('[data-edge-hit]')).toHaveCount(
      edgeCount,
    );
    await verify(await saved(), restarted);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

// eslint-disable-next-line no-empty-pattern -- Electron owns its window.
test('Desktop ports honor selection and save only the chosen shared connection across restart', async ({}) => {
  await runDesktopPorts(
    portFixture(true),
    exercisePortInteractions,
    5,
    (cells) => {
      expect(cells.e2.target.cellId).toBe('d');
      expect(cells.e3.target.cellId).toBe('c');
      expect(cells.e3.route.points).toHaveLength(4);
    },
  );
});

// eslint-disable-next-line no-empty-pattern -- Electron owns its window.
test('Desktop orthogonal U corners flatten and preserve bindings across restart', async ({}) => {
  await runDesktopPorts(
    waypointFixture(),
    exerciseWaypointRemoval,
    1,
    async (cells, page) => {
      expect(cells.bend.source).toEqual({ cellId: 'a', portId: 'right' });
      expect(cells.bend.target).toEqual({ cellId: 'c', anchor: [0, 0.5] });
      expect(cells.bend.route.points).toEqual([
        [150, 440],
        [650, 440],
      ]);
      await expect(
        portCanvas(page).locator('[data-edge-hit="bend"]'),
      ).toHaveAttribute('d', 'M150 440 L650 440');
    },
  );
});

// eslint-disable-next-line no-empty-pattern -- Electron owns its window.
test('Desktop Workflow endpoints use the actual route and preserve bindings across restart', async ({}) => {
  const fixture = JSON.parse(
    await readFile(
      path.resolve(
        __dirname,
        '../../fixtures/diagrams/workflow-selected-endpoints.verd.json',
      ),
      'utf8',
    ),
  );
  await runDesktopPorts(fixture, exerciseWorkflowEndpoints, 1, (cells) => {
    expect(cells['rg-release-e-merge-block'].source).toEqual({
      cellId: 'rg-release-final-gate',
      portId: 'right',
    });
    expect(cells['rg-release-e-merge-block'].target).toEqual({
      cellId: 'rg-release-repair',
      portId: 'left',
    });
  });
});
