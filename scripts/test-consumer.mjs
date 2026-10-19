import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publicPackages, packPublicPackages } from './pack-public.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verd-consumer-'));

// Each run has its own outside-repository install; no source aliases are used.
if (!process.env.VERD_CONSUMER_REACT) {
  for (const major of ['18', '19']) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url)],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, VERD_CONSUMER_REACT: major },
      },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}
const react19 = process.env.VERD_CONSUMER_REACT === '19';
const fromRegistry = process.env.VERD_CONSUMER_SOURCE === 'registry';
const packages = fromRegistry
  ? publicPackages.map(({ pkg }) => ({ name: pkg.name, version: pkg.version }))
  : packPublicPackages(path.join(tmp, 'tarballs'));
const packageDependencies = Object.fromEntries(
  packages.map((pkg) => [
    pkg.name,
    fromRegistry ? pkg.version : `file:${pkg.archive}`,
  ]),
);
// The overrides bind transitive @sue dependencies to the same real archives before
// publication. Their original packed semver ranges are checked by packPublicPackages.
const overrides = fromRegistry ? {} : packageDependencies;
const registryConfig = fs
  .readFileSync(path.join(root, '.npmrc'), 'utf8')
  .split('\n')
  .filter((line) => /^(registry|@sue:registry|@ylib:registry)=/.test(line))
  .join('\n');
fs.writeFileSync(path.join(tmp, '.npmrc'), registryConfig + '\n');
console.log(
  `Consumer: React ${react19 ? '19' : '18'}, ${fromRegistry ? 'Aliyun registry' : 'pnpm tarballs'}, ${tmp}`,
);

const appDir = path.join(tmp, 'app');
fs.mkdirSync(appDir);
fs.writeFileSync(
  path.join(tmp, 'pnpm-workspace.yaml'),
  `packages:
  - app
allowBuilds:
  esbuild: true
minimumReleaseAgeExclude:
  - '@sue/*'
overrides: ${JSON.stringify(overrides)}
`,
);
fs.writeFileSync(
  path.join(tmp, 'package.json'),
  JSON.stringify(
    {
      name: 'consumer-workspace',
      private: true,
      devDependencies: {
        '@types/react': react19 ? '19.2.2' : '^18.3.12',
        '@types/react-dom': react19 ? '19.2.2' : '^18.3.1',
      },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'consumer-app',
      private: true,
      type: 'module',
      scripts: { build: 'vite build' },
      dependencies: {
        ...packageDependencies,
        react: react19 ? '19.2.0' : '18.3.1',
        'react-dom': react19 ? '19.2.0' : '18.3.1',
      },
      devDependencies: {
        '@types/react': react19 ? '19.2.2' : '^18.3.12',
        '@types/react-dom': react19 ? '19.2.2' : '^18.3.1',
        '@vitejs/plugin-react': '^4.3.4',
        typescript: '^5.6.3',
        jsdom: '22.1.0',
        vite: '^5.4.11',
      },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(appDir, 'vite.config.ts'),
  `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
`,
);
fs.writeFileSync(
  path.join(appDir, 'index.html'),
  `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
);
fs.mkdirSync(path.join(appDir, 'src'));
fs.writeFileSync(
  path.join(appDir, 'src/main.tsx'),
  `import React from 'react';
import { createRoot } from 'react-dom/client';
import { verifyReleaseExamples } from './release-examples';
import * as core from '@sue/board-core';
import * as mind from '@sue/board-mind';
import * as workflow from '@sue/board-workflow';
import * as architecture from '@sue/board-architecture';
import { createCellRegistry, createCellRuntime, type FrameSnapshot } from '@sue/board-core';
import { createInlineText, type TextEditorProps } from '@sue/board-common';
import { createGeometryCell, registerDrawCells } from '@sue/board-draw';
import { LineText } from '@sue/board-react-text';
import { VerdFrame, MyPage, WorkspaceSettings, FileTree, ChartLibrary, type VerdFrameProps, type MyPageProps, type WorkspaceSettingsProps, type FileTreeProps, type ChartLibraryProps } from '@sue/verd-board-ui';
import '@sue/verd-board-ui/style.css';
import { WorkspaceApp, type StorageAdapter } from '@sue/verd-board-app';
import { parseMarkdownToFrameSnapshot } from '@sue/board-markdown-to-board';
import { parseMermaidToFrameSnapshot } from '@sue/board-mermaid-to-board';
import { FrameCanvas, frameSnapshotToImage, type FrameCanvasController, type FrameImageOptions, type FrameCanvasProps } from '@sue/board-react';
import { createMindFrameSnapshot } from '@sue/board-mind';
import { createMindFrameExtensions } from '@sue/board-react-mind';
import { createWorkflowFrameExtensions } from '@sue/board-react-workflow';
import { createUmlFrameExtensions } from '@sue/board-react-uml';
import { createUmlSequenceFrameSnapshot, createUmlParticipantCell, addUmlCell } from '@sue/board-uml';
import { createArchitectureFrameExtensions } from '@sue/board-react-architecture';
if (['Board', 'BoardElement', 'BoardOperation', 'Transforms'].some(name => name in core)) throw new Error('Legacy core API is still exported');
if (['mindDocumentToStore', 'withMind'].some(name => name in mind) || 'workflowDocumentToStore' in workflow || 'architectureDocumentToStore' in architecture) throw new Error('Legacy domain API is still exported');
if (![createGeometryCell, registerDrawCells, LineText, VerdFrame, MyPage, WorkspaceSettings, FileTree, ChartLibrary, WorkspaceApp, parseMarkdownToFrameSnapshot, parseMermaidToFrameSnapshot].every(Boolean)) throw new Error('A native public package entry is missing');
const textProps: TextEditorProps = { text: createInlineText('Consumer topic'), onChange: ({ newText }) => { if (!newText.plainText) throw new Error('Text change is missing'); } };
const registry = createCellRegistry();
const extensions = [...createMindFrameExtensions(registry), ...createWorkflowFrameExtensions(registry), ...createArchitectureFrameExtensions(registry), ...createUmlFrameExtensions(registry)];
const umlSnapshot = createUmlSequenceFrameSnapshot('uml-consumer', 'uml-root');
const umlRuntime = createCellRuntime(umlSnapshot, registry);
umlRuntime.transact({id:'uml-add',operations:addUmlCell(umlRuntime.store,'uml-consumer',createUmlParticipantCell('uml-user'))});
if (!umlRuntime.store.cells['uml-user']) throw new Error('UML public API missing');
const value = createMindFrameSnapshot('consumer-frame', 'consumer-center');
const runtime = createCellRuntime(value, registry);
const routing: core.EdgeRoutingContext = core.createEdgeRoutingContext(value.store, value.store.rootId);
core.createEdgeRoutingContext(value.store, value.store.rootId, undefined, routing);
const avoiding: core.OrthogonalRoutingResult = core.routeOrthogonalAvoiding([0, 25], 'right', [200, 25], 'left', [{ id: 'barrier', x: 80, y: 0, width: 40, height: 50 }]);
if (avoiding.status !== 'routed' || !avoiding.points.some(point => point[1] < 0 || point[1] > 50)) throw new Error('Shared obstacle avoidance is missing');
const routePoints: core.Point[] = core.edgeRoutePoints({ id: 'consumer-route', kind: 'arrow', cellType: 'edge', source: { point: [0, 0] }, target: { point: [200, 0] }, route: { mode: 'auto' } }, { point: [0, 0], side: 'right' }, { point: [200, 0], side: 'left' }, routing);
if (routePoints.length !== 2 || !core.frameContentBounds(value.store, value.store.rootId, routing)) throw new Error('Shared routing API is missing');
if (!FrameCanvas || !frameSnapshotToImage || !runtime.store.cells['consumer-center']) throw new Error('Cell/Frame API is missing');
const standardProps: FrameCanvasProps = { value, onChange: ({snapshot, transaction}) => { if (!snapshot.store || !transaction.id) throw new Error('Invalid change'); } };
const hostProps: FrameCanvasProps<{ snapshot: FrameSnapshot }> = { value: {snapshot: value}, adapter: { toFrameSnapshot: host => host.snapshot }, onIntent: async () => ({status: 'accepted'}), history: { undo() {}, redo() {} } };
const productProps: VerdFrameProps = { value, frameId: value.store.rootId, onChange() {}, onOpenFrame() {} };
const storage: StorageAdapter = { async listKeys() { return []; }, async getItem() { return null; }, async setItem() {}, async removeItem() {} };
const myProps: MyPageProps = { onBack() {} };
const workspaceSettingsProps: WorkspaceSettingsProps = {
  config: {}, defaultName: 'Consumer', onConfig() {}, onBack() {},
  trash: { entries: [], workspaceName: 'Consumer', onRestore() {}, async onPurge() {} },
};
const fileTreeProps: FileTreeProps = {
  entries: [], canvases: [], expandedDirs: [], onToggleDir() {}, onOpenFile() {}, onCreateCanvas() {}, onTrash() {},
  revealFile: { fileId: 'chart', nonce: 1 }, onRevealFile() {},
};
const libraryProps: ChartLibraryProps = {
  rows: [{ frameId: 'chart', name: 'Chart', path: 'charts/chart.verd.json', diagram: 'mind', placement: 'owned', ownerFrameId: 'board', referenceLabel: '' }],
  owners: [{ frameId: 'board', name: 'Board' }], onOpen() {}, onBack() {},
  onChangeOrganization(_id, organization) { if (organization.kind === 'subgraph') void organization.ownerFrameId; },
};
void [textProps, standardProps, hostProps, productProps, storage, myProps, workspaceSettingsProps, fileTreeProps, libraryProps];
const canvas = React.createRef<FrameCanvasController>();
const hostCanvas = React.createRef<FrameCanvasController>();
const transfer: (() => Promise<import('@sue/board-react').FrameIntentResult> | undefined) = () => canvas.current?.moveSelection('consumer-target');
void transfer;
const exportOptions: FrameImageOptions = { format: 'svg', padding: 20, ids: ['consumer-center'] };
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(String(event.message)));
function ConsumerHarness() {
  const [snapshot, setSnapshot] = React.useState(value);
  const [hostStatus, setHostStatus] = React.useState('accepted');
  const [log, setLog] = React.useState('ready');
  const [intentResult, setIntentResult] = React.useState('none');
  const history = React.useRef({
    undo() {
      setLog('undo');
    },
    redo() {
      setLog('redo');
    },
  });
  const label = (snapshot.store.cells['consumer-center'] as { content?: { label?: string } }).content?.label ?? '';
  return (
    <div style={{ height: 640 }} data-testid="consumer-root">
      <p data-testid="status">{log}</p>
      <p data-testid="label">{label}</p>
      <p data-testid="errors">{errors.join('|')}</p>
      <p data-testid="host-status">{hostStatus}</p>
      <p data-testid="intent-result">{intentResult}</p>
      <button data-testid="dispatch-intent" onClick={() => {
        const cell = snapshot.store.cells['consumer-center'];
        if (cell.cellType !== 'node') throw new Error('Missing host topic');
        void hostCanvas.current?.dispatch({ id: crypto.randomUUID(), operations: [{ type: 'replace_cell', cell: { ...cell, content: { ...cell.content, label: 'Host edit' } } }] }).then(result => setIntentResult(result.status));
      }}>Dispatch intent</button>
      <button data-testid="rename" onClick={() => {
        const next = structuredClone(snapshot);
        const cell = next.store.cells['consumer-center'] as { content?: { label?: string } };
        cell.content = { ...(cell.content ?? {}), label: 'Edited topic' };
        setSnapshot(next);
        setLog('edited');
      }}>Rename</button>
      <button data-testid="reject" onClick={() => setHostStatus('rejected')}>Reject</button>
      <button data-testid="accept" onClick={() => setHostStatus('accepted')}>Accept</button>
      <button data-testid="undo" onClick={() => history.current.undo()}>Undo</button>
      <button data-testid="export" onClick={() => void canvas.current?.exportImage(exportOptions).then(() => setLog('exported'), (error) => errors.push(String(error)))}>Export frame</button>
      <FrameCanvas ref={canvas} value={snapshot} registry={registry} extensions={extensions} onChange={({ snapshot: next }) => setSnapshot(next)} />
      <FrameCanvas ref={hostCanvas} value={{ snapshot }} adapter={{ toFrameSnapshot: (host) => host.snapshot }} onIntent={async transaction => {
        if (hostStatus === 'rejected') return { status: 'rejected' };
        setSnapshot(current => ({ store: core.applyCellOperations(current.store, transaction.operations, registry) }));
        return { status: 'accepted' };
      }} history={history.current} />
    </div>
  );
}
verifyReleaseExamples().then(() => { document.documentElement.dataset.releaseExamples = 'passed'; }, error => { errors.push(String(error)); document.documentElement.dataset.releaseExamples = 'failed'; document.documentElement.dataset.releaseError = String(error); });
createRoot(document.getElementById('root')!).render(<ConsumerHarness />);
`,
);

fs.copyFileSync(
  path.join(root, 'tests/consumer/src/release-examples.tsx'),
  path.join(appDir, 'src/release-examples.tsx'),
);
let snippetId = 0;
for (const file of [
  path.join(root, 'README.md'),
  ...publicPackages.map(({ directory }) => path.join(directory, 'README.md')),
]) {
  if (!fs.existsSync(file)) continue;
  const readme = fs.readFileSync(file, 'utf8');
  for (const match of readme.matchAll(
    /<!-- consumer-example -->\s*```(tsx?|jsx?)\n([^]*?)```/g,
  )) {
    fs.writeFileSync(
      path.join(appDir, `src/readme-${snippetId++}.${match[1]}`),
      match[2] + '\nexport {};\n',
    );
  }
}
console.log(`Typechecking ${snippetId} published README examples`);

fs.writeFileSync(
  path.join(appDir, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['src'],
    },
    null,
    2,
  ),
);

const install = spawnSync(
  'pnpm',
  ['install', '--config.ignore-scripts=false'],
  {
    cwd: tmp,
    stdio: 'inherit',
  },
);
if (install.status !== 0) {
  throw new Error('consumer install failed');
}
// Load both published entry conditions with a DOM, as product packages target browsers.
fs.writeFileSync(
  path.join(appDir, 'entry-smoke.mjs'),
  `
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'navigator', 'customElements', 'CustomEvent'])
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
const require = createRequire(import.meta.url);
for (const name of ${JSON.stringify(packages.map((pkg) => pkg.name))}) {
  const entry = process.argv[2] === 'esm' ? await import(name) : require(name);
  if (!Object.keys(entry).length) throw new Error(name + ' has no runtime exports');
}
dom.window.close();
console.log(process.argv[2] + ': all public package entries loaded');
`,
);
for (const format of ['esm', 'cjs']) {
  const smoke = spawnSync(process.execPath, ['entry-smoke.mjs', format], {
    cwd: appDir,
    stdio: 'inherit',
  });
  if (smoke.status !== 0)
    throw new Error(`Consumer ${format} entry check failed`);
}
const typecheck = spawnSync(
  'pnpm',
  [
    '--filter',
    'consumer-app',
    'exec',
    'tsc',
    '--noEmit',
    '-p',
    'tsconfig.json',
  ],
  { cwd: tmp, stdio: 'inherit' },
);
if (typecheck.status !== 0) throw new Error('consumer typecheck failed');
const build = spawnSync('pnpm', ['--filter', 'consumer-app', 'build'], {
  cwd: tmp,
  stdio: 'inherit',
});
if (build.status !== 0) {
  throw new Error('consumer build failed');
}
console.log('isolated consumer build passed at', tmp);
const consumerPort = process.env.VERD_CONSUMER_PORT ?? '4175';
const consumerUrl = `http://127.0.0.1:${consumerPort}`;
const preview = spawn(
  process.execPath,
  [
    path.join(appDir, 'node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    consumerPort,
    '--strictPort',
  ],
  { cwd: appDir, stdio: 'ignore' },
);
const ready = Date.now();
while (Date.now() - ready < 20_000) {
  try {
    const response = await fetch(consumerUrl);
    if (response.ok) break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
const { chromium } = await import('@playwright/test');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(consumerUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () =>
      ['passed', 'failed'].includes(
        globalThis.document.documentElement.dataset.releaseExamples ?? '',
      ),
    undefined,
    { timeout: 30_000 },
  );
  const releaseError = await page.evaluate(
    () => globalThis.document.documentElement.dataset.releaseError,
  );
  if (releaseError) throw new Error(releaseError);
  await page.getByTestId('rename').click();
  await page.getByTestId('label').filter({ hasText: 'Edited topic' }).waitFor();
  await page.getByTestId('undo').click();
  await page.getByTestId('status').filter({ hasText: 'undo' }).waitFor();
  await page.getByTestId('reject').click();
  await page
    .getByTestId('host-status')
    .filter({ hasText: 'rejected' })
    .waitFor();
  await page.getByTestId('dispatch-intent').click();
  await page
    .getByTestId('intent-result')
    .filter({ hasText: 'rejected' })
    .waitFor();
  await page.getByTestId('label').filter({ hasText: 'Edited topic' }).waitFor();
  await page.getByTestId('accept').click();
  await page.getByTestId('dispatch-intent').click();
  await page
    .getByTestId('intent-result')
    .filter({ hasText: 'accepted' })
    .waitFor();
  await page.getByTestId('label').filter({ hasText: 'Host edit' }).waitFor();
  await page.getByTestId('export').click();
  await page.getByTestId('status').filter({ hasText: 'exported' }).waitFor();
  const styled = await page.evaluate(
    () =>
      globalThis.getComputedStyle(globalThis.document.body).fontFamily.length >
      0,
  );
  if (!styled) throw new Error('consumer styles did not apply');
  const reported = await page.getByTestId('errors').innerText();
  if (reported || pageErrors.length)
    throw new Error(reported || pageErrors.join('\n'));
  console.log('isolated consumer browser runtime passed');
} finally {
  await browser?.close();
  preview.kill();
}
