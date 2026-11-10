import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');

export async function sourceInventory(root = ROOT) {
  const names = [
    ...new Set(
      execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, encoding: 'utf8' },
      ).split('\0'),
    ),
  ].sort();
  const files = {};
  for (const name of names) {
    if (
      !name ||
      name.startsWith('.release/') ||
      name.startsWith('.quality/') ||
      /(^|\/)CHANGELOG\.md$/.test(name) ||
      /^\.changeset\/[^/]+\.md$/.test(name)
    )
      continue;
    const file = path.join(root, name);
    const stat = await fs.lstat(file).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat?.isFile()) continue;
    let source = await fs.readFile(file);
    if (path.basename(name) === 'package.json') {
      const manifest = JSON.parse(source.toString());
      delete manifest.version;
      source = JSON.stringify(manifest);
    }
    files[name] = hash(
      source instanceof Uint8Array ? source.toString('base64') : source,
    );
  }
  return files;
}

export async function packageVersions(root = ROOT) {
  const files = await sourceInventory(root);
  const versions = {};
  for (const file of Object.keys(files).filter((name) =>
    /(^|\/)package\.json$/.test(name),
  )) {
    const pkg = await readJson(path.join(root, file));
    if (pkg.name && pkg.version) versions[pkg.name] = pkg.version;
  }
  return Object.fromEntries(
    Object.entries(versions).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Compare business prose rather than JSON layout, caches, timestamps or version tokens. */
export function businessText(node) {
  if (!node || typeof node !== 'object') return [];
  const normalize = (text) =>
    String(text)
      .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, '<date>')
      .replace(/\bv?\d+\.\d+\.\d+(?:-[\w.-]+)?\b/g, '<version>')
      .replace(/\s+/g, ' ')
      .trim();
  const raw = (value) =>
    (value.text ?? '') + (value.content ?? []).map(raw).join('');
  const references = new Set();
  const read = (value) => {
    if (
      ['paragraph', 'heading'].includes(value.type) &&
      /^(最后更新|更新时间|更新日期|当前版本|版本|last updated|version)\s*[:：]/i.test(
        raw(value).trim(),
      )
    )
      return '';
    for (const key of ['targetFrameId', 'targetDocumentId', 'href', 'src'])
      if (value.attrs?.[key])
        references.add(key + ':' + normalize(value.attrs[key]));
    for (const mark of value.marks ?? [])
      if (mark.type === 'link' && mark.attrs?.href)
        references.add('href:' + normalize(mark.attrs.href));
    if (value.type === 'hardBreak') return ' ';
    if (value.type === 'text') return value.text ?? '';
    if (['inlineMath', 'blockMath'].includes(value.type))
      return String(value.attrs?.latex ?? '');
    const text = (value.content ?? []).map(read).join('');
    return (
      text +
      (['paragraph', 'heading', 'codeBlock'].includes(value.type) ? ' ' : '')
    );
  };
  const text = normalize(read(node));
  return [...(text ? [text] : []), ...[...references].sort()];
}

export async function introductionDigests(root = ROOT, inventory) {
  const files = inventory ?? (await sourceInventory(root));
  const docs = {};
  for (const file of Object.keys(files).filter(
    (name) => name.startsWith('workspace/') && name.endsWith('.verd-doc.json'),
  )) {
    const doc = await readJson(path.join(root, file));
    const content = businessText(doc.text?.content);
    if (content.length) docs[doc.id] = hash(content);
  }
  return Object.fromEntries(
    Object.entries(docs).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export async function snapshot(root = ROOT) {
  const files = await sourceInventory(root);
  return {
    sourceDigest: hash(files),
    versions: await packageVersions(root),
    introduction: await introductionDigests(root, files),
  };
}

export function assertReview(
  record,
  previous,
  current,
  { prepared = true, targets } = {},
) {
  if (
    record.format !== 'verd-release-review' ||
    record.version !== 1 ||
    record.previousDigest !== hash(previous)
  )
    throw new Error('Release review has no matching previous baseline');
  if (record.sourceDigest !== current.sourceDigest)
    throw new Error(
      'Release review is stale; review the current source, lockfile, tests and content again',
    );
  if (
    !Array.isArray(record.targets) ||
    !record.targets.length ||
    new Set(record.targets.map((item) => item.name)).size !==
      record.targets.length
  )
    throw new Error(
      'Release review must identify every target package/version',
    );
  if (targets && JSON.stringify(record.targets) !== JSON.stringify(targets))
    throw new Error('Reviewed target versions do not match the release plan');
  for (const { name, version } of record.targets) {
    if (
      !current.versions[name] ||
      typeof version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)
    )
      throw new Error('Invalid release target: ' + name);
    if (prepared && current.versions[name] !== version)
      throw new Error(
        'Prepared package version does not match review: ' + name,
      );
  }
  for (const [name, version] of Object.entries(current.versions))
    if (
      previous.versions[name] &&
      previous.versions[name] !== version &&
      !record.targets.some(
        (item) => item.name === name && item.version === version,
      )
    )
      throw new Error('Changed version missing from release targets: ' + name);
  for (const key of ['agent', 'recommendations', 'introduction']) {
    const review = record.reviews?.[key];
    if (
      !review ||
      !['updated', 'reviewed'].includes(review.status) ||
      typeof review.reason !== 'string' ||
      !review.reason.trim() ||
      !Array.isArray(review.files) ||
      !review.files.length ||
      review.files.some((file) => typeof file !== 'string' || !file)
    )
      throw new Error(
        'Missing business review with reasons and evidence files: ' + key,
      );
  }
  if (
    record.reviews.introduction.status !== 'updated' ||
    !Object.entries(current.introduction).some(
      ([id, digest]) => previous.introduction[id] !== digest,
    )
  )
    throw new Error(
      'Every release requires a real system introduction prose update; dates, versions, caches and formatting do not count',
    );
  if (
    JSON.stringify(record.introduction) !==
      JSON.stringify(current.introduction) ||
    JSON.stringify(record.versions) !== JSON.stringify(current.versions)
  )
    throw new Error(
      'Review snapshot does not match current content and versions',
    );
}

export async function readCurrentReview(root = ROOT) {
  const directory = path.join(root, '.release');
  const pointer = await readJson(path.join(directory, 'current.json')).catch(
    (error) => {
      if (error.code === 'ENOENT')
        throw new Error(
          'Missing release review; run pnpm release:review and complete the three reviews',
        );
      throw error;
    },
  );
  if (!/^[a-f0-9]{24}\.json$/.test(pointer.record))
    throw new Error('Invalid release review reference');
  const record = await readJson(
    path.join(directory, 'reviews', pointer.record),
  );
  let previous = await readJson(path.join(directory, 'baseline.json'));
  if (record.previous !== 'baseline') {
    if (
      !/^[a-f0-9]{24}\.json$/.test(record.previous) ||
      record.previous === pointer.record
    )
      throw new Error('Invalid previous release reference');
    previous = await readJson(path.join(directory, 'reviews', record.previous));
  }
  return {
    record,
    previous,
    file: path.join(directory, 'reviews', pointer.record),
    name: pointer.record,
  };
}

export async function checkReleaseReview(root = ROOT, options = {}) {
  const { record, previous } = await readCurrentReview(root);
  const current = await snapshot(root);
  assertReview(record, previous, current, options);
  const groups = {
    agent: (file) =>
      file.startsWith('packages/product/agent/') ||
      file.startsWith('packages/product/agent-patterns/agent/') ||
      /^packages\/product\/agent-patterns\/(catalog|rules)\.json$/.test(file),
    recommendations: (file) =>
      file.startsWith('packages/product/agent-patterns/workspace/') ||
      file === 'packages/product/agent-patterns/recommendations.json',
    introduction: (file) =>
      file.startsWith('workspace/') && file.endsWith('.verd-doc.json'),
  };
  for (const [key, match] of Object.entries(groups))
    for (const file of record.reviews[key].files) {
      if (
        !match(file) ||
        path.isAbsolute(file) ||
        file.split('/').includes('..') ||
        !(await fs.stat(path.join(root, file))).isFile()
      )
        throw new Error('Invalid review evidence file: ' + key + ': ' + file);
    }
  let updatedEvidence = false;
  for (const file of record.reviews.introduction.files) {
    const doc = await readJson(path.join(root, file));
    if (
      current.introduction[doc.id] &&
      current.introduction[doc.id] !== previous.introduction[doc.id]
    )
      updatedEvidence = true;
  }
  if (!updatedEvidence)
    throw new Error(
      'Introduction evidence must name an actually updated native document',
    );
  return record;
}

export async function plannedTargets(root = ROOT) {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-release-plan-'),
  );
  try {
    const output = path.join(temporary, 'status.json');
    execFileSync('pnpm', ['changeset', 'status', '--output', output], {
      cwd: root,
      stdio: 'inherit',
    });
    const plan = await readJson(output);
    const versions = await packageVersions(root);
    const targets = (plan.releases ?? [])
      .filter((item) => item.type !== 'none')
      .map((item) => ({ name: item.name, version: item.newVersion }));
    const app = targets.find((item) => item.name === '@sue/verd-board-app');
    if (app)
      for (const name of [
        'desktop',
        'service',
        '@sue/verd-board-docs',
        '@sue/verd-board-agent-patterns',
      ]) {
        const existing = targets.find((item) => item.name === name);
        if (existing) existing.version = app.version;
        else if (versions[name] !== app.version)
          targets.push({ name, version: app.version });
      }
    if (!targets.length)
      throw new Error(
        'No version changes are planned; use --current for an explicit current-version package build',
      );
    return targets.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function initializeBaseline(root = ROOT) {
  const directory = path.join(root, '.release');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'baseline.json'),
    JSON.stringify(
      {
        format: 'verd-release-baseline',
        version: 1,
        ...(await snapshot(root)),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
}

export async function draftReview(root = ROOT, targets) {
  const directory = path.join(root, '.release');
  const baseline = await readJson(path.join(directory, 'baseline.json'));
  const name = hash(targets).slice(0, 24) + '.json';
  const existing = await readCurrentReview(root).catch((error) => {
    if (error.message.startsWith('Missing release review;')) return null;
    throw error;
  });
  const previous =
    existing?.name === name
      ? existing.previous
      : (existing?.record ?? baseline);
  const priorName =
    existing?.name === name
      ? existing.record.previous
      : (existing?.name ?? 'baseline');
  const record = {
    format: 'verd-release-review',
    version: 1,
    targets,
    previous: priorName,
    previousDigest: hash(previous),
    ...(await snapshot(root)),
    reviews: Object.fromEntries(
      ['agent', 'recommendations', 'introduction'].map((key) => [
        key,
        { status: 'pending', reason: '', files: [] },
      ]),
    ),
  };
  await fs.mkdir(path.join(directory, 'reviews'), { recursive: true });
  await writeJson(path.join(directory, 'reviews', name), record);
  await writeJson(path.join(directory, 'current.json'), { record: name });
  return name;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, flag] = process.argv.slice(2);
  if (command === 'init' && !flag) await initializeBaseline();
  else if (command === 'check' && !flag) await checkReleaseReview();
  else if (command === 'draft' && (!flag || flag === '--current')) {
    const targets =
      flag === '--current'
        ? Object.entries(await packageVersions()).map(([name, version]) => ({
            name,
            version,
          }))
        : await plannedTargets();
    console.log(
      'Complete the business reviews in .release/reviews/' +
        (await draftReview(ROOT, targets)),
    );
  } else
    throw new Error(
      'Usage: release-review.mjs init | check | draft [--current]',
    );
}
