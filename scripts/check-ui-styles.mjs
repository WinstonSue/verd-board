import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const ui = path.join(root, 'packages/product/ui/src');
function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesAt(path.join(dir, entry.name))
      : entry.name.endsWith('.scss')
        ? [path.join(dir, entry.name)]
        : [],
  );
}
const files = [
  ...filesAt(ui),
  path.join(root, 'packages/react/actions/src/style.css'),
];
const definitions = new Set();
for (const file of files) {
  for (const match of readFileSync(file, 'utf8').matchAll(/(--vm-[\w-]+)\s*:/g))
    definitions.add(match[1]);
}
const problems = [];
function report(file, source, index, message) {
  problems.push(
    `${path.relative(root, file)}:${source.slice(0, index).split('\n').length}: ${message}`,
  );
}
// These selectors intentionally retain content paint, rather than interface paint.
const paintExceptions = new Map([
  [
    'styles/appearance.scss',
    new Set([
      "svg[data-surface][aria-label='Frame canvas']:not([data-board-appearance])",
      '.frame-note-content',
    ]),
  ],
  ['canvas/presentation/presentation.scss', new Set(['.presentation-mode'])],
]);
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (file.endsWith('_appearance-tokens.scss')) continue;
  // Preserve offsets while ignoring comments. Quoted URLs/strings cannot create scopes.
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (s) =>
    s.replace(/[^\n]/g, ' '),
  );
  const relative = path.relative(ui, file);
  const scopes = [];
  const selectors = new Set();
  const tokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^{};"']+/g;
  let pending = '';
  let pendingIndex = 0;
  for (const match of clean.matchAll(tokens)) {
    const token = match[0];
    if (token === '{') {
      const selector = pending.trim().replace(/\s+/g, ' ');
      const key = `${scopes.join(' / ')} / ${selector}`;
      if (!selector.startsWith('@') && selectors.has(key))
        report(file, source, pendingIndex, `duplicate selector: ${selector}`);
      if (!selector.startsWith('@')) selectors.add(key);
      scopes.push(selector);
      pending = '';
    } else if (token === ';' || token === '}') {
      const declaration = pending.trim();
      const typography = file.endsWith('actions/src/style.css')
        ? declaration.replace(
            /var\(--verd-actions-[\w-]+,\s*[^)]+\)/g,
            'var(--fallback)',
          )
        : declaration;
      const exemptPaint = scopes.some((scope) =>
        paintExceptions.get(relative)?.has(scope),
      );
      if (!exemptPaint && /#[\da-fA-F]{3,8}\b/.test(declaration))
        report(file, source, pendingIndex, 'use a color token');
      if (/\bsystem-ui\b/.test(typography))
        report(file, source, pendingIndex, 'use --vm-font');
      if (
        /^font-family\s*:/.test(declaration) &&
        !/^font-family\s*:\s*var\(--vm-font(?:-mono)?\)\s*$/.test(declaration)
      )
        report(file, source, pendingIndex, 'use a font token');
      if (
        /^(?:font(?:-size)?|--tabs-font)\s*:/.test(declaration) &&
        /\b\d+(?:\.\d+)?px\b/.test(typography)
      )
        report(file, source, pendingIndex, 'use a text-size token');
      if (/^(?:top|inset-block-start)\s*:\s*-\d/.test(declaration))
        report(
          file,
          source,
          pendingIndex,
          'negative top positioning needs a layout rule',
        );
      for (const reference of declaration.matchAll(/var\((--vm-[\w-]+)/g))
        if (!definitions.has(reference[1]))
          report(file, source, pendingIndex, `undefined token ${reference[1]}`);
      pending = '';
      if (token === '}') scopes.pop();
    } else {
      if (!pending) pendingIndex = match.index;
      pending += token;
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`UI style guard passed (${files.length} files).`);
