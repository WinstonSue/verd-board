import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { x } from 'tar';
import { readBuiltinRelease } from '@sue/verd-board-agent/node';
import type { BuiltinUpdateStatus } from '../../../packages/product/app/src/host/workspace-host';
const registry =
  'https://packages.aliyun.com/69f800449b7ce0afb00bda0e/npm/npm-registry/';
const day = 86400000;
export const contentPackages = {
  project: '@sue/verd-board-docs',
  'agent-patterns': '@sue/verd-board-agent-patterns',
} as const;
type Kind = keyof typeof contentPackages;
type Candidate = {
  kind: Kind;
  version: string;
  integrity: string;
  url: string;
  minimum: string;
};
const stable = (v: string) => /^\d+\.\d+\.\d+$/.test(v);
export const compareContentVersions = (a: string, b: string) => {
  const aa = a.split('.').map(Number),
    bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = aa[i]! - bb[i]!;
    if (d) return d;
  }
  return 0;
};
const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
/** Resolve only credentials scoped to the fixed registry, never workspace npmrc. */
export async function npmAuthorization(
  base = registry,
  environment = process.env,
) {
  const values: Record<string, string> = {};
  const prefix =
    environment['PREFIX'] ??
    (process.platform === 'win32'
      ? (environment['APPDATA'] ?? os.homedir())
      : '/usr/local');
  for (const file of [
    environment['npm_config_globalconfig'] ?? path.join(prefix, 'etc/npmrc'),
    environment['npm_config_userconfig'] ??
      environment['NPM_CONFIG_USERCONFIG'] ??
      path.join(os.homedir(), '.npmrc'),
  ]) {
    const source = await fs.readFile(file, 'utf8').catch(() => '');
    for (const line of source.split(/\r?\n/)) {
      const m = /^\s*([^#;][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
      if (m)
        values[m[1]!] = m[2]!
          .replace(
            /\$\{([^}]+)\}/g,
            (_, name: string) => environment[name] ?? '',
          )
          .replace(/^['"]|['"]$/g, '');
    }
  }
  for (const [key, value] of Object.entries(environment))
    if (key.toLowerCase().startsWith('npm_config_') && value)
      values[key.slice(11)] = value;
  const url = new URL(base);
  const scope = `//${url.host}${url.pathname}`;
  const token = values[scope + ':_authToken'];
  if (token) return 'Bearer ' + token;
  const basic = values[scope + ':_auth'];
  return basic ? 'Basic ' + basic : undefined;
}
export function createBuiltinPackageService(options: {
  userData(): string;
  appVersion(): string;
  source(kind: Kind): string;
  registry?: string;
  authorization?: () => Promise<string | undefined>;
  now?: () => number;
}) {
  const base = options.registry ?? registry,
    now = options.now ?? Date.now;
  let statuses: BuiltinUpdateStatus[] = [];
  const candidates = new Map<string, Candidate>();
  const ready = new Map<
    string,
    { kind: Kind; source: string; releaseId: string }
  >();
  const listeners = new Set<() => void>();
  let pending: Promise<BuiltinUpdateStatus[]> | undefined;
  const stateFile = () =>
    path.join(options.userData(), 'builtin-content-updates.json');
  type State = {
    checked?: number;
    fingerprint?: string;
    snoozed?: Record<string, number>;
    statuses?: BuiltinUpdateStatus[];
    candidates?: [string, Candidate][];
  };
  let state: State = {},
    loaded = false;
  async function load() {
    if (!loaded) {
      state = await readJson(stateFile()).catch(() => ({}));
      statuses = Array.isArray(state.statuses) ? state.statuses : [];
      for (const [id, candidate] of state.candidates ?? []) {
        if (
          candidate &&
          candidate.kind in contentPackages &&
          stable(candidate.version) &&
          /^sha512-[A-Za-z0-9+/]+=*$/.test(candidate.integrity)
        )
          candidates.set(id, candidate);
      }
      loaded = true;
    }
  }
  async function save() {
    await fs.mkdir(options.userData(), { recursive: true });
    const temp = stateFile() + '.tmp-' + randomUUID();
    await fs.writeFile(
      temp,
      JSON.stringify({ ...state, statuses, candidates: [...candidates] }),
    );
    await fs.rename(temp, stateFile());
  }
  async function request(url: string, archive = false) {
    const target = new URL(url);
    if (
      target.origin !== new URL(base).origin ||
      !target.pathname.startsWith(new URL(base).pathname)
    )
      throw new Error('Untrusted resource location');
    const auth = await (options.authorization?.() ?? npmAuthorization(base));
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(archive ? 60000 : 15000),
      headers: {
        accept: 'application/json',
        ...(auth ? { authorization: auth } : {}),
      },
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'npm 认证失败，请检查本机 npm 配置'
          : response.status === 404
            ? '资源包尚未发布'
            : '资源服务暂不可用',
      );
    const limit = archive ? 32 * 1024 * 1024 : 8 * 1024 * 1024;
    const reader = response.body!.getReader();
    const parts: Buffer[] = [];
    let size = 0;
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Resource exceeds size limit');
      }
      parts.push(Buffer.from(item.value));
    }
    return Buffer.concat(parts);
  }
  async function current(kind: Kind) {
    return readJson(
      path.join(
        options.userData(),
        'workspaces',
        kind === 'project' ? 'default' : kind,
        '.verdscrolls/instance.json',
      ),
    ).catch(() => null);
  }
  async function check(force = false): Promise<BuiltinUpdateStatus[]> {
    if (pending) return pending;
    pending = (async () => {
      await load();
      const bundles = await Promise.all(
        (Object.keys(contentPackages) as Kind[]).map(async (kind) => ({
          kind,
          release: await readBuiltinRelease(options.source(kind), kind),
        })),
      );
      const fingerprint =
        options.appVersion() +
        bundles.map((b) => b.release.releaseId).join(':');
      if (
        !force &&
        statuses.length &&
        state.fingerprint === fingerprint &&
        now() - (state.checked ?? 0) < day
      ) {
        statuses = await Promise.all(
          statuses.map(async (status) => {
            const instance = await current(status.kind);
            const adopted =
              instance?.releaseId === status.candidateId ||
              (instance?.packageVersion &&
                status.availableVersion &&
                compareContentVersions(
                  instance.packageVersion,
                  status.availableVersion,
                ) >= 0);
            return {
              ...status,
              currentVersion: instance?.packageVersion ?? null,
              currentReleaseId: instance?.releaseId ?? null,
              ...(adopted ? { status: 'current' as const, remind: false } : {}),
            };
          }),
        );
        return statuses;
      }
      const changed = state.fingerprint !== fingerprint;
      statuses = await Promise.all(
        bundles.map(async ({ kind, release }) => {
          const instance = await current(kind);
          const local = instance?.packageVersion as string | undefined;
          const bundled = release as typeof release & {
            packageVersion?: string;
          };
          let result: BuiltinUpdateStatus = {
            kind,
            packageName: contentPackages[kind],
            currentVersion: local ?? null,
            bundledVersion: bundled.packageVersion ?? null,
            currentReleaseId: instance?.releaseId ?? null,
            checkedAt: now(),
            status: 'current',
          };
          if (
            instance?.releaseId !== release.releaseId &&
            (!local ||
              !bundled.packageVersion ||
              compareContentVersions(bundled.packageVersion, local) >= 0)
          )
            result = {
              ...result,
              status: 'available',
              candidateId: release.releaseId,
              availableVersion: bundled.packageVersion ?? undefined,
            };
          try {
            const data = JSON.parse(
              (
                await request(base + encodeURIComponent(contentPackages[kind]))
              ).toString(),
            );
            const versions = Object.keys(data.versions ?? {})
              .filter(stable)
              .sort((a, b) => compareContentVersions(b, a));
            let chosen: string | undefined;
            for (const version of versions) {
              const meta = data.versions[version];
              const minimum = meta.verdBuiltin?.minimumAppVersion;
              if (
                meta.name !== contentPackages[kind] ||
                meta.verdBuiltin?.kind !== kind ||
                !stable(minimum ?? '')
              )
                continue;
              if (compareContentVersions(options.appVersion(), minimum) < 0) {
                result.incompatibleVersion ??= version;
                continue;
              }
              chosen = version;
              break;
            }
            const baseline = [local, bundled.packageVersion]
              .filter((v): v is string => !!v && stable(v))
              .sort((a, b) => compareContentVersions(b, a))[0];
            if (
              chosen &&
              (!baseline ||
                compareContentVersions(chosen, baseline) > 0 ||
                (!local &&
                  (!bundled.packageVersion ||
                    chosen !== bundled.packageVersion)))
            ) {
              const meta = data.versions[chosen];
              if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(meta.dist?.integrity ?? ''))
                throw new Error('资源包缺少有效完整性信息');
              const id = createHash('sha256')
                .update(kind + chosen + meta.dist.integrity)
                .digest('hex');
              candidates.set(id, {
                kind,
                version: chosen,
                integrity: meta.dist.integrity,
                url: meta.dist.tarball,
                minimum: meta.verdBuiltin.minimumAppVersion,
              });
              result = {
                ...result,
                status: 'available',
                candidateId: id,
                availableVersion: chosen,
              };
            }
          } catch (e) {
            result.error =
              e instanceof Error && /^(npm |资源)/.test(e.message)
                ? e.message
                : '检查更新失败，请稍后重试';
            if (result.status !== 'available') result.status = 'error';
          }
          result.remind =
            result.status === 'available' &&
            (changed || now() >= (state.snoozed?.[result.candidateId!] ?? 0));
          return result;
        }),
      );
      state.checked = now();
      state.fingerprint = fingerprint;
      await save();
      listeners.forEach((fn) => fn());
      return statuses;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  return {
    check,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async snooze(id: string) {
      await load();
      state.snoozed = { ...state.snoozed, [id]: now() + day };
      await save();
      statuses = statuses.map((s) =>
        s.candidateId === id ? { ...s, remind: false } : s,
      );
      listeners.forEach((fn) => fn());
    },
    status(kind: Kind) {
      return statuses.find((s) => s.kind === kind);
    },
    async prepare(id: string) {
      const candidate = candidates.get(id);
      if (!candidate) return; // bundled digest is handled by the updater
      const target = path.join(options.userData(), 'builtin-package-cache', id);
      async function verify(root: string) {
        const manifest = await readJson(
          path.join(root, 'dist/builtin-release.json'),
        );
        const source = path.join(
          root,
          candidate!.kind === 'project' ? 'dist/workspace' : 'workspace',
        );
        const pkg = await readJson(path.join(root, 'package.json'));
        const actual = await readBuiltinRelease(source, candidate!.kind);
        if (
          pkg.name !== contentPackages[candidate!.kind] ||
          pkg.version !== candidate!.version ||
          manifest.packageName !== pkg.name ||
          manifest.packageVersion !== pkg.version ||
          manifest.minimumAppVersion !== candidate!.minimum ||
          manifest.kind !== candidate!.kind ||
          manifest.releaseId !== actual.releaseId ||
          JSON.stringify(manifest.files) !== JSON.stringify(actual.files)
        )
          throw new Error('资源包校验失败');
        await fs.writeFile(
          path.join(source, '.verdscrolls/release.json'),
          JSON.stringify({ ...manifest, source: 'npm' }),
        );
        return { kind: candidate!.kind, source, releaseId: actual.releaseId };
      }
      try {
        const verified = await verify(target);
        ready.set(id, verified);
        return;
      } catch {
        /* download a fresh immutable copy */
      }
      const scratch = target + '.tmp-' + randomUUID();
      await fs.mkdir(scratch, { recursive: true });
      try {
        const bytes = await request(candidate.url, true);
        if (
          'sha512-' + createHash('sha512').update(bytes).digest('base64') !==
          candidate.integrity
        )
          throw new Error('资源包完整性校验失败');
        const archive = path.join(scratch, 'content.tgz');
        await fs.writeFile(archive, bytes);
        let size = 0,
          count = 0;
        await x({
          sync: true,
          file: archive,
          cwd: scratch,
          strict: true,
          filter: (name, entry) => {
            if (
              ++count > 5000 ||
              (size += entry.size) > 128 * 1024 * 1024 ||
              name.split(/[\\/]/).includes('..') ||
              !name.startsWith('package/') ||
              !('type' in entry) ||
              !['File', 'Directory'].includes(String(entry.type))
            )
              throw new Error('Unsafe resource archive');
            return true;
          },
        });
        const verified = await verify(path.join(scratch, 'package'));
        // Publishing a cache never changes the active workspace.
        await fs.rm(target, { recursive: true, force: true });
        await fs.rename(path.join(scratch, 'package'), target);
        ready.set(id, {
          ...verified,
          source: path.join(
            target,
            path.relative(path.join(scratch, 'package'), verified.source),
          ),
        });
      } finally {
        await fs.rm(scratch, { recursive: true, force: true });
      }
    },
    resolve(id: string, kind: Kind) {
      const value = ready.get(id);
      if (candidates.has(id) && !value)
        throw new Error('Prepare the resource package before updating');
      if (value && value.kind !== kind)
        throw new Error('Resource kind mismatch');
      return value;
    },
  };
}
