import fs from 'node:fs/promises';
import path from 'node:path';

const read = (directory, name) =>
  fs
    .readFile(path.join(directory, name), 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
export const terminal = (state) =>
  ['passed', 'failed', 'cancelled', 'interrupted', 'withdrawn'].includes(state);

export async function readInstallerChecksums(directory) {
  const body = await fs
    .readFile(path.join(directory, 'SHA256SUMS'), 'utf8')
    .catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (body === null) return null;
  const names = new Set();
  const entries = body
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => {
      const match = /^([a-fA-F0-9]{64}) {2}([^/\\]+)$/.exec(line);
      if (
        !match ||
        [...match[2]].some((character) => character.charCodeAt(0) < 32) ||
        ['.', '..'].includes(match[2]) ||
        names.has(match[2])
      )
        throw new Error('Invalid installer SHA256SUMS manifest');
      names.add(match[2]);
      return [match[2], match[1].toLowerCase()];
    });
  return Object.fromEntries(entries);
}

export function summaryExitCode(summary) {
  if (summary.status !== 'passed') return 1;
  if (
    !summary.currentSource ||
    !summary.diagnosticsComplete ||
    summary.gateStatus !== 'passed'
  )
    return 2;
  if (
    summary.task === 'package' &&
    (summary.packageStatus !== 'passed' ||
      summary.deliveryStatus !== 'delivered')
  )
    return 1;
  return 0;
}

export async function summarizeResults(directory) {
  const [manifest, state, comparison, artifacts] = await Promise.all(
    [
      'manifest.json',
      'status.json',
      'local-comparison.json',
      'artifacts.json',
    ].map((name) => read(directory, name)),
  );
  if (!manifest || !state)
    throw new Error('Task results have not been retrieved: ' + directory);
  const mode = manifest.task === 'package' ? 'release' : manifest.task;
  const quality = await read(directory, 'source/.quality/' + mode + '.json');
  const packaging = await read(directory, 'source/.quality/package.json');
  const gui = await read(directory, 'source/.quality/gui-session.json');
  const checksumManifest =
    manifest.task === 'package'
      ? await readInstallerChecksums(
          path.join(directory, 'source/apps/desktop/release'),
        ).then(
          (checksums) => ({ checksums: checksums ?? {}, error: null }),
          (error) => ({ checksums: {}, error: error.message }),
        )
      : { checksums: {}, error: null };
  const units = quality?.verification?.units ?? [];
  return {
    format: 'verd-remote-summary',
    version: 1,
    taskId: manifest.id,
    validatedInputDigest: manifest.proof?.releaseInputDigest ?? null,
    task: manifest.task,
    status: state.state,
    exitCode: state.exitCode,
    currentSource: comparison?.current === true,
    diagnosticsComplete:
      Boolean(quality) &&
      artifacts?.complete === true &&
      (quality?.diagnostics ?? []).every((report) => report.complete),
    gateStatus: quality?.status ?? 'unavailable',
    packageStatus:
      manifest.task === 'package'
        ? (packaging?.status ?? 'not-produced')
        : 'not-requested',
    deliveryStatus:
      manifest.task === 'package' ? 'not-promoted' : 'not-applicable',
    scope: {
      executed: units
        .filter((unit) => unit.action === 'run')
        .map((unit) => unit.id),
      reused: units
        .filter((unit) => unit.action === 'reuse')
        .map((unit) => ({ id: unit.id, proof: unit.evidence?.digest })),
      outside: units
        .filter((unit) => unit.action === 'outside')
        .map((unit) => unit.id),
    },
    stages: (quality?.steps ?? []).map(
      ({ id, status, durationMs, error, failures, log }) => ({
        id,
        status,
        durationMs,
        error,
        failures,
        log: log ? path.join(directory, 'source', log) : null,
      }),
    ),
    diagnostics: quality?.diagnostics ?? [],
    gui,
    error:
      packaging?.error ??
      quality?.error ??
      (gui?.ready === false ? gui.error : state.error) ??
      null,
    results: directory,
    log: path.join(directory, 'run.log'),
    installers: packaging?.files ?? {},
    checksums: checksumManifest.checksums,
    checksumError: checksumManifest.error,
  };
}

export async function waitForTask(
  id,
  {
    status,
    fetch,
    summarize,
    timeout = 600,
    interval = 2000,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  if (timeout !== null && (!Number.isFinite(timeout) || timeout < 0))
    throw new Error('Invalid wait timeout');
  const deadline = timeout === null ? Infinity : now() + timeout * 1000;
  for (;;) {
    const current = await status(id);
    if (['upload-paused', 'upload-expired'].includes(current.state))
      return {
        taskId: id,
        status: current.state,
        confirmedBytes: current.confirmedBytes,
        totalBytes: current.totalBytes,
      };
    if (terminal(current.state)) return summarize(id, await fetch(id));
    if (now() >= deadline)
      return {
        taskId: id,
        status: current.state,
        waiting: true,
        timedOut: true,
      };
    await sleep(Math.min(interval, deadline - now()));
  }
}
