import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import {
  createDemoDocuments,
  DEMO_SOURCE,
  EXISTING_FRAME_IDS,
  HOME_IDS,
  PACKAGE_DIRECTORIES,
  TOPICS,
} from './documents.mjs';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
export const DEFAULT_FILE = path.resolve(SCRIPT_DIR, '../verdboard-data.json');
const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const recordKey = (id, record) =>
  'frames/' +
  Array.from(id)
    .map((c) => c.codePointAt(0).toString(16))
    .join('_') +
  '/demo-' +
  hash(record);

export async function readManifests() {
  return Object.fromEntries(
    await Promise.all(
      PACKAGE_DIRECTORIES.map(async (directory) => [
        directory,
        JSON.parse(
          await readFile(
            path.join(REPO_ROOT, directory, 'package.json'),
            'utf8',
          ),
        ),
      ]),
    ),
  );
}

/** Load current TypeScript source rather than potentially stale library dist. */
export async function withSourceRuntime(task) {
  const { createServer } = await import('vite');
  const hmr = createHttpServer(); // Never listen on a port for CLI validation.
  const server = await createServer({
    root: REPO_ROOT,
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, watch: null, hmr: { server: hmr } },
    resolve: { conditions: ['development', 'module', 'node'] },
    ssr: { noExternal: [/^@sue\//] },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const load = (entry) => server.ssrLoadModule('/packages/' + entry);
    const [core, draw, mind, workflow, architecture, storage] =
      await Promise.all([
        load('engine/core/src/public-api.ts'),
        load('engine/draw/src/public-api.ts'),
        load('engine/mind/src/public-api.ts'),
        load('engine/workflow/src/public-api.ts'),
        load('engine/architecture/src/public-api.ts'),
        load('product/app/src/frames/workspace-storage.ts'),
      ]);
    const registry = core.createCellRegistry();
    [
      draw.registerDrawCells,
      mind.registerMindCells,
      workflow.registerWorkflowCells,
      architecture.registerArchitectureCells,
    ].forEach((register) => register(registry));
    return await task({ core, registry, storage, mind, architecture });
  } finally {
    await server.close();
    hmr.close();
  }
}

export async function validateStorage(storage, runtime) {
  if (
    !storage ||
    typeof storage !== 'object' ||
    Array.isArray(storage) ||
    !runtime.storage.isWorkspaceManifest(storage.main_board_content)
  ) {
    throw new Error(
      'Expected a valid verd-workspace manifest; legacy/corrupt input is not overwritten',
    );
  }
  // Loading can GC records. It operates exclusively on a clone, never the input.
  const values = new Map(Object.entries(clone(storage)));
  const adapter = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, clone(value));
    },
    removeItem: async (key) => {
      values.delete(key);
    },
    listKeys: async () => [...values.keys()],
  };
  const snapshot = await runtime.storage.loadCellWorkspace(
    adapter,
    runtime.registry,
  );
  if (!snapshot) throw new Error('Missing workspace');
  const errors = runtime.core.validateCellStore(
    snapshot.store,
    runtime.registry,
  );
  if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
  return snapshot;
}

// IDs from the five earlier demo documents. Unknown additions are preserved.
// The namespace for generated cells is reserved; UUID user-created cells are not.
function ownedCell(frameId, id) {
  if (id.startsWith('demo:')) {
    const prefixes = {
      [TOPICS[0].id]: ['demo:packages/'],
      [TOPICS[1].id]: ['demo:runtime/'],
      [TOPICS[2].id]: ['demo:model/'],
      [TOPICS[3].id]: ['demo:load/'],
      [TOPICS[4].id]: ['demo:edit/'],
      [TOPICS[5].id]: ['demo:save/', 'demo:close/'],
      [TOPICS[6].id]: ['demo:import/', 'demo:export/'],
      [TOPICS[7].id]: ['demo:development/'],
    };
    return prefixes[frameId]?.some((prefix) => id.startsWith(prefix)) ?? false;
  }
  const legacy = {
    [TOPICS[0].id]: /^a:(layer|mod|edge)\//,
    [TOPICS[1].id]: /^b:(layer|mod|edge)\//,
    [TOPICS[2].id]: /^c:(root|n\d+|br\d+)$/,
    [TOPICS[4].id]:
      /^d:(start|op|dispatch|txn|d[123]|drop|commit|render|queue|write|fail|manifest|gc|desktop|web|edge\/\d+)$/,
    [TOPICS[7].id]: /^m:(root|n\d+|br\d+)$/,
  };
  return legacy[frameId]?.test(id) ?? false;
}

export async function buildDemoStorage(
  input,
  manifests,
  runtime,
  now = Date.now(),
) {
  const before = await validateStorage(input, runtime);
  const result = clone(input);
  const manifest = result.main_board_content;
  const rootKey = manifest.frames[manifest.rootId];
  const previousRoot = result[rootKey];
  const documents = createDemoDocuments(manifests);
  const managed = new Set(TOPICS.map((t) => t.id));
  const homeIds = new Set(HOME_IDS);
  const candidates = [];
  for (const candidate of documents.records) {
    const id = candidate.frame.id;
    if (id === manifest.rootId)
      throw new Error('Demo Frame ID conflicts with workspace root');
    const old = result[manifest.frames[id]];
    if (
      old &&
      !EXISTING_FRAME_IDS.includes(id) &&
      old.frame.data?.demoSource !== DEMO_SOURCE
    ) {
      throw new Error('Unmanaged Frame ID collision: ' + id);
    }
    if (old) {
      const unknown = Object.entries(old.cells).filter(
        ([cellId]) => !ownedCell(id, cellId),
      );
      for (const [cellId, cell] of unknown) {
        if (Object.hasOwn(candidate.cells, cellId))
          throw new Error('Unmanaged Cell ID collision: ' + cellId);
        candidate.cells[cellId] = clone(cell);
      }
      // User additions retain their domain owner when managed anchors refresh.
      for (const anchor of Object.values(old.cells)) {
        if (!ownedCell(id, anchor.id) || !Array.isArray(anchor.data?.memberIds))
          continue;
        const retainedMembers = anchor.data.memberIds.filter(
          (member) => !ownedCell(id, member),
        );
        if (!retainedMembers.length) continue;
        const replacement =
          candidate.cells[anchor.id] ??
          Object.values(candidate.cells).find(
            (cell) =>
              cell.kind === anchor.kind &&
              (cell.kind !== 'architecture-layer' ||
                cell.data?.order === anchor.data?.order),
          );
        if (!replacement?.data?.memberIds)
          throw new Error('Cannot preserve domain membership: ' + anchor.id);
        replacement.data.memberIds.push(...retainedMembers);
      }
      candidate.frame.children.push(
        ...old.frame.children.filter((cellId) => !ownedCell(id, cellId)),
      );
      candidate.frame.groups.push(
        ...old.frame.groups.filter((cellId) => !ownedCell(id, cellId)),
      );
    }
    const placement = documents.home.placements.find((p) => p.id === id);
    candidate.frame.geometry = { ...candidate.frame.geometry, ...placement };
    delete candidate.frame.geometry.id;
    candidates.push(candidate);
  }
  const root = clone(previousRoot);
  root.frame.children = [
    ...root.frame.children.filter((id) => !managed.has(id) && !homeIds.has(id)),
    ...documents.home.cells.map((cell) => cell.id),
    ...TOPICS.map((topic) => topic.id),
  ];
  for (const id of HOME_IDS) delete root.cells[id];
  for (const cell of documents.home.cells) {
    const current = before.store.cells[cell.id];
    if (current && !Object.hasOwn(previousRoot.cells, cell.id)) {
      throw new Error('Homepage Cell ID collision: ' + cell.id);
    }
    if (
      current &&
      cell.id.startsWith('demo:home/') &&
      previousRoot.frame.data?.demoSource !== DEMO_SOURCE
    ) {
      throw new Error('Unmanaged homepage Cell ID collision: ' + cell.id);
    }
    root.cells[cell.id] = cell;
  }
  root.frame.content = { label: '青编 VerdBoard · 项目导览' };
  root.frame.data = { ...root.frame.data, demoSource: DEMO_SOURCE };
  candidates.push(root);
  // A known demo ID must not silently take over a cell owned by another Frame.
  for (const candidate of candidates) {
    for (const id of [candidate.frame.id, ...Object.keys(candidate.cells)]) {
      const existing = before.store.cells[id];
      if (!existing) continue;
      const owners = Object.values(before.store.cells).filter(
        (cell) =>
          cell.cellType === 'frame' &&
          [...cell.children, ...cell.groups].includes(id),
      );
      if (id === candidate.frame.id) {
        if (owners.some((owner) => owner.id !== manifest.rootId)) {
          throw new Error('Demo Frame has an unexpected owner: ' + id);
        }
      } else if (owners.some((owner) => owner.id !== candidate.frame.id)) {
        throw new Error('Cell ID collision outside its demo Frame: ' + id);
      }
    }
  }
  let changed = false;
  for (const candidate of candidates) {
    const id = candidate.frame.id;
    const previousKey = manifest.frames[id];
    if (previousKey && equal(result[previousKey], candidate)) continue;
    const key = recordKey(id, candidate);
    if (Object.hasOwn(result, key) && !equal(result[key], candidate)) {
      throw new Error('Immutable record key collision: ' + key);
    }
    result[key] = candidate;
    manifest.frames[id] = key;
    changed = true;
    // Only replaced, managed revisions are removed. Other unused records stay.
    if (previousKey && previousKey !== key) delete result[previousKey];
  }
  const detached = manifest.detachedFrameIds.filter((id) => !managed.has(id));
  if (!equal(detached, manifest.detachedFrameIds) || manifest.version !== 2)
    changed = true;
  manifest.detachedFrameIds = detached;
  manifest.version = 2;
  if (changed) manifest.lastSavedAt = now;
  await validateStorage(result, runtime);
  return { storage: result, references: documents.references, changed };
}

export function parseArguments(args) {
  const options = { check: false, output: undefined };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') options.check = true;
    else if (
      args[i] === '--output' &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    ) {
      options.output = path.resolve(args[++i]);
    } else
      throw new Error(
        'Usage: generate-architecture [--check | --output <path>]',
      );
  }
  if (options.check && options.output)
    throw new Error('--check and --output are mutually exclusive');
  return options;
}

export async function atomicWrite(file, text, expected) {
  const temporary = file + '.demo-' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    if (expected !== undefined && (await readFile(file, 'utf8')) !== expected) {
      throw new Error(
        'Input changed during generation (Desktop autosave); no replacement was made',
      );
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runGenerator(options, paths = {}) {
  const inputFile = paths.inputFile ?? DEFAULT_FILE;
  const referenceDirectory = paths.referenceDirectory ?? SCRIPT_DIR;
  const original = await readFile(inputFile, 'utf8');
  const input = JSON.parse(original); // Corrupt/missing input is an error, never an empty reset.
  const manifests = await readManifests();
  const built = await withSourceRuntime((runtime) =>
    buildDemoStorage(input, manifests, runtime),
  );
  const referenceEntries = await Promise.all(
    Object.entries(built.references).map(async ([name, text]) => {
      const file = path.join(referenceDirectory, name);
      let previous;
      try {
        previous = await readFile(file, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return { file, text, previous };
    }),
  );
  const drift =
    built.changed ||
    referenceEntries.some((entry) => entry.previous !== entry.text);
  if (options.check) {
    if (drift)
      throw new Error(
        'Demo drift detected; run pnpm --filter desktop generate-architecture',
      );
    return { ...built, written: false };
  }
  const output = options.output ?? inputFile;
  const { format } = await import('prettier');
  const text = built.changed
    ? await format(JSON.stringify(built.storage), { parser: 'json' })
    : original;
  if (options.output) {
    if (
      path.resolve(output) === path.resolve(inputFile) ||
      referenceEntries.some(
        (entry) => path.resolve(output) === path.resolve(entry.file),
      )
    ) {
      throw new Error('--output must point to a separate preview JSON file');
    }
    await atomicWrite(output, text);
  } else {
    if (built.changed) await atomicWrite(inputFile, text, original);
    // --output intentionally never updates repository reference files.
    for (const entry of referenceEntries) {
      if (entry.previous !== entry.text)
        await atomicWrite(entry.file, entry.text, entry.previous);
    }
  }
  return { ...built, written: options.output !== undefined || drift };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runGenerator(parseArguments(process.argv.slice(2))).then(
    (result) =>
      console.log(
        (result.written ? 'Generated' : 'Verified unchanged') +
          ' eight native demo topics; workspace and domain validation passed',
      ),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
