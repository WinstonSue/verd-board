import {
  createWorkspaceGitEngine,
  type GitWorkspaceData,
} from '@sue/verd-board-workspace';
import type { WorkspaceGitRequest } from '@sue/verd-board-workspace';

// Git graph traversal, hashing, compression and validation stay off the UI thread.
// The host retains the only authority to publish the resulting overlay.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};
let sequence = 0;
const callbacks = new Map<
  number,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
const host = (operation: 'load' | 'publish', payload?: unknown) =>
  new Promise<unknown>((resolve, reject) => {
    const id = ++sequence;
    callbacks.set(id, { resolve, reject });
    scope.postMessage({ type: operation, id, payload });
  });
const engine = createWorkspaceGitEngine({
  load: async () => (await host('load')) as GitWorkspaceData,
  publish: async (before, after) => {
    await host('publish', { before, after });
  },
});
scope.onmessage = (event) => {
  const message = event.data as {
    type: string;
    id: number;
    payload?: unknown;
    error?: string;
    request?: WorkspaceGitRequest;
  };
  if (message.type === 'reply') {
    const callback = callbacks.get(message.id);
    if (!callback) return;
    callbacks.delete(message.id);
    if (message.error) callback.reject(new Error(message.error));
    else callback.resolve(message.payload);
  } else if (message.type === 'run' && message.request) {
    void engine(message.request).then(
      (result) =>
        scope.postMessage({ type: 'result', id: message.id, payload: result }),
      (error) =>
        scope.postMessage({
          type: 'result',
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }
};
