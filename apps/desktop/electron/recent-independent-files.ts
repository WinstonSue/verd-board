import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { RecentIndependentFile } from '@sue/verd-board-app';
import { independentFileIdentity } from '@sue/verd-board-app/node';
import { createSerialQueue } from './storage-file';
import { supportedDesktopFile } from './file-associations';

type RecentEntry = { id: string; source: string };
const recentLimit = 20;

export function createRecentIndependentFiles(profile: () => string) {
  const enqueue = createSerialQueue();
  const filename = () => path.join(profile(), 'recent-independent-files.json');
  const read = async (): Promise<RecentEntry[]> => {
    try {
      const content: unknown = JSON.parse(
        await fs.readFile(filename(), 'utf8'),
      );
      return Array.isArray(content)
        ? content
            .filter(
              (entry): entry is RecentEntry =>
                typeof entry?.id === 'string' &&
                typeof entry?.source === 'string' &&
                path.isAbsolute(entry.source) &&
                supportedDesktopFile(entry.source),
            )
            .slice(0, recentLimit)
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };
  const change = (update: (entries: RecentEntry[]) => RecentEntry[]) =>
    enqueue(async () => {
      const file = filename();
      const entries = await read();
      const next = update(entries).slice(0, recentLimit);
      if (JSON.stringify(entries) === JSON.stringify(next)) return;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(next), {
          flag: 'wx',
          mode: 0o600,
        });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  return {
    async list(
      hasWorkspaceOwner: (source: string) => Promise<boolean>,
    ): Promise<RecentIndependentFile[]> {
      const entries = await read();
      const rows = await Promise.all(
        entries.map(async ({ id, source }) => {
          const available = await independentFileIdentity(source).then(
            () => true,
            () => false,
          );
          if (available && (await hasWorkspaceOwner(source))) return null;
          return {
            id,
            name: path.basename(source),
            folder: path.dirname(source),
            available,
          };
        }),
      );
      return rows.filter((row): row is RecentIndependentFile => row !== null);
    },
    async resolve(id: string) {
      const entry = (await read()).find((candidate) => candidate.id === id);
      if (!entry) throw new Error('最近文件记录不存在');
      return entry.source;
    },
    remember(source: string) {
      return change((entries) => [
        entries.find((entry) => entry.source === source) ?? {
          id: randomUUID(),
          source,
        },
        ...entries.filter((entry) => entry.source !== source),
      ]);
    },
    rename(source: string, destination: string) {
      return change((entries) => {
        if (!entries.some((entry) => entry.source === source)) return entries;
        return entries
          .filter((entry) => entry.source !== destination)
          .map((entry) =>
            entry.source === source ? { ...entry, source: destination } : entry,
          );
      });
    },
    forget(id: string) {
      return change((entries) => entries.filter((entry) => entry.id !== id));
    },
    forgetSource(source: string) {
      return change((entries) =>
        entries.filter((entry) => entry.source !== source),
      );
    },
  };
}
