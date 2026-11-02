#!/usr/bin/env node
import { createFsWorkspaceHost } from './node/workspace-host-fs';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { patterns, patternRules } from '@sue/verd-board-agent-patterns';
import {
  isWorkspaceFile,
  storeAttachment,
  openWorkspaceSession,
  workspaceFileId,
  validateNativeWorkspace,
  WORKSPACE_RULES,
} from '@sue/verd-board-app/headless';
import { describeAuthoring, prepareAuthoringBatch } from './authoring';
import { applyPreparedBatch } from './apply';
import { readNativeSnapshot } from './node/workspace-lock';
import { initializePatternWorkspace } from './node/pattern-workspace';
import { discoverWorkspace } from './node/workspace-metadata';
import {
  readWorkspaceProjectContext,
  inspectWorkspaceAgent,
} from './node/workspace-project';
import { initializeWorkspaceProject } from './node/workspace-init';
import type { PreparedBatch } from './types';
import { deriveBoardTextPlainText } from '@sue/board-common';

async function readJson(input: string) {
  if (input !== '-') return JSON.parse(await fs.readFile(input, 'utf8'));
  let source = '';
  for await (const chunk of process.stdin) source += chunk;
  return JSON.parse(source);
}
export async function runCli(
  args: string[],
): Promise<{ result: unknown; exitCode?: number }> {
  const requestedCommand = args.shift() ?? 'help';
  const command = ['--help', '-h'].includes(requestedCommand)
    ? 'help'
    : requestedCommand;
  const flags = new Map<string, string>();
  const positional: string[] = [];
  while (args.length) {
    const arg = args.shift()!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (flags.has(key)) throw new Error('Repeated option: ' + key);
      flags.set(
        key,
        ['json', 'install-browser', 'repair'].includes(key)
          ? 'true'
          : args[0] && !args[0].startsWith('--')
            ? args.shift()!
            : 'true',
      );
    } else positional.push(arg);
  }
  const option = (name: string, fallback?: string) => {
    const value = flags.get(name) ?? fallback;
    if (!value || value === 'true') throw new Error('Missing --' + name);
    return value;
  };
  const workspace = flags.has('workspace') ? option('workspace') : undefined;
  const extras: Record<string, string[]> = {
    patterns: ['dest'],
    plan: ['input', 'out'],
    'resource-import': ['input', 'mime'],
    validate: ['plan', 'profile'],
    preview: ['plan', 'out', 'install-browser'],
    apply: ['plan'],
    init: ['shared', 'name'],
    doctor: ['repair', 'shared'],
  };
  const allowed = new Set(['workspace', 'json', ...(extras[command] ?? [])]);
  for (const key of flags.keys())
    if (!allowed.has(key)) throw new Error('Unknown option: --' + key);
  if (command === 'help')
    return {
      result: {
        commands: [
          'describe',
          'resource-import --input FILE [--mime MIME]',
          'context',
          'init [--name NAME] [--shared RESOURCE_DIR]',
          'doctor [--repair] [--shared RESOURCE_DIR]',
          'rules',
          'patterns [id]',
          'patterns workspace --dest PATH',
          'inspect [fileId]',
          'plan --input OPS.json [--out PLAN.json]',
          'validate [--plan PLAN.json]',
          'preview FILE_ID --out IMAGE.png [--plan PLAN.json]',
          'preview --install-browser',
          'apply --plan PLAN.json',
          'skill',
        ],
        common: '--workspace PATH --json',
      },
    };
  if (command === 'skill')
    return {
      result: {
        path: path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          '../skills/verd-authoring/SKILL.md',
        ),
      },
    };
  if (command === 'describe') return { result: describeAuthoring() };
  if (command === 'rules')
    return { result: { runtime: WORKSPACE_RULES, design: patternRules } };
  if (command === 'patterns') {
    if (positional[0] === 'workspace')
      return { result: await initializePatternWorkspace(option('dest')) };
    const result = positional[0]
      ? patterns.find((p) => p.id === positional[0])
      : patterns;
    if (!result) throw new Error('Unknown pattern');
    return { result };
  }
  if (command === 'preview' && flags.has('install-browser')) {
    const require = createRequire(import.meta.url);
    const result = spawnSync(
      process.execPath,
      [require.resolve('playwright/cli'), 'install', 'chromium'],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error('Browser installation failed');
    return { result: { installed: 'chromium' } };
  }
  if (command === 'init' || (command === 'doctor' && flags.has('repair'))) {
    const root =
      command === 'init'
        ? path.resolve(workspace ?? process.cwd())
        : await discoverWorkspace(process.cwd(), workspace);
    const context = await initializeWorkspaceProject(root, {
      name: flags.has('name') ? option('name') : undefined,
      resources: flags.has('shared')
        ? option('shared')
        : process.env['VERD_AGENT_RESOURCES'],
    });
    return { result: context, exitCode: context.agent.ready ? 0 : 1 };
  }
  if (command === 'doctor') {
    const root = await discoverWorkspace(process.cwd(), workspace);
    return { result: { root, ...(await inspectWorkspaceAgent(root)) } };
  }
  if (
    ![
      'context',
      'inspect',
      'plan',
      'validate',
      'preview',
      'apply',
      'resource-import',
    ].includes(command)
  )
    throw new Error('Unknown command: ' + command);
  const root = await discoverWorkspace(process.cwd(), workspace);
  if (command === 'resource-import') {
    const source = path.resolve(option('input'));
    const name = path.basename(source);
    const extension = path.extname(name).toLowerCase();
    const mime =
      flags.get('mime') ||
      (
        {
          '.pdf': 'application/pdf',
          '.mp3': 'audio/mpeg',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.wav': 'audio/wav',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
        } as Record<string, string>
      )[extension] ||
      'application/octet-stream';
    const limit =
      (/^image\//.test(mime) ? 10 : /^(audio|video)\//.test(mime) ? 100 : 50) *
      1024 *
      1024;
    if ((await fs.stat(source)).size > limit)
      throw new Error('Attachment exceeds size limit');
    const host = createFsWorkspaceHost({ defaultRoot: () => root });
    const handle = await host.openWorkspace({ path: root });
    if (!handle) throw new Error('Workspace could not be opened');
    const session = await openWorkspaceSession(host, handle);
    try {
      return {
        result: await storeAttachment(
          session,
          new File([await fs.readFile(source)], name, { type: mime }),
        ),
      };
    } finally {
      await host.closeWorkspace(handle);
    }
  }
  if (command === 'context')
    return { result: await readWorkspaceProjectContext(root) };
  if (command === 'apply')
    return {
      result: await applyPreparedBatch(
        root,
        (await readJson(option('plan'))) as PreparedBatch,
      ),
    };
  if (!['inspect', 'plan', 'validate', 'preview'].includes(command))
    throw new Error('Unknown command: ' + command);
  const snapshot = await readNativeSnapshot(root);
  if (command === 'inspect') {
    const entries = positional[0]
      ? snapshot.entries.filter(
          (e) =>
            (isWorkspaceFile(e.file) &&
              workspaceFileId(e.file) === positional[0]) ||
            e.path === positional[0],
        )
      : snapshot.entries;
    if (positional[0] && !entries.length) throw new Error('Unknown file');
    return {
      result: {
        root: snapshot.root,
        version: snapshot.version,
        entries: entries.map((e) => {
          if (!isWorkspaceFile(e.file))
            return { path: e.path, version: e.version, invalid: true };
          const file = e.file;
          const metadata = {
            path: e.path,
            version: e.version,
            fileId: workspaceFileId(file),
            format: file.format,
            title:
              file.format === 'verd-document' ? file.title : file.frame.name,
          };
          return positional[0]
            ? {
                ...metadata,
                file,
                ...(file.format === 'verd-document'
                  ? {
                      blocks: file.text.content.content?.map((b, index) => ({
                        index,
                        type: b.type,
                        text: deriveBoardTextPlainText(b).slice(0, 200),
                      })),
                    }
                  : {}),
              }
            : metadata;
        }),
        diagnostics: [
          ...snapshot.diagnostics,
          ...validateNativeWorkspace(snapshot.entries),
        ],
      },
    };
  }
  if (command === 'plan') {
    const input = await readJson(option('input'));
    const result = await prepareAuthoringBatch(
      snapshot,
      Array.isArray(input) ? input : input.operations,
    );
    if (flags.has('out')) {
      if (/\.verd(?:-doc)?\.json$/.test(option('out')))
        throw new Error('Plan output must not be a native content file');
      await fs.writeFile(option('out'), JSON.stringify(result, null, 2) + '\n');
    }
    return {
      result: flags.has('out')
        ? {
            planFile: path.resolve(option('out')),
            transactionId: result.transactionId,
            workspaceVersion: result.workspaceVersion,
            changes: result.changes,
            idMap: result.idMap,
            diagnostics: result.diagnostics,
          }
        : result,
      exitCode: result.diagnostics.some((d) => d.severity === 'error') ? 1 : 0,
    };
  }
  let entries = snapshot.entries;
  if (flags.has('plan')) {
    const plan = (await readJson(option('plan'))) as PreparedBatch;
    if (
      plan.workspaceVersion !== snapshot.version ||
      (plan.resourceId ?? null) !== (snapshot.resourceId ?? null)
    )
      throw new Error(
        'VERSION_CONFLICT: workspace or shared tool/specification version changed; prepare again',
      );
    const removed = new Set([
      ...plan.removeIds,
      ...plan.files.map((e) => workspaceFileId(e.file)),
    ]);
    entries = [
      ...entries.filter(
        (e) =>
          !isWorkspaceFile(e.file) || !removed.has(workspaceFileId(e.file)),
      ),
      ...plan.files.map((e) => ({ ...e, source: '', version: '' })),
    ];
  }
  if (command === 'validate') {
    const profile = flags.get('profile') ?? 'authoring';
    if (profile !== 'runtime' && profile !== 'authoring')
      throw new Error('Unknown validation profile');
    const diagnostics = [
      ...snapshot.diagnostics,
      ...validateNativeWorkspace(entries, { profile }),
    ];
    return {
      result: {
        valid: !diagnostics.some((d) => d.severity === 'error'),
        diagnostics,
      },
      exitCode: diagnostics.some((d) => d.severity === 'error') ? 1 : 0,
    };
  }
  const { previewAuthoring } = await import('./preview');
  if (!positional[0]) throw new Error('Missing preview file ID');
  return {
    result: await previewAuthoring(
      entries
        .filter((e) => isWorkspaceFile(e.file))
        .map((e) => e.file as never),
      positional[0],
      option('out'),
      { workspaceRoot: root },
    ),
  };
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli(process.argv.slice(2)).then(
    ({ result, exitCode }) => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exitCode = exitCode ?? 0;
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(JSON.stringify({ error: message }) + '\n');
      process.exitCode = message.startsWith('VERSION_CONFLICT')
        ? 3
        : message.startsWith('VALIDATION_FAILED')
          ? 1
          : 2;
    },
  );
}
