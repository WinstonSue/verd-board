import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Editor, getSchema } from '@tiptap/react';
import type { BoardTextDocument } from '@sue/board-common';
import { createDocumentExtensions } from './constants/editor-config';

const workspace = path.resolve(__dirname, '../../../../workspace');
const documentPaths = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory()
      ? documentPaths(target)
      : entry.name.endsWith('.verd-doc.json')
        ? [target]
        : [];
  });
const documents = documentPaths(workspace)
  .sort()
  .map((filePath) => ({
    filePath,
    file: JSON.parse(readFileSync(filePath, 'utf8')) as {
      format: string;
      version: number;
      id: string;
      text: BoardTextDocument;
    },
  }));

describe('built-in workspace native documents', () => {
  it('contains all 21 documents with distinct file and matching body identities', () => {
    expect(documents).toHaveLength(21);
    expect(new Set(documents.map(({ file }) => file.id)).size).toBe(21);
    for (const { file } of documents) {
      expect(file.format).toBe('verd-document');
      expect(file.version).toBe(1);
      expect(file.text.id).toBe(file.id);
      expect(file.text.kind).toBe('block');
    }
  });

  it.each(
    documents.map(
      ({ filePath, file }) =>
        [path.relative(workspace, filePath), file] as const,
    ),
  )(
    'loads %s in the actual TipTap schema without losing content',
    (_filePath, file) => {
      const extensions = createDocumentExtensions();
      const schema = getSchema(extensions);
      const expected = schema.nodeFromJSON(file.text.content);
      expect(() => expected.check()).not.toThrow();
      const editor = new Editor({ extensions, content: file.text.content });
      try {
        expect(editor.getJSON()).toEqual(expected.toJSON());
        expect(editor.isEmpty).toBe(false);
      } finally {
        editor.destroy();
      }
    },
  );

  it('renders the complete long AI specification, including code and tables', () => {
    const file = documents.find(
      ({ file }) => file.id === 'project-doc:guides/ai-canvas-data-spec',
    )!.file;
    expect(file.text.plainText.length).toBeGreaterThan(70_000);
    const editor = new Editor({
      extensions: createDocumentExtensions(),
      content: file.text.content,
    });
    try {
      expect(editor.view.dom.querySelectorAll('pre').length).toBeGreaterThan(5);
      expect(editor.view.dom.querySelectorAll('table').length).toBeGreaterThan(
        5,
      );
      expect(editor.getText()).toContain('verd-frame');
      expect(editor.getText()).toContain('packages/engine/common/src/text');
      expect(editor.getJSON().content).toHaveLength(
        file.text.content.content!.length,
      );
    } finally {
      editor.destroy();
    }
  });
});
