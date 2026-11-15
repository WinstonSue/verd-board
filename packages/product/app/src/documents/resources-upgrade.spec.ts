import { it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createDocumentFile } from '@sue/verd-board-workspace';
import {
  portableArchiveWithAssets,
  importMarkdownCollection,
} from './portable-archive';
it('portable v2 stores original attachment bytes once and imports native references', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  const bytes = new TextEncoder().encode('original PDF bytes');
  const hash = [
    ...new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const src = `verd-asset:.verd-resources/assets/${hash}.pdf`;
  const document = createDocumentFile('archive', 'Archive');
  document.text.content.content = [
    {
      type: 'attachment',
      attrs: {
        src,
        name: 'paper.pdf',
        mime: 'application/pdf',
        size: bytes.length,
      },
    },
  ];
  const result = await portableArchiveWithAssets(
    [document],
    new Map([['archive', 'Archive.verd-doc.json']]),
    async () => bytes,
  );
  const input = {
    name: 'archive.zip',
    arrayBuffer: async () =>
      result.bytes.buffer.slice(
        result.bytes.byteOffset,
        result.bytes.byteOffset + result.bytes.byteLength,
      ),
  } as File;
  const imported = await importMarkdownCollection([input]);
  expect(imported.files[0].file).toEqual(document);
  expect(Array.from(imported.resources?.[0].content ?? [])).toEqual(
    Array.from(bytes),
  );
});
