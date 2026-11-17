import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const legacy = '.verd-resources';
const current = '.verdscrolls/resources';
const archive = '.verdscrolls/migration/resources-v1-legacy';
const marker = '.verdscrolls/migration/resources-v1.json';

async function put(root: string, relative: string, bytes: string | Buffer) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), bytes);
}

export async function seedResourceMigration(root: string) {
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSWQAAAAASUVORK5CYII=',
    'base64',
  );
  const name = createHash('sha256').update(image).digest('hex') + '.png';
  const document = (text: string) => ({
    format: 'verd-document',
    version: 1,
    id: 'migration-note',
    title: 'Migration note',
    text: {
      schemaVersion: 1,
      id: 'migration-note',
      kind: 'block',
      plainText: text,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text }] },
          {
            type: 'image',
            attrs: { src: 'verd-asset:' + legacy + '/assets/' + name },
          },
        ],
      },
    },
  });
  await put(
    root,
    '.verdscrolls/config.json',
    JSON.stringify({
      version: 1,
      value: { identity: 'migration-target', name: 'Migrated resources' },
    }),
  );
  await put(
    root,
    'note.verd-doc.json',
    JSON.stringify(document('Current migration document')),
  );
  await put(root, legacy + '/assets/shared.bin', 'same bytes');
  await put(root, current + '/assets/shared.bin', 'same bytes');
  await put(root, legacy + '/assets/' + name, image);
  await put(root, current + '/assets/current.bin', 'current only');
  await put(root, current + '/runtime/manifest.json', '{"runtime":"keep"}');
  await put(
    root,
    legacy + '/history/old.snapshot.json',
    JSON.stringify(document('Earlier migration document')),
  );
  await put(
    root,
    legacy + '/history/index.json',
    JSON.stringify({
      version: 1,
      revisions: [
        {
          id: 'old',
          fileId: 'migration-note',
          title: 'Migration note',
          name: 'Before migration',
          at: 1,
          path: legacy + '/history/old.snapshot.json',
        },
      ],
    }),
  );
  return {
    legacy: await resourceFiles(root, legacy),
    current: await resourceFiles(root, current),
    native: await readFile(path.join(root, 'note.verd-doc.json')),
  };
}

async function resourceFiles(
  root: string,
  relative: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      for (const [name, bytes] of Object.entries(
        await resourceFiles(root, relative + '/' + entry.name),
      ))
        result[entry.name + '/' + name] = bytes;
    } else
      result[entry.name] = (
        await readFile(path.join(root, relative, entry.name))
      ).toString('base64');
  }
  return result;
}

export async function expectResourceMigration(
  root: string,
  before: Awaited<ReturnType<typeof seedResourceMigration>>,
) {
  expect(await resourceFiles(root, archive)).toEqual(before.legacy);
  expect(await resourceFiles(root, current)).toEqual({
    ...before.current,
    ...before.legacy,
  });
  expect(await readFile(path.join(root, 'note.verd-doc.json'))).toEqual(
    before.native,
  );
  expect(await readFile(path.join(root, marker), 'utf8')).toBe(
    '{"version":1}\n',
  );
  expect(await readdir(root)).not.toContain(legacy);
}

export async function expectMigrationUI(page: Page) {
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    'Migrated resources',
  );
  await page
    .locator('.file-tree-file[data-file-id="migration-note"] .file-tree-main')
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await expect(pane.locator('.tiptap')).toContainText(
    'Current migration document',
  );
  await expect
    .poll(() =>
      pane
        .locator('.tiptap img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await pane.getByRole('button', { name: '内容管理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '内容管理', exact: true });
  await dialog.getByRole('tab', { name: '版本历史', exact: true }).click();
  const revision = dialog.locator('.workspace-revision-row', {
    hasText: 'Before migration',
  });
  await expect(revision).toBeVisible();
  await revision.getByRole('button', { name: '预览', exact: true }).click();
  await expect(dialog).toContainText('Earlier migration document');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByText(/Resource migration conflict/)).toHaveCount(0);
}
