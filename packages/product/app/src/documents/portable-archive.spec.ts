// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { importMarkdownCollection, portableArchive } from './portable-archive';
import { createDocumentFile } from '@sue/verd-board-workspace';
const file = (name: string, content: string | Uint8Array) =>
  new File(
    [typeof content === 'string' ? content : (content as BlobPart)],
    name,
  );
describe('portable imports and exports', () => {
  it('keeps Skill documents out of Markdown content imports', async () => {
    const archive = zipSync({
      'notes/Project.md': strToU8('Project content'),
      '.agents/skills/verd-workspace/SKILL.md': strToU8(
        '---\nname: verd-workspace\ndescription: Writing\n---\nUse Chinese.',
      ),
      'project/.agents/skills/verd-pattern-architecture/SKILL.md': strToU8(
        'Skill in a selected directory',
      ),
    });
    const result = await importMarkdownCollection([
      file('project.zip', archive),
    ]);
    expect(result.files.map((item) => item.path)).toEqual([
      'notes/Project.verd-doc.json',
    ]);
  });
  it('preserves directories and resolves cyclic, relative, wiki links and images', async () => {
    const zip = zipSync({
      'notes/A.md': strToU8('# A\n[[B]]\n![image](pic.png)'),
      'notes/B.md': strToU8('[A](A.md#A)'),
      'notes/pic.png': new Uint8Array([1, 2, 3]),
    });
    const result = await importMarkdownCollection([file('notes.zip', zip)]);
    expect(result.files.map((item) => item.path)).toEqual([
      'notes/A.verd-doc.json',
      'notes/B.verd-doc.json',
    ]);
    const text = JSON.stringify(result.files[0].file.text.content);
    expect(text).toContain('verd://file/' + result.files[1].file.id);
    expect(text).toContain('data:image/png;base64,AQID');
    expect(result.warnings).toEqual([]);
  });
  it('reports ambiguous names and missing assets instead of guessing', async () => {
    const zip = zipSync({
      'A.md': strToU8('[[B]]\n![missing](absent.png)'),
      'one/B.md': strToU8('One'),
      'two/B.md': strToU8('Two'),
    });
    const result = await importMarkdownCollection([file('notes.zip', zip)]);
    expect(result.warnings.join(' ')).toContain('无法唯一定位');
    expect(result.warnings.join(' ')).toContain('缺失');
  });
  it('rejects zip traversal before creating any workspace candidate', async () => {
    await expect(
      importMarkdownCollection([
        file('bad.zip', zipSync({ '../escape.md': strToU8('bad') })),
      ]),
    ).rejects.toThrow('Unsafe');
  });
  it('exports native source plus Markdown and image bytes with a conversion report', () => {
    const doc = createDocumentFile('d', 'Images');
    doc.text.content = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'data:image/png;base64,AQID', alt: 'image' },
        },
      ],
    };
    const result = portableArchive(
      [doc],
      new Map([['d', 'notes/Images.verd-doc.json']]),
    );
    const zip = unzipSync(result.bytes);
    expect(Object.keys(zip)).toContain('native/notes/Images.verd-doc.json');
    expect(strFromU8(zip['notes/Images.md'])).toContain(
      '../attachments/0-0.png',
    );
    expect(zip['attachments/0-0.png']).toEqual(new Uint8Array([1, 2, 3]));
    expect(zip['import-report.json']).toBeDefined();
  });
});

it('round-trips a portable native archive without losing properties or stable blocks', async () => {
  const doc = createDocumentFile('stable', 'Source');
  doc.properties = { tags: ['design'], status: 'review' };
  doc.text.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'decision' },
        content: [{ type: 'text', text: 'Decision' }],
      },
    ],
  };
  const archive = portableArchive(
    [doc],
    new Map([['stable', 'notes/Source.verd-doc.json']]),
  );
  const imported = await importMarkdownCollection([
    file('portable.zip', archive.bytes),
  ]);
  expect(imported.files[0].file).toEqual(doc);
  expect(imported.files[0].path).toBe('notes/Source.verd-doc.json');
});
