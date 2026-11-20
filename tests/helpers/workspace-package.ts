import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { selectAppAction } from '../web-e2e/src/app-actions';

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const input = (page: Page) =>
  page.locator(
    'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
  );
function pdf() {
  const parts = ['%PDF-1.4\n'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...[1, 2].map((page) => {
      const stream = `BT /F1 16 Tf 40 200 Td (Package PDF page ${page}) Tj ET`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xref = Buffer.byteLength(parts.join(''));
  parts.push(
    `xref\n0 8\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  );
  return Buffer.from(parts.join(''));
}
export function nativePackageFixture() {
  const assets = [
    {
      name: 'photo.png',
      mime: 'image/png',
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSWQAAAAASUVORK5CYII=',
        'base64',
      ),
    },
    { name: 'reference.pdf', mime: 'application/pdf', bytes: pdf() },
    {
      name: 'recording.wav',
      mime: 'audio/wav',
      bytes: readFileSync(
        path.join(__dirname, '../fixtures/resources/recording.wav'),
      ),
    },
    {
      name: 'recording.webm',
      mime: 'video/webm',
      bytes: readFileSync(
        path.join(__dirname, '../fixtures/resources/recording.webm'),
      ),
    },
  ].map((asset) => ({
    ...asset,
    assetId:
      createHash('sha256').update(asset.bytes).digest('hex') +
      '.' +
      asset.name.split('.').pop(),
  }));
  const src = (index: number) =>
    'verd-asset:.verd-resources/assets/' + assets[index].assetId;
  const note = {
    format: 'verd-document',
    version: 1,
    id: 'package-note',
    title: 'Package note',
    text: {
      id: 'package-note',
      schemaVersion: 1,
      kind: 'block',
      plainText: '',
      content: {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: src(0), alt: 'Package image' } },
          ...assets.slice(1).map((asset, i) => ({
            type: 'attachment',
            attrs: {
              src: src(i + 1),
              name: asset.name,
              mime: asset.mime,
              size: asset.bytes.length,
            },
          })),
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Open PDF page two',
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      href: 'verd://asset/' + assets[1].assetId + '#page=2',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
  const board = {
    format: 'verd-frame',
    version: 2,
    frame: {
      id: 'package-board',
      name: 'Package board',
      kind: 'frame',
      cellType: 'frame',
      geometry: { x: 0, y: 0, width: 960, height: 640 },
      children: ['package-reference'],
      groups: [],
    },
    cells: {
      'package-reference': {
        id: 'package-reference',
        kind: 'document-reference',
        cellType: 'node',
        geometry: { x: 40, y: 40, width: 400, height: 300 },
        data: { targetDocumentId: note.id },
      },
    },
  };
  const nested = {
    ...board,
    frame: {
      ...board.frame,
      id: 'package-nested-board',
      name: 'Nested package board',
    },
  };
  const outer = {
    ...board,
    frame: { ...board.frame, children: ['package-outer-reference'] },
    cells: {
      'package-outer-reference': {
        id: 'package-outer-reference',
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 40, y: 40, width: 600, height: 400 },
        data: { targetFrameId: nested.frame.id },
      },
    },
  };
  return {
    assets,
    value: {
      format: 'verd-canvas-bundle',
      version: 2,
      rootFileId: 'package-board',
      files: [outer, nested, note],
      resources: assets.map((asset) => ({
        assetId: asset.assetId,
        encoding: 'base64',
        byteLength: asset.bytes.length,
        data: asset.bytes.toString('base64'),
      })),
    },
  };
}
async function openFile(page: Page, name: string) {
  await page
    .locator('.file-tree-name')
    .filter({ hasText: new RegExp('^' + name + '$') })
    .click();
  await expect(page.locator('.workspace-content')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(active(page)).toBeVisible();
}
export async function exerciseNativePackage(
  page: Page,
  readDownload?: (action: () => Promise<void>) => Promise<Buffer>,
) {
  const { assets, value } = nativePackageFixture();
  await input(page).setInputFiles({
    name: 'package.verd',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await openFile(page, 'Package board');
  const action = () => selectAppAction(page, '导出');
  const bytes = readDownload
    ? await readDownload(action)
    : await (async () => {
        const downloading = page.waitForEvent('download');
        await action();
        const stream = await (await downloading).createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      })();
  const exported = JSON.parse(bytes.toString());
  expect(exported.version).toBe(2);
  expect(exported.files).toHaveLength(3);
  expect(exported.resources).toHaveLength(4);
  for (const asset of assets)
    expect(
      Buffer.from(
        exported.resources.find(
          (resource: { assetId: string }) => resource.assetId === asset.assetId,
        ).data,
        'base64',
      ),
    ).toEqual(asset.bytes);
  return { exported, assets };
}
export async function importAndReadNativePackage(
  page: Page,
  exported: unknown,
  assets: ReturnType<typeof nativePackageFixture>['assets'],
) {
  await input(page).setInputFiles({
    name: 'restored.verd',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await openFile(page, 'Package note');
  const image = active(page).getByAltText('Package image');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await active(page)
    .getByRole('link', { name: 'Open PDF page two' })
    .click({ modifiers: ['ControlOrMeta'] });
  const reader = page.getByRole('dialog', {
    name: assets[1].assetId,
    exact: true,
  });
  await expect(reader.locator('.textLayer')).toContainText(
    'Package PDF page 2',
  );
  await reader.getByRole('button', { name: '关闭', exact: true }).click();
  for (const asset of assets.slice(1)) {
    await active(page)
      .locator('.workspace-resource-card')
      .filter({ hasText: asset.name })
      .getByRole('button', { name: '打开资料' })
      .click();
    const dialog = page.getByRole('dialog', { name: asset.name, exact: true });
    if (/^(audio|video)\//.test(asset.mime)) {
      const media = dialog.locator(
        asset.mime.startsWith('audio/') ? 'audio' : 'video',
      );
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await media.evaluate(async (element: HTMLMediaElement) => {
        element.muted = true;
        await element.play();
      });
      await expect
        .poll(() =>
          media.evaluate((element: HTMLMediaElement) => element.currentTime),
        )
        .toBeGreaterThan(0);
      await media.evaluate((element: HTMLMediaElement) => element.pause());
    }
    const url = await dialog
      .getByRole('link', { name: '下载原件' })
      .getAttribute('href');
    const bytes = await page.evaluate(
      async (source) =>
        Array.from(new Uint8Array(await (await fetch(source!)).arrayBuffer())),
      url,
    );
    expect(Buffer.from(bytes)).toEqual(asset.bytes);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
}
