import {
  extractSearchRecord,
  searchRecords,
  type SearchRecord,
} from './search';
import type { WorkspaceFile } from '@sue/verd-board-workspace';
const records = new Map<string, SearchRecord>();
let sequence = 0;
let updates = Promise.resolve();
self.onmessage = async ({ data }) => {
  if (data.type === 'update') {
    updates = updates.then(async () => {
      let processed = 0;
      for (const item of data.files as {
        file: WorkspaceFile;
        path: string;
      }[]) {
        const id =
          item.file.format === 'verd-document'
            ? item.file.id
            : item.file.frame.id;

        records.set(id, extractSearchRecord(item.file, item.path));
        if (++processed % 25 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      for (const id of (data.removed as string[]) ?? []) records.delete(id);
    });
    return;
  }
  const current = ++sequence;
  await updates;
  if (current !== sequence) return;
  const hits = [];
  const batch: SearchRecord[] = [];
  for (const record of records.values()) {
    batch.push(record);
    if (batch.length < 25) continue;
    hits.push(...searchRecords(batch, data.query, data.namesOnly));
    batch.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (current !== sequence) return;
  }
  hits.push(...searchRecords(batch, data.query, data.namesOnly));
  hits.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  self.postMessage({ id: data.id, hits });
};
