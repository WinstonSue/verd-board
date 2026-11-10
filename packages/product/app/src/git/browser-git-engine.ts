import {
  createWorkspaceGitEngine,
  type GitWorkspaceData,
  type GitWorkspaceStorage,
} from './workspace-git-engine';
import type {
  WorkspaceGitRequest,
  WorkspaceGitResult,
} from '../host/workspace-git';

type Engine = ((
  request: WorkspaceGitRequest,
) => Promise<WorkspaceGitResult>) & { dispose(): void };

export function createBrowserGitEngine(storage: GitWorkspaceStorage): Engine {
  if (typeof Worker === 'undefined')
    return Object.assign(createWorkspaceGitEngine(storage), { dispose() {} });
  const worker = new Worker(
    new URL('./workspace-git-worker.ts', import.meta.url),
    { type: 'module' },
  );
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve(value: WorkspaceGitResult): void; reject(error: Error): void }
  >();
  const failAll = (error: Error) => {
    for (const callback of pending.values()) callback.reject(error);
    pending.clear();
  };
  worker.onerror = (event) =>
    failAll(new Error(event.message || 'Git worker failed'));
  worker.onmessage = (event) => {
    const message = event.data as {
      type: string;
      id: number;
      payload?: unknown;
      error?: string;
    };
    if (message.type === 'result') {
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(message.error));
      else callback.resolve(message.payload as WorkspaceGitResult);
      return;
    }
    void (async () => {
      try {
        let payload: unknown;
        if (message.type === 'load') payload = await storage.load();
        else if (message.type === 'publish') {
          const data = message.payload as {
            before: GitWorkspaceData;
            after: GitWorkspaceData;
          };
          await storage.publish(data.before, data.after);
        } else throw new Error('Unknown Git worker request');
        worker.postMessage({ type: 'reply', id: message.id, payload });
      } catch (error) {
        worker.postMessage({
          type: 'reply',
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };
  const engine = (request: WorkspaceGitRequest) =>
    new Promise<WorkspaceGitResult>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ type: 'run', id, request });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  return Object.assign(engine, {
    dispose() {
      failAll(new Error('Workspace Git worker closed'));
      worker.terminate();
    },
  });
}
