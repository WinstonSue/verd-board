import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { c } from 'tar';
import {
  createBuiltinPackageService,
  npmAuthorization,
} from './builtin-package-service';
const repo = path.resolve(__dirname, '../../..');
const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const fn of clean.splice(0)) await fn();
});
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-content-test-'));
  clean.push(() => fs.rm(dir, { recursive: true, force: true }));
  let now = 100000000;
  const service = createBuiltinPackageService({
    userData: () => dir,
    appVersion: () => '1.0.0',
    source: (kind) =>
      path.join(
        repo,
        kind === 'project'
          ? 'workspace'
          : 'packages/product/agent-patterns/workspace',
      ),
    registry: 'http://localhost/registry/',
    authorization: async () => undefined,
    now: () => now,
  });
  return {
    dir,
    service,
    advance: () => {
      now += 86400001;
    },
  };
}
function metadata(
  integrity = 'sha512-' + Buffer.alloc(64).toString('base64'),
  minimum = '0.0.1',
) {
  return {
    versions: {
      '9.0.0': {
        name: '@sue/verd-board-docs',
        version: '9.0.0',
        verdBuiltin: { kind: 'project', minimumAppVersion: minimum },
        dist: { integrity, tarball: 'http://localhost/registry/content.tgz' },
      },
    },
  };
}
it('checks metadata only, throttles, snoozes exact candidates and reports incompatible releases', async () => {
  const { service, advance } = await setup();
  const fetcher = vi.fn(async () => new Response(JSON.stringify(metadata())));
  vi.stubGlobal('fetch', fetcher);
  let result = await service.check();
  const item = result.find((s) => s.kind === 'project')!;
  expect(item.status).toBe('available');
  expect(item.remind).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await service.check();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await service.snooze(item.candidateId!);
  expect(service.status('project')!.remind).toBe(false);
  advance();
  await service.check();
  expect(service.status('project')!.remind).toBe(true);
  fetcher.mockImplementation(
    async () => new Response(JSON.stringify(metadata(undefined, '99.0.0'))),
  );
  result = await service.check(true);
  expect(result[0]!.incompatibleVersion).toBe('9.0.0');
});
it('validates the archive and pins a candidate even if registry metadata changes', async () => {
  const { dir, service } = await setup();
  const pkg = path.join(dir, 'package');
  await fs.mkdir(pkg);
  await fs.cp(
    path.join(repo, 'packages/product/docs/dist'),
    path.join(pkg, 'dist'),
    { recursive: true },
  );
  const manifestPath = path.join(pkg, 'dist/builtin-release.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.packageVersion = '9.0.0';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await fs.writeFile(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: manifest.packageName, version: '9.0.0' }),
  );
  const archive = path.join(dir, 'test.tgz');
  await c({ cwd: dir, file: archive, gzip: true }, ['package']);
  const bytes = await fs.readFile(archive);
  const integrity =
    'sha512-' + createHash('sha512').update(bytes).digest('base64');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith('.tgz') ? bytes : JSON.stringify(metadata(integrity)),
        ),
    ),
  );
  const id = (await service.check())[0]!.candidateId!;
  await service.prepare(id);
  expect(service.resolve(id, 'project')!.releaseId).toBe(manifest.releaseId);
  expect(service.resolve(id, 'project')!.source).toContain(
    'builtin-package-cache',
  );
  const cached = service.resolve(id, 'project')!.source;
  await fs.writeFile(path.join(cached, '文档导航.verd-doc.json'), '{}');
  await service.prepare(id);
  expect(
    JSON.parse(
      await fs.readFile(path.join(cached, '文档导航.verd-doc.json'), 'utf8'),
    ).id,
  ).toBe('project-doc:README');
  await expect(service.prepare('untrusted-id')).resolves.toBeUndefined();
});
it('rejects integrity failures without creating a usable candidate', async () => {
  const { service } = await setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(url.endsWith('.tgz') ? 'bad' : JSON.stringify(metadata())),
    ),
  );
  const id = (await service.check())[0]!.candidateId!;
  await expect(service.prepare(id)).rejects.toThrow('完整性');
  expect(() => service.resolve(id, 'project')).toThrow('Prepare');
});
it.each([401, 404, 500])(
  'keeps bundled recovery available when registry returns %s',
  async (status) => {
    const { service } = await setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status })),
    );
    const result = await service.check();
    expect(result[0]!.error).toBeTruthy();
    expect(result[0]!.candidateId).toBeTruthy();
  },
);
it('uses user npm configuration without exposing or sending unrelated tokens', async () => {
  const { dir } = await setup();
  const file = path.join(dir, 'npmrc');
  await fs.writeFile(
    file,
    '//example.test/registry/:_authToken=${CONTENT_TOKEN}\n//other.test/:_authToken=unrelated',
  );
  expect(
    await npmAuthorization('https://example.test/registry/', {
      npm_config_userconfig: file,
      npm_config_globalconfig: path.join(dir, 'missing'),
      CONTENT_TOKEN: 'test-token',
    }),
  ).toBe('Bearer test-token');
  expect(
    await npmAuthorization('https://unknown.test/registry/', {
      npm_config_userconfig: file,
    }),
  ).toBeUndefined();
});

it('persists the check window across restarts and bypasses it after an application upgrade', async () => {
  const { dir, service } = await setup();
  const fetcher = vi.fn(async () => new Response(JSON.stringify(metadata())));
  vi.stubGlobal('fetch', fetcher);
  await service.check();
  expect(fetcher).toHaveBeenCalledTimes(2);
  const options = {
    userData: () => dir,
    appVersion: () => '1.0.0',
    source: (kind: 'project' | 'agent-patterns') =>
      path.join(
        repo,
        kind === 'project'
          ? 'workspace'
          : 'packages/product/agent-patterns/workspace',
      ),
    registry: 'http://localhost/registry/',
    authorization: async () => undefined,
    now: () => 100000001,
  };
  await createBuiltinPackageService(options).check();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await createBuiltinPackageService({
    ...options,
    appVersion: () => '1.1.0',
  }).check();
  expect(fetcher).toHaveBeenCalledTimes(4);
});
