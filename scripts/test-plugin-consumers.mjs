/* global window, document */
import fs from 'node:fs';
import {
  readSchemaArtifacts,
  schemaRuntimePackages,
} from './schema-artifacts.mjs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { publicPackages, packPublicPackages, root } from './pack-public.mjs';
import { chromium } from '@playwright/test';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verd-plugin-consumers-'));
const packed = packPublicPackages(path.join(temp, 'tarballs'));
const manifests = new Map(publicPackages.map(({ pkg }) => [pkg.name, pkg]));
const archives = new Map(
  packed.map((pkg) => [pkg.name, `file:${pkg.archive}`]),
);
const schemaArtifacts = readSchemaArtifacts();
const domains = ['draw', 'mind', 'workflow', 'architecture', 'uml'];
function run(args, cwd) {
  const result = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(temp, 'npm-cache') },
  });
  if (result.status !== 0)
    throw new Error(
      `pnpm ${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}
const registryConfig = fs
  .readFileSync(path.join(root, '.npmrc'), 'utf8')
  .split('\n')
  .filter((line) => /^(registry|@sue:registry|@ylib:registry)=/.test(line))
  .join('\n');
const consumerExamples = {
  draw: {
    factory: 'createFrameCell',
    setup: "{ store: createCellStore(createFrameCell('frame')) }",
    tool: 'draw.shape',
  },
  mind: {
    factory: 'createMindFrameSnapshot',
    setup: "createMindFrameSnapshot('frame', 'topic')",
    tool: 'mind.root',
  },
  workflow: {
    factory: 'createWorkflowFrameSnapshot',
    setup: "createWorkflowFrameSnapshot('frame', 'start')",
    tool: 'workflow.task',
  },
  architecture: {
    factory: 'createArchitectureFrameSnapshot',
    setup: "createArchitectureFrameSnapshot('frame', 'layer')",
    tool: 'architecture.layer',
  },
  uml: {
    factory: 'createUmlClassFrameSnapshot',
    setup: "createUmlClassFrameSnapshot('frame', 'uml-root')",
    tool: 'uml.add',
  },
};
async function verifyDocumentActionsConsumer(major) {
  const direct = [
    '@sue/board-common',
    '@sue/board-react-actions',
    '@sue/board-react-text',
  ];
  const closure = new Set();
  const include = (name) => {
    if (closure.has(name)) return;
    closure.add(name);
    for (const dependency of Object.keys(
      manifests.get(name)?.dependencies ?? {},
    ))
      if (manifests.has(dependency)) include(dependency);
  };
  direct.forEach(include);
  assert.deepEqual(
    [...closure].sort(),
    [...direct].sort(),
    'Document/actions must not depend on the board renderer, core, product or diagram plugins',
  );
  const directory = path.join(temp, `document-actions-react-${major}`);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, '.npmrc'), registryConfig + '\n');
  fs.writeFileSync(
    path.join(directory, 'pnpm-workspace.yaml'),
    `packages: []\nallowBuilds:\n  esbuild: true\noverrides: ${JSON.stringify(Object.fromEntries([...closure].map((name) => [name, archives.get(name)])))}\n`,
  );
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify(
      {
        name: 'document-action-consumer',
        private: true,
        type: 'module',
        dependencies: {
          ...Object.fromEntries(
            direct.map((name) => [name, archives.get(name)]),
          ),
          react: major === '18' ? '18.3.1' : '19.2.0',
          'react-dom': major === '18' ? '18.3.1' : '19.2.0',
        },
        devDependencies: {
          typescript: '5.6.3',
          '@types/react': major === '18' ? '^18.3.12' : '19.2.2',
          '@types/react-dom': major === '18' ? '^18.3.1' : '19.2.2',
          vite: '5.4.21',
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        esModuleInterop: true,
      },
      include: ['*.tsx'],
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'main.tsx'),
    `
import React, { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createActionRegistry, createBlockText } from '@sue/board-common';
import { ActionScope, type ActionScopeValue } from '@sue/board-react-actions';
import { DocumentEditor, type DocumentEditorController } from '@sue/board-react-text';
import '@sue/board-react-actions/style.css';
import '@sue/board-react-text/style.css';
export function verifyTypedActionHandle() {
  const registry = createActionRegistry({ getContext: () => ({}) });
  const action = registry.register({
    id: 'typed.set-name', label: 'Set name', category: 'Types', effect: 'view',
    validateArgs: (args): args is { name: string } => !!args && typeof args === 'object' && 'name' in args && typeof args.name === 'string',
    beforeQueue: async (_context, args, execution) => {
      const name: string = args.name;
      const invocationId: number = execution.invocationId;
      if (!name || !invocationId) return { status: 'rejected', code: 'invalid-preparation' };
      return execution.checkpoint();
    },
    execute: (_context, args, execution) => {
      const invocationId: number = execution.invocationId;
      return args.name && invocationId ? { status: 'completed' } : { status: 'noop' };
    },
  });
  void action.execute({ name: 'Valid' });
  action.capture().getState({ name: 'Captured' });
  // @ts-expect-error Typed handles reject the wrong argument shape from published declarations.
  void action.execute({ name: 42 });
  // @ts-expect-error Capturing preserves required action arguments.
  void action.capture().execute();
}
function App() {
  const [value, setValue] = useState(() => createBlockText('Standalone document'));
  const controller = useRef<DocumentEditorController | null>(null);
  const scope = useRef<ActionScopeValue | null>(null);
  const actions = useMemo(() => {
    const registry = createActionRegistry({ getContext: () => ({ controller: controller.current }), refresh: captured => captured.controller === controller.current ? captured : null });
    registry.register({ id: 'document.heading', label: 'Heading level two', category: 'Document', effect: 'content', getState: context => ({ enabled: !!context.controller?.getActionState('document.set-heading', 2).enabled }), beforeQueue: context => context.controller?.flushEditing(), execute: context => context.controller!.executeAction('document.set-heading', 2) });
    registry.register({ id: 'document.internal', label: 'Hidden arguments', category: 'Document', effect: 'content', palette: false, validateArgs: (args): args is string => typeof args === 'string', execute: () => ({ status: 'completed' }) });
    registry.seal(); return registry;
  }, []);
  return <ActionScope registry={actions} language="en" onReady={value => { scope.current = value; }}>
    <button onClick={() => scope.current?.openPalette()}>Commands</button>
    <button onClick={() => scope.current?.openHelp()}>Shortcuts</button>
    <DocumentEditor value={value} autoFocus={false} onReady={value => { controller.current = value; actions.invalidate(); }} onChange={change => setValue(change.value)} />
  </ActionScope>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`,
  );
  fs.writeFileSync(
    path.join(directory, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>',
  );
  run(['install', '--ignore-scripts'], directory);
  for (const installed of fs
    .readdirSync(path.join(directory, 'node_modules/.pnpm'))
    .filter((name) => name.startsWith('@sue+'))) {
    const name = installed.split('@').slice(0, 2).join('@').replace('+', '/');
    assert(
      closure.has(name),
      `Document/actions installed unexpected package ${name}`,
    );
  }
  run(['exec', 'tsc', '-p', 'tsconfig.json'], directory);
  for (const [file, source] of [
    [
      'esm.mjs',
      direct.map((name) => `await import(${JSON.stringify(name)})`).join(';'),
    ],
    [
      'cjs.cjs',
      direct.map((name) => `require(${JSON.stringify(name)})`).join(';'),
    ],
  ]) {
    fs.writeFileSync(path.join(directory, file), source);
    const result = spawnSync(process.execPath, [file], {
      cwd: directory,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  run(['exec', 'vite', 'build'], directory);
  const server = spawn(
    process.execPath,
    [
      path.join(directory, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4187',
      '--strictPort',
    ],
    { cwd: directory, stdio: 'pipe' },
  );
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Document consumer server timed out')),
        15000,
      );
      server.stdout.on('data', (data) => {
        if (String(data).includes('4187')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      server.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Document consumer server exited ${code}`));
      });
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('http://127.0.0.1:4187');
    await page.getByText('Standalone document', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Commands', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    assert.equal(await palette.getByText('Hidden arguments').count(), 0);
    await palette
      .getByRole('option', { name: 'Heading level two Document' })
      .click();
    await page.locator('.board-document-content h2').waitFor();
    await page.getByRole('button', { name: 'Commands', exact: true }).focus();
    await page.keyboard.press('Control+Shift+P');
    await palette.waitFor();
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
    assert.equal(errors.length, 0, errors.join('\n'));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    if (server.exitCode === null)
      await new Promise((resolve) => server.once('exit', resolve));
  }
  console.log(
    `Verified standalone document/actions: React ${major}, three direct packages, no board/core/product dependency, tarballs, strict declarations, ESM/CJS, CSS, palette capture, native document command and shortcut help`,
  );
}

try {
  for (const major of ['18', '19'])
    if (
      !process.env.VERD_PLUGIN_CONSUMER ||
      process.env.VERD_PLUGIN_CONSUMER === 'documents'
    )
      await verifyDocumentActionsConsumer(major);
  for (const major of ['18', '19'])
    for (const domain of domains.filter(
      (domain) =>
        !process.env.VERD_PLUGIN_CONSUMER ||
        process.env.VERD_PLUGIN_CONSUMER === domain,
    )) {
      const cap = domain[0].toUpperCase() + domain.slice(1);
      const direct = [
        '@sue/board-core',
        `@sue/board-${domain}`,
        '@sue/board-react',
        `@sue/board-react-${domain}`,
      ];
      const closure = new Set();
      function include(name) {
        if (closure.has(name)) return;
        closure.add(name);
        for (const dependency of Object.keys(
          manifests.get(name)?.dependencies ?? {},
        ))
          if (manifests.has(dependency)) include(dependency);
      }
      direct.forEach(include);
      for (const name of closure) {
        assert(
          !name.includes('verd-board') &&
            !name.includes('to-board') &&
            !name.includes('to-text'),
          `${domain}: product or converter dependency ${name}`,
        );
        for (const other of domains.filter((other) => other !== domain))
          assert(
            ![`@sue/board-${other}`, `@sue/board-react-${other}`].includes(
              name,
            ),
            `${domain}: sibling domain dependency ${name}`,
          );
      }
      const directory = path.join(temp, `${domain}-react-${major}`);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, '.npmrc'), registryConfig + '\n');
      fs.writeFileSync(
        path.join(directory, 'pnpm-workspace.yaml'),
        `packages: []\nallowBuilds:\n  esbuild: true\noverrides: ${JSON.stringify({ ...Object.fromEntries([...closure].map((name) => [name, archives.get(name)])), ...schemaArtifacts })}\n`,
      );
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify(
          {
            name: 'plugin-consumer',
            private: true,
            type: 'module',
            dependencies: {
              ...Object.fromEntries(
                direct.map((name) => [name, archives.get(name)]),
              ),
              react: major === '18' ? '18.3.1' : '19.2.0',
              'react-dom': major === '18' ? '18.3.1' : '19.2.0',
              'react-is': major === '18' ? '18.3.1' : '19.2.0',
            },
            devDependencies: {
              typescript: '5.6.3',
              '@types/react': major === '18' ? '^18.3.12' : '19.2.2',
              '@types/react-dom': major === '18' ? '^18.3.1' : '19.2.2',
              vite: '5.4.21',
            },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(directory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'react-jsx',
            strict: true,
            skipLibCheck: false,
            noEmit: true,
            lib: ['ES2022', 'DOM'],
            esModuleInterop: true,
          },
          include: ['*.tsx'],
        }),
      );
      const example = consumerExamples[domain];
      const commands = {
        draw: "[{ type: 'insert_cell' as const, parentId: 'frame', cell: engine.createGeometryCell(crypto.randomUUID(), 'rectangle', [[40, 40], [160, 100]]) }]",
        mind: "engine.addMindChild(store, 'topic', engine.createMindChildCell(crypto.randomUUID()), crypto.randomUUID())",
        workflow:
          "engine.addWorkflowTask(store, 'start', engine.createWorkflowTaskCell(crypto.randomUUID()))",
        architecture:
          "engine.addArchitectureModule(store, 'layer', engine.createArchitectureModuleCell(crypto.randomUUID()))",
        uml: "engine.addUmlCell(store, 'frame', engine.createUmlClassCell(crypto.randomUUID()))",
      };
      const readme = fs.readFileSync(
        path.join(root, 'packages/react', domain, 'README.md'),
        'utf8',
      );
      const documented = readme.match(
        /<!-- consumer-example -->\s*```tsx\s*([\s\S]*?)```/,
      );
      assert(documented, `${domain}: missing documented consumer example`);
      fs.writeFileSync(path.join(directory, 'readme.tsx'), documented[1]);
      fs.writeFileSync(
        path.join(directory, 'main.tsx'),
        `
import React, { StrictMode, useState, useEffect, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as core from '@sue/board-core';
import { createFrameCell, createCellStore, type FrameSnapshot, type CellOperation, type CellStore, type NodeCell } from '@sue/board-core';
import * as engine from '@sue/board-${domain}';
${domain === 'draw' ? '' : `import { ${example.factory} } from '@sue/board-${domain}';`}
import { FrameEditor, type FrameCanvasController } from '@sue/board-react';
import { create${cap}UIPlugin } from '@sue/board-react-${domain}';
import '@sue/board-react/style.css';
import '@sue/board-react-${domain}/style.css';
const plugins = [create${cap}UIPlugin()];
const controlled = createRef<FrameCanvasController>(), hosted = createRef<FrameCanvasController>();
let allowHost = false, lastId = '';
const operations = (store: CellStore): CellOperation[] => ${commands[domain]};
const browser = globalThis as typeof globalThis & { __consumer?: Record<string, (...args: never[]) => unknown> };
function App() {
  const [value, setValue] = useState<FrameSnapshot>(${example.setup});
  const [hostValue, setHostValue] = useState<FrameSnapshot>(${example.setup});
  useEffect(() => {
    browser.__consumer = {
      snapshot: () => JSON.stringify(controlled.current!.runtime.store),
      hostSnapshot: () => JSON.stringify(hosted.current!.runtime.store),
      add: async () => { const ops = operations(controlled.current!.runtime.store); lastId = ops.find(op => op.type === 'insert_cell' && op.cell.cellType === 'node')!.type === 'insert_cell' ? (ops.find(op => op.type === 'insert_cell' && op.cell.cellType === 'node') as Extract<CellOperation, { type: 'insert_cell' }>).cell.id : ''; return controlled.current!.dispatch({ id: crypto.randomUUID(), operations: ops }); },
      hostAdd: () => hosted.current!.dispatch({ id: crypto.randomUUID(), operations: operations(hosted.current!.runtime.store) }),
      allowHost: () => { allowHost = true; },
      edit: () => { const cell = controlled.current!.runtime.store.cells[lastId] as NodeCell; return controlled.current!.dispatch({ id: crypto.randomUUID(), operations: [{ type: 'replace_cell', cell: { ...cell, content: { ...cell.content, label: 'Consumer edited text' } } }] }); },
      clipboard: () => { const runtime = controlled.current!.runtime; const fragment = core.copyCellFragment(runtime.store, [lastId], runtime.registry); const plan = core.planCellPaste({ store: runtime.store, frameId: 'frame', selectionIds: [lastId], fragment, registry: runtime.registry, allocateId: () => crypto.randomUUID(), ${domain === 'mind' ? "targetCellId: 'topic'," : ''} }); return controlled.current!.dispatch({ id: crypto.randomUUID(), operations: plan.operations }); },
      undo: () => controlled.current!.executeAction('canvas.history.undo'), redo: () => controlled.current!.executeAction('canvas.history.redo'),
      actionState: () => controlled.current!.getActionState('canvas.view.fit'),
      action: () => controlled.current!.executeAction('canvas.view.fit'),
      image: async () => (await controlled.current!.exportImage({ format: 'svg' })).size,
    };
  }, [value, hostValue]);
  return <><div style={{height: 600}}><FrameEditor ref={controlled} plugins={plugins} value={value} language="en" autoFit={false} onChange={change => { setValue(change.snapshot); document.body.dataset.changed = 'yes'; }} /></div><div style={{height: 600}}><FrameEditor ref={hosted} plugins={plugins} value={{snapshot: hostValue}} adapter={{toFrameSnapshot: host => host.snapshot}} language="zh" autoFit={false} onIntent={async transaction => { if (!allowHost) return {status:'rejected',message:'Consumer host denied'}; setHostValue(current => ({store: core.applyCellOperations(current.store, transaction.operations, hosted.current!.runtime.registry)})); return {status:'accepted'}; }} /></div></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`,
      );
      fs.writeFileSync(
        path.join(directory, 'index.html'),
        '<div id="root" style="height:700px"></div><script type="module" src="/main.tsx"></script>',
      );
      run(['install', '--ignore-scripts'], directory);
      // The physical install must have exactly the approved internal closure.
      for (const installed of fs
        .readdirSync(path.join(directory, 'node_modules/.pnpm'))
        .filter((name) => name.startsWith('@sue+'))) {
        const name = installed
          .split('@')
          .slice(0, 2)
          .join('@')
          .replace('+', '/');
        assert(
          closure.has(name) || schemaRuntimePackages.has(name),
          `${domain}: unexpected installed package ${name}`,
        );
      }
      run(['exec', 'tsc', '-p', 'tsconfig.json'], directory);
      const imports = direct
        .map((name) => `await import(${JSON.stringify(name)})`)
        .join(';');
      const requires = direct
        .map((name) => `require(${JSON.stringify(name)})`)
        .join(';');
      // React text's CJS entry is evaluated in a DOM, as in the complete package consumer.
      fs.writeFileSync(path.join(directory, 'esm.mjs'), imports);
      fs.writeFileSync(path.join(directory, 'cjs.cjs'), requires);
      for (const file of ['esm.mjs', 'cjs.cjs']) {
        const result = spawnSync(process.execPath, [file], {
          cwd: directory,
          encoding: 'utf8',
        });
        if (result.status !== 0) throw new Error(result.stderr);
      }
      run(['exec', 'vite', 'build'], directory);
      const server = spawn(
        process.execPath,
        [
          path.join(directory, 'node_modules/vite/bin/vite.js'),
          'preview',
          '--host',
          '127.0.0.1',
          '--port',
          '4187',
          '--strictPort',
        ],
        { cwd: directory, stdio: 'pipe' },
      );
      let ready = '';
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Consumer server timed out')),
          15000,
        );
        server.stdout.on('data', (data) => {
          ready += data;
          if (ready.includes('4187')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        server.once('exit', (code) =>
          reject(new Error(`Consumer server exited ${code}`)),
        );
      });
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto('http://127.0.0.1:4187');
        await page.locator('[data-frame-editor]').first().waitFor();
        await page
          .locator(`[data-frame-tool="${example.tool}"]`)
          .first()
          .waitFor();
        assert.equal(errors.length, 0, errors.join('\n'));
        assert(
          await page
            .getByRole('button', { name: 'Export image', exact: true })
            .count(),
        );
        await page.waitForFunction(() => !!window.__consumer);
        const invoke = (method) =>
          page.evaluate((method) => window.__consumer[method](), method);
        assert.equal((await invoke('actionState')).enabled, true);
        assert.equal((await invoke('action')).status, 'completed');
        const before = await invoke('snapshot');
        assert.equal((await invoke('add')).status, 'accepted');
        await page.waitForFunction(
          () => document.body.dataset.changed === 'yes',
        );
        assert.notEqual(await invoke('snapshot'), before);
        assert.equal((await invoke('edit')).status, 'accepted');
        assert((await invoke('snapshot')).includes('Consumer edited text'));
        const beforeCopy = await invoke('snapshot');
        assert.equal((await invoke('clipboard')).status, 'accepted');
        const afterCopy = await invoke('snapshot');
        assert.notEqual(afterCopy, beforeCopy);
        await invoke('undo');
        assert.equal(await invoke('snapshot'), beforeCopy);
        await invoke('redo');
        assert.equal(await invoke('snapshot'), afterCopy);
        const hostBefore = await invoke('hostSnapshot');
        assert.equal((await invoke('hostAdd')).status, 'rejected');
        assert.equal(await invoke('hostSnapshot'), hostBefore);
        await invoke('allowHost');
        assert.equal((await invoke('hostAdd')).status, 'accepted');
        await page.waitForFunction(
          (before) => window.__consumer.hostSnapshot() !== before,
          hostBefore,
        );
        assert((await invoke('image')) > 100);
        assert.equal(errors.length, 0, errors.join('\n'));
      } finally {
        await browser?.close();
        server.kill('SIGTERM');
        if (server.exitCode === null)
          await new Promise((resolve) => server.once('exit', resolve));
      }
      console.log(
        `Verified ${domain}: React ${major}, four direct packages, tarballs, ESM/CJS, strict declarations, CSS, StrictMode, edits, clipboard, history, host rejection/acceptance and SVG export`,
      );
    }
} finally {
  if (!process.env.VERD_KEEP_CONSUMER)
    fs.rmSync(temp, { recursive: true, force: true });
  else console.log(`Kept consumers at ${temp}`);
}
