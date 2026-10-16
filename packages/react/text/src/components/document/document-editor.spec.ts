// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { createBlockText } from '@sue/board-common';
import { createDocumentExtensions } from '../../constants/editor-config';
import { createDocumentController } from './document-controller';
import { DocumentGroupTracker, INPUT_GROUP_MS } from './document-groups';
import { findInDocument } from './document-search';
import type { DocumentChangeSource } from '../../types/document';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

const makeEditor = (content?: object, history = true) => {
  const editor = new Editor({
    extensions: createDocumentExtensions({ history }),
    content: content ?? createBlockText('').content,
  });
  editors.push(editor);
  return editor;
};

const makeController = (editor: Editor, document = createBlockText('')) => {
  const sources: DocumentChangeSource[] = [];
  const controller = createDocumentController(editor, {
    withSource: (source, run) => {
      sources.push(source);
      run();
    },
    getBaseDocument: () => document,
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    canUndo: () =>
      typeof editor.commands.undo === 'function' && editor.can().undo(),
    canRedo: () =>
      typeof editor.commands.redo === 'function' && editor.can().redo(),
  });
  return { controller, sources };
};

const doc = (...blocks: object[]) => ({ type: 'doc', content: blocks });
const paragraph = (...texts: object[]) => ({
  type: 'paragraph',
  content: texts,
});
const text = (t: string, marks?: object[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const heading = (level: number, t: string) => ({
  type: 'heading',
  attrs: { level },
  ...(t ? { content: [{ type: 'text', text: t }] } : {}),
});

describe('createDocumentExtensions', () => {
  it('disables the local undo history when a central adapter is used', () => {
    const withHistory = makeEditor(undefined, true);
    const withoutHistory = makeEditor(undefined, false);
    expect(withHistory.can().undo()).toBe(false);
    withoutHistory.commands.insertContent('hi');
    // With undoRedo off there is no local undo stack at all.
    expect(typeof withoutHistory.commands.undo).toBe('undefined');
    expect(withoutHistory.getText()).toBe('hi');
  });
});

describe('findInDocument', () => {
  it('matches across marks inside one block but never across blocks', () => {
    const editor = makeEditor(
      doc(
        paragraph(text('foo'), text('bar', [{ type: 'bold' }]), text('baz')),
        paragraph(text('barqux')),
      ),
    );
    // 'foobarbaz' spans the bold mark inside the first paragraph.
    expect(findInDocument(editor.state.doc, 'foobarbaz')).toEqual([
      { from: 1, to: 10 },
    ]);
    // 'bazbar' would have to cross the paragraph boundary.
    expect(findInDocument(editor.state.doc, 'bazbar')).toEqual([]);
  });

  it('never matches across atom nodes and honors case sensitivity', () => {
    const editor = makeEditor(
      doc(
        paragraph(
          text('ab'),
          { type: 'image', attrs: { src: 'x' } },
          text('cd'),
        ),
        paragraph(text('AB')),
      ),
    );
    expect(findInDocument(editor.state.doc, 'abcd')).toEqual([]);
    expect(findInDocument(editor.state.doc, 'ab')).toHaveLength(2);
    expect(
      findInDocument(editor.state.doc, 'ab', /* caseSensitive */ true),
    ).toHaveLength(1);
  });
});

describe('DocumentGroupTracker', () => {
  const tracker = () => new DocumentGroupTracker();
  const fakeTr = (inserted: number, deleted: number) => {
    const step = {
      getMap: () => ({
        forEach: (fn: (a: number, b: number, c: number, d: number) => void) =>
          fn(0, deleted, 0, inserted),
      }),
    };
    return { steps: [step] } as never;
  };

  it('merges a typing burst and splits on the 500ms boundary', () => {
    const t = tracker();
    const t0 = 1_000_000;
    const g1 = t.groupFor('input', fakeTr(1, 0), t0);
    expect(t.groupFor('input', fakeTr(1, 0), t0 + 100)).toBe(g1);
    expect(
      t.groupFor('input', fakeTr(1, 0), t0 + 100 + INPUT_GROUP_MS + 1),
    ).not.toBe(g1);
  });

  it('keeps insertion and deletion runs in separate groups', () => {
    const t = tracker();
    const t0 = 2_000_000;
    const insert = t.groupFor('input', fakeTr(1, 0), t0);
    const erase = t.groupFor('input', fakeTr(0, 1), t0 + 10);
    expect(erase).not.toBe(insert);
    expect(t.groupFor('input', fakeTr(0, 1), t0 + 20)).toBe(erase);
  });

  it('gives Enter, non-input sources and IME compositions their own groups', () => {
    const t = tracker();
    const t0 = 3_000_000;
    t.groupFor('input', fakeTr(1, 0), t0);
    t.breakStructural();
    const enter = t.groupFor('input', fakeTr(2, 0), t0 + 10);
    const paste = t.groupFor('paste', fakeTr(5, 0), t0 + 20);
    expect(paste).not.toBe(enter);
    expect(t.groupFor('paste', fakeTr(5, 0), t0 + 30)).not.toBe(paste);
    t.compositionStart();
    const ime1 = t.groupFor('composition', fakeTr(1, 0), t0 + 40);
    expect(t.groupFor('composition', fakeTr(1, 0), t0 + 5000)).toBe(ime1);
    t.compositionEnd();
    expect(t.groupFor('input', fakeTr(1, 0), t0 + 6000)).not.toBe(ime1);
  });

  it('ends the run on explicit caret moves and external restores', () => {
    const t = tracker();
    const t0 = 4_000_000;
    const g1 = t.groupFor('input', fakeTr(1, 0), t0);
    t.breakInputGroup();
    expect(t.groupFor('input', fakeTr(1, 0), t0 + 10)).not.toBe(g1);
    const g2 = t.groupFor('input', fakeTr(1, 0), t0 + 20);
    t.externalRestore();
    expect(t.groupFor('input', fakeTr(1, 0), t0 + 30)).not.toBe(g2);
  });
});

describe('createDocumentController', () => {
  it('commits content, keeps identity and reports toolbar state', () => {
    const document = createBlockText('hello');
    const editor = makeEditor(document.content);
    const { controller } = makeController(editor, document);
    editor.commands.selectAll();
    controller.toggleMark('bold');
    controller.setHeading(2);
    const committed = controller.commit();
    expect(committed.id).toBe(document.id);
    expect(committed.content.content?.[0].type).toBe('heading');
    expect(committed.content.content?.[0].content?.[0].marks).toContainEqual({
      type: 'bold',
    });
    const state = controller.getToolbarState();
    expect(state.block).toBe('heading');
    expect(state.headingLevel).toBe(2);
    expect(state.marks.bold).toBe(true);
  });

  it('lists headings for the table of contents and locates them', () => {
    const editor = makeEditor(
      doc(
        heading(1, 'Intro'),
        paragraph(text('body')),
        heading(3, 'Deep'),
        heading(2, ''),
      ),
    );
    const { controller } = makeController(editor);
    const headings = controller.getHeadings();
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Intro'],
      [3, 'Deep'],
      [2, ''],
    ]);
    controller.locateHeading(headings[1].pos);
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe('Deep');
  });

  it('finds, replaces one match and replaces all in a single undo step', () => {
    const editor = makeEditor(
      doc(paragraph(text('cat sat cat')), paragraph(text('CAT'))),
    );
    const { controller } = makeController(editor);
    const matches = controller.find('cat');
    expect(matches).toHaveLength(3);
    controller.replace(matches[0], 'dog');
    expect(editor.getText()).toContain('dog sat cat');

    expect(controller.replaceAll('cat', 'fox')).toBe(2);
    expect(editor.getText()).toContain('dog sat fox');
    // replaceAll is one transaction → one local undo restores both.
    editor.commands.undo();
    expect(editor.getText()).toContain('dog sat cat');
  });

  it('inserts images and tables and guards table commands via can()', () => {
    const editor = makeEditor(doc(paragraph(text('x'))));
    const { controller } = makeController(editor);
    controller.insertImage({ src: 'data:image/png;base64,a', alt: 'a' });
    expect(editor.getText()).toContain('x');
    expect(editor.getJSON().content?.some((n) => n.type === 'image')).toBe(
      true,
    );

    expect(controller.can('addTableRowAfter')).toBe(false);
    controller.insertTable();
    expect(controller.getToolbarState().inTable).toBe(true);
    expect(controller.can('addTableRowAfter')).toBe(true);
    controller.addTableRow('after');
    controller.deleteTable();
    expect(editor.getJSON().content?.some((n) => n.type === 'table')).toBe(
      false,
    );
  });

  it('blocks mutating commands in readonly mode but keeps find working', () => {
    const editor = makeEditor(doc(paragraph(text('alpha beta'))));
    editor.setEditable(false);
    const { controller } = makeController(editor);
    controller.toggleMark('bold');
    controller.insertImage({ src: 'x' });
    expect(controller.replaceAll('beta', 'gamma')).toBe(0);
    expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined();
    expect(editor.getText()).toBe('alpha beta');
    expect(controller.find('beta')).toHaveLength(1);
    expect(controller.getToolbarState().editable).toBe(false);
  });
});
