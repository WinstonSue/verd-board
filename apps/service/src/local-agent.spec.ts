import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  decodeServiceValue,
  encodeServiceValue,
  type ServiceValue,
  type WorkspaceHandle,
} from '@sue/verd-board-app/headless';
import { createLocalService } from './service';

it('requires a trusted origin and the caller workspace lease', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-agent-http-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  const service = await createLocalService({
    dataRoot: path.join(root, 'data'),
    defaultRoot: workspace,
    builtinSource: '',
    patternSource: '',
    productVersion: '0.1.0',
    localCodex: true,
  });
  try {
    const origin = 'http://127.0.0.1:' + (await service.listen(0));
    const connect = async () => {
      const response = await fetch(origin + '/api/v1/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ pageId: randomUUID() }),
      });
      const result = (await response.json()) as {
        token: string;
        localAgent: boolean;
      };
      expect(result.localAgent).toBe(true);
      return result.token;
    };
    const call = (
      token: string,
      method: string,
      args: unknown[],
      sender?: string,
    ) =>
      fetch(origin + '/api/v1/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Verd-Session': token,
          ...(sender && { Origin: sender }),
        },
        body: JSON.stringify(encodeServiceValue({ method, args })),
      });
    const decode = async (response: Response) =>
      decodeServiceValue((await response.json()) as ServiceValue) as {
        value?: unknown;
        error?: { message: string };
      };
    const a = await connect();
    const b = await connect();
    const result = await decode(
      await call(a, 'openWorkspace', [{ path: workspace }], origin),
    );
    const handle = result.value as WorkspaceHandle;
    expect(handle.key).toBeTruthy();
    const request = { type: 'handoff', task: { task: 'Summarize this' } };
    const args = [handle, request];
    expect(
      (await decode(await call(b, 'localAgent', args, origin))).error,
    ).toMatchObject({ message: 'Unknown workspace handle' });
    expect(
      (await decode(await call(a, 'localAgent', args))).error,
    ).toMatchObject({ message: 'Unknown service method' });
    const crossOrigin = await call(
      a,
      'localAgent',
      args,
      'https://elsewhere.invalid',
    );
    expect(crossOrigin.status).toBe(403);
    const handoff = await decode(await call(a, 'localAgent', args, origin));
    expect(handoff.value).toMatchObject({
      prompt: expect.stringContaining('Summarize this'),
      url: expect.stringContaining('codex://threads/new?'),
    });
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
