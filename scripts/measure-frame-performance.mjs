// Production-only, isolated fixtures. Benchmark without tracing; diagnose separately.
/* global document, window, SVGSVGElement, requestAnimationFrame, WheelEvent */
import { chromium, _electron as electron } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const platform = option('--platform', 'web');
const output = path.resolve(
  option('--output', '/tmp/verd-frame-performance.json'),
);
const fixtureDir = path.resolve(
  option('--fixture-dir', path.join(root, 'workspace')),
);
const tracing = args.includes('--trace');
const runs = Number(option('--runs', tracing ? '1' : '5'));
const counts = option('--counts', '1,9,36').split(',').map(Number);
const headed = args.includes('--headed');
const dpr = Number(option('--dpr', '1'));
const width = Number(option('--width', '1440'));
const height = Number(option('--height', '1000'));
if (
  !['web', 'desktop'].includes(platform) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  counts.some((count) => ![1, 9, 36].includes(count)) ||
  !(dpr > 0) ||
  !(width > 0) ||
  !(height > 0)
)
  throw new Error('Invalid benchmark options');
const variants = args.includes('--variants')
  ? JSON.parse(await readFile(option('--variants'), 'utf8'))
  : [
      {
        name: 'current',
        url: option('--url', 'http://127.0.0.1:4173'),
        desktopEntry: option(
          '--desktop-entry',
          path.join(root, 'apps/desktop/dist-electron/main.js'),
        ),
        electronExecutable: option('--electron-executable'),
      },
    ];
const files = [];
async function visit(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith('.')) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(filename);
    else if (/\.verd(?:-doc)?\.json$/.test(entry.name))
      files.push(JSON.parse(await readFile(filename, 'utf8')));
  }
}
await visit(fixtureDir);
await mkdir(path.dirname(output), { recursive: true });
const results = {
  platform,
  mode: tracing ? 'trace' : 'benchmark',
  headed,
  runs,
  requestedViewport: { width, height },
  fixtureSha256: createHash('sha256')
    .update(JSON.stringify(files))
    .digest('hex'),
  scenarios: [],
  summaries: [],
};
const active = '.workspace-pane.is-active';
const canvas = `${active} svg[data-surface="root"]`;
const metricNames = [
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
];
const metrics = async (cdp) =>
  Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map(
      ({ name, value }) => [name, value],
    ),
  );
const delta = (a, b) =>
  Object.fromEntries(metricNames.map((key) => [key, b[key] - a[key]]));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const drain = async (page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
const mark = async (page, name) =>
  page.evaluate((value) => performance.mark(value), name);
function summarize() {
  results.summaries = [];
  for (const variant of variants)
    for (const count of counts)
      for (const phase of ['zoom', 'pan', 'drag', 'drag-commit']) {
        const samples = results.scenarios
          .filter((s) => s.variant === variant.name && s.references === count)
          .flatMap((s) => s.samples.filter((x) => x.phase === phase));
        if (!samples.length) continue;
        results.summaries.push({
          variant: variant.name,
          references: count,
          phase,
          completedRuns: samples.length,
          medianP50: median(samples.map((s) => s.p50)),
          medianP95: median(samples.map((s) => s.p95)),
          p95Range: [
            Math.min(...samples.map((s) => s.p95)),
            Math.max(...samples.map((s) => s.p95)),
          ],
          max: Math.max(...samples.map((s) => s.max)),
        });
      }
}
for (let run = 0; run < runs; run++)
  for (const count of counts) {
    // Reverse every second run to avoid assigning warm-up/thermal drift to one build.
    for (const variant of run % 2 ? [...variants].reverse() : variants) {
      const fixture = structuredClone(files);
      const home = fixture.find((file) => file.frame?.id === 'board-root');
      if (!home) throw new Error('Project guide fixture is missing');
      const references = Object.values(home.cells).filter(
        (cell) => cell.kind === 'frame-reference',
      );
      if (references.length !== 9)
        throw new Error('Project guide must contain nine references');
      if (count === 1) {
        home.frame.children = [references[0].id];
        home.cells = { [references[0].id]: references[0] };
      }
      if (count === 36) {
        home.frame.name = 'Frame performance · 36';
        home.frame.content = { label: home.frame.name };
        for (let index = 0; index < 36; index++) {
          const original = references[index % references.length];
          const id = index < 9 ? original.id : `perf:reference:${index}`;
          home.cells[id] = {
            ...structuredClone(original),
            id,
            geometry: {
              x: (index % 6) * 1010,
              y: 842 + Math.floor(index / 6) * 750,
              width: 940,
              height: 520,
            },
          };
          if (index >= 9) home.frame.children.push(id);
        }
      }
      let browser, desktop, directory, page;
      let desktopOutput = '';
      const stem =
        output.replace(/\.json$/, '') + `-${variant.name}-${count}-${run + 1}`;
      try {
        if (platform === 'desktop') {
          directory = await mkdtemp(path.join(tmpdir(), 'verd-frame-perf-'));
          const workspace = path.join(directory, 'workspace');
          await cp(fixtureDir, workspace, {
            recursive: true,
            filter: (filename) =>
              !path
                .relative(fixtureDir, filename)
                .split(path.sep)
                .includes('.verdboard'),
          });
          await writeFile(
            path.join(workspace, '项目导览.verd.json'),
            JSON.stringify(home),
          );
          const launcher = path.join(directory, 'launch.cjs');
          await writeFile(
            launcher,
            `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'user-data'))});require(${JSON.stringify(path.resolve(variant.desktopEntry))});`,
          );
          const env = {
            ...process.env,
            VERDBOARD_WORKSPACE_PATH: workspace,
            VERDBOARD_USER_DATA_PATH: path.join(directory, 'user-data'),
          };
          delete env.ELECTRON_RUN_AS_NODE;
          delete env.VITE_DEV_SERVER_URL;
          desktop = await electron.launch({
            args: [launcher],
            env,
            ...(variant.electronExecutable
              ? { executablePath: variant.electronExecutable }
              : {}),
          });
          const collect = (bytes) => {
            desktopOutput = (desktopOutput + bytes).slice(-65536);
          };
          desktop.process().stdout?.on('data', collect);
          desktop.process().stderr?.on('data', collect);
          page = await desktop.firstWindow();
          await desktop.evaluate(({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.setContentSize(size.width, size.height);
            win.show();
            win.focus();
          }, results.requestedViewport);
        } else {
          browser = await chromium.launch({ headless: !headed });
          page = await browser.newPage(
            headed
              ? { viewport: null }
              : {
                  viewport: results.requestedViewport,
                  deviceScaleFactor: dpr,
                },
          );
          if (headed) {
            const session = await browser.newBrowserCDPSession();
            const target = await page.context().newCDPSession(page);
            const { targetInfo } = await target.send('Target.getTargetInfo');
            const { windowId } = await session.send(
              'Browser.getWindowForTarget',
              { targetId: targetInfo.targetId },
            );
            const chrome = await page.evaluate(() => ({
              width: window.outerWidth - window.innerWidth,
              height: window.outerHeight - window.innerHeight,
              dpr: window.devicePixelRatio,
            }));
            if (args.includes('--dpr') && chrome.dpr !== dpr)
              throw new Error(
                `Headed mode keeps native DPR ${chrome.dpr}; requested ${dpr}`,
              );
            await session.send('Browser.setWindowBounds', {
              windowId,
              bounds: {
                windowState: 'normal',
                left: 0,
                top: 30,
                width: width + chrome.width,
                height: height + chrome.height,
              },
            });
            await target.detach();
            await session.detach();
          }
          await page.goto(variant.url);
          await page.bringToFront();
        }
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.locator('.workspace-shell').waitFor();
        const skip = page.getByRole('button', { name: '跳过', exact: true });
        if (await skip.isVisible()) await skip.click();
        if (platform === 'web')
          await page
            .locator(
              'input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]',
            )
            .setInputFiles({
              name: 'performance.verd.json',
              mimeType: 'application/json',
              buffer: Buffer.from(
                JSON.stringify({
                  format: 'verd-canvas-bundle',
                  version: 1,
                  rootFileId: home.frame.id,
                  files: fixture,
                }),
              ),
            });
        // Import publishes files before its navigation/session update finishes.
        // Keep that startup work outside every input sample.
        await page.waitForTimeout(500);
        await page
          .locator('.file-tree-name')
          .filter({ hasText: home.frame.name })
          .first()
          .click();
        await page.locator(canvas).waitFor({ state: 'visible' });
        await page
          .locator(active)
          .getByTestId('canvas-status-fit')
          .evaluate((button) => button.click());
        await page.waitForFunction(
          ({ active, count }) =>
            document.querySelectorAll(
              `${active} svg[data-surface="nested"], ${active} [data-reference-preview] [data-frame-content-id]`,
            ).length >= count,
          { active, count },
          { timeout: 45000 },
        );
        await page.waitForFunction(
          (size) =>
            window.innerWidth === size.width &&
            window.innerHeight === size.height,
          results.requestedViewport,
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((img) => img.decode().catch(() => {})),
          );
        });
        const status = page.locator(`${active} [data-testid="save-status"]`);
        if (await status.count())
          await status.first().filter({ visible: true }).waitFor();
        await page.waitForFunction(
          ({ active }) => {
            const status = document.querySelector(
              `${active} [data-testid="save-status"]`,
            );
            return (
              !status || status.getAttribute('data-save-state') === 'saved'
            );
          },
          { active },
        );
        await page.waitForTimeout(1000);
        await drain(page);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
        // Use trusted mouse input throughout dragging. Mixing a native down with
        // untrusted pointer moves can lose capture in a headed browser.
        await page.exposeBinding('__verdPerfDragMove', (_source, point) =>
          cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: point.x,
            y: point.y,
            button: 'left',
            buttons: 1,
            pointerType: 'mouse',
          }),
        );
        let runtime;
        if (desktop)
          runtime = await desktop.evaluate(
            async ({ app, BrowserWindow, screen }) => ({
              versions: process.versions,
              gpuFeatureStatus: app.getGPUFeatureStatus(),
              gpu: await app.getGPUInfo('basic'),
              contentBounds:
                BrowserWindow.getAllWindows()[0].getContentBounds(),
              displayScaleFactor: screen.getDisplayMatching(
                BrowserWindow.getAllWindows()[0].getBounds(),
              ).scaleFactor,
            }),
          );
        else {
          const session = await browser.newBrowserCDPSession();
          const gpu = await session.send('SystemInfo.getInfo');
          runtime = {
            browser: browser.version(),
            gpuFeatureStatus: gpu.gpu.featureStatus,
            gpuDevices: gpu.gpu.devices,
          };
          await session.detach();
        }
        const viewport = await page.evaluate(
          (canvas) => ({
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio,
            visualViewportScale: window.visualViewport?.scale,
            visualViewport: {
              width: window.visualViewport?.width,
              height: window.visualViewport?.height,
            },
            outerWindow: {
              width: window.outerWidth,
              height: window.outerHeight,
            },
            screen: {
              width: window.screen.width,
              height: window.screen.height,
              availableWidth: window.screen.availWidth,
              availableHeight: window.screen.availHeight,
            },
            canvas: document
              .querySelector(canvas)
              .getBoundingClientRect()
              .toJSON(),
          }),
          canvas,
        );
        let screenshot;
        if (run === 0) {
          const bytes = await page.screenshot({
            path: stem + '.png',
            scale: 'device',
          });
          screenshot = {
            path: stem + '.png',
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
          };
        }
        if (tracing) {
          await page.evaluate((selector) => {
            const root = document.querySelector(selector);
            const original = SVGSVGElement.prototype.getBoundingClientRect;
            window.__verdViewportReads = 0;
            SVGSVGElement.prototype.getBoundingClientRect = function (...args) {
              if (this === root) window.__verdViewportReads++;
              return original.apply(this, args);
            };
          }, canvas);
          await cdp.send('Tracing.start', {
            categories: 'devtools.timeline,blink,cc,blink.user_timing',
            transferMode: 'ReturnAsStream',
            streamFormat: 'json',
          });
        }
        const scenario = {
          variant: variant.name,
          run: run + 1,
          references: count,
          viewport,
          runtime,
          screenshot,
          elements: await page.locator(`${active} *`).count(),
          embeddedEditors: await page
            .locator(`${active} svg[data-surface="nested"]`)
            .count(),
          staticPreviews: await page
            .locator(`${active} [data-reference-preview]`)
            .count(),
          samples: [],
          errors,
        };
        for (const phase of ['zoom', 'pan', 'drag']) {
          await mark(page, `verd-perf:${phase}:settle`);
          await page
            .locator(active)
            .getByTestId('canvas-status-fit')
            .evaluate((button) => button.click());
          await page.waitForTimeout(300);
          await drain(page);
          let start;
          if (phase === 'drag') {
            const header = page
              .locator(
                `${canvas} [data-cell-kind="frame-reference"] [data-frame-header] rect`,
              )
              .first();
            // Retain the actual native pointer identity across Chromium versions.
            const bounds = await header.boundingBox();
            start = {
              x: bounds.x + bounds.width / 2,
              // Stay outside the title's double-click rename target.
              y: bounds.y + bounds.height - Math.min(0.8, bounds.height / 8),
            };
            await page.evaluate(() => {
              window.__verdPerfPointer = null;
              document.addEventListener(
                'pointerdown',
                (event) => {
                  window.__verdPerfPointer = {
                    id: event.pointerId,
                    target: event.target
                      .closest('[data-cell-kind]')
                      ?.getAttribute('data-cell-id'),
                  };
                },
                { capture: true, once: true },
              );
            });
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await drain(page);
            start.pointer = await page.evaluate(() => window.__verdPerfPointer);
            if (!start.pointer)
              throw new Error('Native drag pointerdown was not delivered');
          }
          const before = await metrics(cdp);
          const readsBefore = tracing
            ? await page.evaluate(() => window.__verdViewportReads)
            : 0;
          await mark(page, `verd-perf:${phase}:start`);
          const sample = await page.evaluate(
            async ({ canvas, phase, start }) => {
              const svg = document.querySelector(canvas),
                rect = svg.getBoundingClientRect();
              const header = svg.querySelector(
                  '[data-cell-kind="frame-reference"] [data-frame-header] rect',
                ),
                bounds = header.getBoundingClientRect();
              const x = phase === 'drag' ? start.x : rect.x + rect.width / 2;
              const y = phase === 'drag' ? start.y : rect.y + rect.height / 2;
              const intervals = [];
              const moves = [];
              let previous,
                lastDx = 0;
              for (let index = 0; index <= 90; index++) {
                await new Promise(requestAnimationFrame);
                const now = performance.now();
                if (previous !== undefined) intervals.push(now - previous);
                previous = now;
                if (index === 90) break;
                const direction = Math.floor(index / 30) % 2 ? -1 : 1;
                if (phase === 'drag') {
                  lastDx = 30 * Math.sin(index / 15);
                  // Keep one input per animation frame; protocol acknowledgement
                  // must not impose its own lower frame-rate ceiling.
                  moves.push(window.__verdPerfDragMove({ x: x + lastDx, y }));
                } else
                  svg.dispatchEvent(
                    new WheelEvent('wheel', {
                      bubbles: true,
                      cancelable: true,
                      ctrlKey: phase === 'zoom',
                      deltaY: direction * 6,
                      clientX: x,
                      clientY: y,
                    }),
                  );
              }
              await Promise.all(moves);
              const sorted = [...intervals].sort((a, b) => a - b);
              return {
                p50: sorted[45],
                p95: sorted[85],
                max: sorted.at(-1),
                over50: intervals.filter((x) => x > 50).length,
                intervals,
                lastDx,
                ...(phase === 'drag'
                  ? { movedPixels: header.getBoundingClientRect().x - bounds.x }
                  : {}),
              };
            },
            { canvas, phase, start },
          );
          await drain(page);
          await mark(page, `verd-perf:${phase}:end`);
          scenario.samples.push({
            phase,
            ...sample,
            ...(tracing
              ? {
                  viewportRectReads:
                    (await page.evaluate(() => window.__verdViewportReads)) -
                    readsBefore,
                }
              : {}),
            metrics: delta(before, await metrics(cdp)),
          });
          if (phase === 'drag') {
            if (Math.abs(sample.movedPixels) < 1) {
              await page.screenshot({ path: stem + '-failed-drag.png' });
              await writeFile(
                stem + '-failed-drag.json',
                JSON.stringify({ start, sample, scenario }, null, 2),
              );
              throw new Error('Drag did not move its reference shell');
            }
            const before = await metrics(cdp);
            await mark(page, 'verd-perf:drag-commit:start');
            const time = await page.evaluate(() => performance.now());
            await page.mouse.move(start.x + sample.lastDx, start.y);
            await page.mouse.up();
            await drain(page);
            await page.waitForFunction(
              ({ active }) => {
                const status = document.querySelector(
                  `${active} [data-testid="save-status"]`,
                );
                return (
                  !status ||
                  ['saved', 'idle'].includes(
                    status.getAttribute('data-save-state'),
                  )
                );
              },
              { active },
            );
            const elapsed =
              (await page.evaluate(() => performance.now())) - time;
            await mark(page, 'verd-perf:drag-commit:end');
            scenario.samples.push({
              phase: 'drag-commit',
              p50: elapsed,
              p95: elapsed,
              max: elapsed,
              metrics: delta(before, await metrics(cdp)),
            });
          }
          console.log(
            JSON.stringify({
              platform,
              variant: variant.name,
              run: run + 1,
              references: count,
              phase,
              p50: sample.p50,
              p95: sample.p95,
            }),
          );
        }
        if (tracing) {
          const completed = new Promise((resolve) =>
            cdp.once('Tracing.tracingComplete', resolve),
          );
          await cdp.send('Tracing.end');
          const { stream, dataLossOccurred } = await completed;
          let trace = '';
          for (;;) {
            const part = await cdp.send('IO.read', { handle: stream });
            trace += part.data;
            if (part.eof) break;
          }
          await cdp.send('IO.close', { handle: stream });
          await writeFile(stem + '.trace.json', trace);
          scenario.trace = stem + '.trace.json';
          scenario.traceDataLossOccurred = dataLossOccurred ?? false;
        }
        if (errors.length) throw new Error(errors.join('\n'));
        results.scenarios.push(scenario);
        summarize();
        await writeFile(output, JSON.stringify(results, null, 2) + '\n');
      } catch (error) {
        if (desktopOutput)
          await writeFile(stem + '-failure.log', desktopOutput);
        if (page && !page.isClosed()) {
          await page
            .screenshot({ path: stem + '-failure.png' })
            .catch(() => {});
          await writeFile(stem + '-failure.html', await page.content()).catch(
            () => {},
          );
        }
        throw error;
      } finally {
        await desktop?.close();
        await browser?.close();
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  }
