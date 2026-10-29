import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import type { FrameSnapshot } from '@sue/board-core';
export async function importUmlMermaid(
  source: string,
  scene: 'uml-class' | 'uml-sequence',
): Promise<FrameSnapshot> {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const built = path.join(directory, 'mermaid-worker.js');
  const entry = await access(built).then(
    () => built,
    () => path.join(directory, 'mermaid-worker.mjs'),
  );
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: { source, scene },
      execArgv: [],
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('Mermaid import timed out'));
    }, 15000);
    worker.once(
      'message',
      (result: { snapshot?: FrameSnapshot; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (result.snapshot) resolve(result.snapshot);
        else reject(new Error(result.error ?? 'Mermaid import failed'));
      },
    );
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(new Error('Mermaid import worker exited: ' + code));
    });
  });
}
