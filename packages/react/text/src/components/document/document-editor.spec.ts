// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import { createBlockText } from '@sue/board-common';
import {
  contentExtensions,
  createDocumentExtensions,
} from '../../constants/editor-config';
import { createDocumentController } from './document-controller';
import { DocumentGroupTracker, INPUT_GROUP_MS } from './document-groups';
import { findInDocument } from './document-search';
import type { DocumentChangeSource } from '../../types/document';

HTMLElement.prototype.scrollIntoView ??= () => {};

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
  it('inserts native canvas references, keeps their identity through HTML, and undoes insertion', async () => {
    const editor = makeEditor();
    const { controller, sources } = makeController(editor);
    await controller.executeAction(
      'document.insert-frame-reference',
      'board/图:1',
    );
    expect(
      editor
        .getJSON()
        .content?.some(
          (node) =>
            node.type === 'frameReference' &&
            node.attrs?.['targetFrameId'] === 'board/图:1',
        ),
    ).toBe(true);
    expect(editor.getText()).toContain('verd://file/board%2F');
    expect(sources).toContain('insert');
    const html = editor.getHTML();
    expect(html).toContain('data-target-frame-id="board/图:1"');
    const pasted = makeEditor();
    pasted.commands.setContent(html);
    expect(
      pasted.getJSON().content?.some((node) => node.type === 'frameReference'),
    ).toBe(true);
    await controller.executeAction('document.undo');
    expect(
      editor.getJSON().content?.some((node) => node.type === 'frameReference'),
    ).toBe(false);
  });
  it('reveals repeated frame embeds in read-only documents without changing content or history', () => {
    const reference = (id: string) => ({
      type: 'frameReference',
      attrs: { targetFrameId: id },
    });
    const editor = makeEditor(
      doc(
        paragraph(text('Before')),
        reference('a'),
        reference('b'),
        reference('a'),
      ),
    );
    editor.setEditable(false);
    const { controller } = makeController(editor);
    const content = editor.getJSON();
    const update = vi.fn();
    editor.on('update', update);
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {});
    expect(controller.locateFrameReference('a', 0)).toBe(true);
    const firstPosition = editor.state.selection.from;
    expect(controller.locateFrameReference('a', 1)).toBe(true);
    const selection = editor.state.selection;
    expect(
      editor.state.doc.nodeAt(selection.from)?.attrs['targetFrameId'],
    ).toBe('a');
    expect(selection.from).toBeGreaterThan(firstPosition);
    expect(scroll).toHaveBeenCalled();
    expect(controller.locateFrameReference('a', 2)).toBe(false);
    expect(controller.locateFrameReference('a', -1)).toBe(false);
    expect(editor.state.selection).toBe(selection);
    expect(editor.getJSON()).toEqual(content);
    expect(update).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('permits workspace links in documents and canvas text while rejecting unsafe URLs', async () => {
    const content = doc(
      paragraph(
        text('Guide', [
          {
            type: 'link',
            attrs: { href: 'verd://file/guide#章节' },
          },
        ]),
      ),
    );
    const standalone = makeEditor(content);
    const canvas = new Editor({ extensions: contentExtensions, content });
    editors.push(canvas);
    expect(standalone.getHTML()).toContain('href="verd://file/guide#章节"');
    expect(canvas.getHTML()).toContain('href="verd://file/guide#章节"');
    standalone.commands.selectAll();
    expect(standalone.commands.setLink({ href: 'javascript:alert(1)' })).toBe(
      false,
    );
  });

  it('disables the local undo history when a central adapter is used', async () => {
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
  it('matches across marks inside one block but never across blocks', async () => {
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

  it('never matches across atom nodes and honors case sensitivity', async () => {
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

  it('merges a typing burst and splits on the 500ms boundary', async () => {
    const t = tracker();
    const t0 = 1_000_000;
    const g1 = t.groupFor('input', fakeTr(1, 0), t0);
    expect(t.groupFor('input', fakeTr(1, 0), t0 + 100)).toBe(g1);
    expect(
      t.groupFor('input', fakeTr(1, 0), t0 + 100 + INPUT_GROUP_MS + 1),
    ).not.toBe(g1);
  });

  it('keeps insertion and deletion runs in separate groups', async () => {
    const t = tracker();
    const t0 = 2_000_000;
    const insert = t.groupFor('input', fakeTr(1, 0), t0);
    const erase = t.groupFor('input', fakeTr(0, 1), t0 + 10);
    expect(erase).not.toBe(insert);
    expect(t.groupFor('input', fakeTr(0, 1), t0 + 20)).toBe(erase);
  });

  it('gives Enter, non-input sources and IME compositions their own groups', async () => {
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

  it('ends the run on explicit caret moves and external restores', async () => {
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
  it('snapshots the focused native range before the model selection observer without changing state', () => {
    const editor = makeEditor(createBlockText('Origin').content);
    const { controller, sources } = makeController(editor);
    const input = document.createElement('input');
    document.body.append(editor.view.dom, input);
    editor.commands.setTextSelection(1);
    editor.view.focus();
    const before = editor.state;
    const text = editor.view.dom.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const native = document.getSelection()!;
    native.removeAllRanges();
    native.addRange(range);
    expect(editor.state.selection.empty).toBe(true);
    expect(native.toString()).toBe('O');
    expect(controller.getSelection()).toEqual({
      from: 1,
      to: 2,
      collapsed: false,
    });
    expect(editor.state).toBe(before);
    expect(sources).toEqual([]);
    input.focus();
    expect(controller.getSelection()).toEqual({
      from: 1,
      to: 1,
      collapsed: true,
    });
    editor.view.dom.remove();
    input.remove();
  });

  it('commits content, keeps identity and reports toolbar state', async () => {
    const document = createBlockText('hello');
    const editor = makeEditor(document.content);
    const { controller } = makeController(editor, document);
    editor.commands.selectAll();
    await controller.executeAction('document.toggle-bold');
    await controller.executeAction('document.set-heading', 2);
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

  it('lists headings for the table of contents and locates them', async () => {
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

  it('uses visible text and document order for heading anchors', async () => {
    const editor = makeEditor(
      doc(
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [text('章节'), text('标题', [{ type: 'bold' }])],
        },
        heading(3, '章节标题'),
      ),
    );
    const { controller } = makeController(editor);
    expect(controller.getHeadings().map((item) => item.anchor)).toEqual([
      '章节标题',
      '章节标题-1',
    ]);
    expect(controller.getHeadings().map((item) => item.anchor)).toEqual([
      '章节标题',
      '章节标题-1',
    ]);
  });

  it('scrolls readonly headings and the document start without requiring a DOM caret', async () => {
    const editor = makeEditor(
      doc(heading(2, 'Read section'), paragraph(text('Body'))),
    );
    editor.setEditable(false);
    const before = editor.getJSON();
    const { controller } = makeController(editor);
    const headingScroll = vi.fn();
    const startScroll = vi.fn();
    Object.defineProperty(
      editor.view.dom.querySelector('h2')!,
      'scrollIntoView',
      { value: headingScroll },
    );
    Object.defineProperty(editor.view.dom, 'scrollIntoView', {
      value: startScroll,
    });
    controller.locateHeading(controller.getHeadings()[0].pos);
    expect(headingScroll).toHaveBeenCalledWith({
      block: 'start',
      inline: 'nearest',
    });
    controller.focus('start');
    expect(startScroll).toHaveBeenCalledWith({
      block: 'start',
      inline: 'nearest',
    });
    expect(editor.getJSON()).toEqual(before);
    expect(editor.can().undo()).toBe(false);
  });

  it('finds, replaces one match and replaces all in a single undo step', async () => {
    const editor = makeEditor(
      doc(paragraph(text('cat sat cat')), paragraph(text('CAT'))),
    );
    const { controller } = makeController(editor);
    const matches = controller.find('cat');
    expect(matches).toHaveLength(3);
    await controller.executeAction('document.replace', {
      match: matches[0],
      text: 'dog',
    });
    expect(editor.getText()).toContain('dog sat cat');

    expect(
      await controller.executeAction('document.replace-all', {
        query: 'cat',
        text: 'fox',
      }),
    ).toEqual({ status: 'completed' });
    expect(editor.getText()).toContain('dog sat fox');
    // replaceAll is one transaction → one local undo restores both.
    editor.commands.undo();
    expect(editor.getText()).toContain('dog sat cat');
  });

  it('finds formula sources and protects their nodes from ordinary replacements', async () => {
    const editor = makeEditor(
      doc(
        paragraph(text('x'), { type: 'inlineMath', attrs: { latex: 'x^2' } }),
        { type: 'blockMath', attrs: { latex: 'x+1' } },
      ),
    );
    const { controller } = makeController(editor);
    const matches = controller.find('x');
    expect(matches).toHaveLength(3);
    expect(matches.filter((match) => match.replaceable === false)).toHaveLength(
      2,
    );
    const before = editor.getJSON();
    await controller.executeAction('document.replace', {
      match: matches[1],
      text: 'lost',
    });
    expect(editor.getJSON()).toEqual(before);
    await controller.executeAction('document.replace-all', {
      query: 'x',
      text: 'y',
    });
    expect(editor.getJSON().content?.[0].content?.[0].text).toBe('y');
    expect(editor.getJSON().content?.[0].content?.[1].attrs?.['latex']).toBe(
      'x^2',
    );
    expect(editor.getJSON().content?.[1].attrs?.['latex']).toBe('x+1');
  });

  it('inserts images and tables and guards table commands via can()', async () => {
    const editor = makeEditor(doc(paragraph(text('x'))));
    const { controller } = makeController(editor);
    await controller.executeAction('document.insert-image', {
      src: 'data:image/png;base64,a',
      alt: 'a',
    });
    expect(editor.getText()).toContain('x');
    expect(editor.getJSON().content?.some((n) => n.type === 'image')).toBe(
      true,
    );

    expect(controller.getActionState('document.add-row-after').enabled).toBe(
      false,
    );
    await controller.executeAction('document.insert-table');
    expect(controller.getToolbarState().inTable).toBe(true);
    expect(controller.getActionState('document.add-row-after').enabled).toBe(
      true,
    );
    await controller.executeAction('document.add-row-after');
    await controller.executeAction('document.delete-table');
    expect(editor.getJSON().content?.some((n) => n.type === 'table')).toBe(
      false,
    );
  });

  it('blocks mutating commands in readonly mode but keeps find working', async () => {
    const editor = makeEditor(doc(paragraph(text('alpha beta'))));
    editor.setEditable(false);
    const { controller } = makeController(editor);
    await controller.executeAction('document.toggle-bold');
    await controller.executeAction('document.insert-image', { src: 'x' });
    expect(
      await controller.executeAction('document.replace-all', {
        query: 'beta',
        text: 'gamma',
      }),
    ).toMatchObject({ status: 'rejected', code: 'readonly' });
    expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined();
    expect(editor.getText()).toBe('alpha beta');
    expect(controller.find('beta')).toHaveLength(1);
    expect(controller.getToolbarState().editable).toBe(false);
  });
});

describe('internal link insertion', () => {
  it('inserts a labeled link at a caret as one undo step, and preserves selected text', async () => {
    const editor = makeEditor();
    const { controller } = makeController(editor);
    await controller.executeAction('document.insert-link', {
      href: 'verd://file/target',
      label: 'Target',
    });
    expect(editor.getJSON().content?.[0].content?.[0]).toMatchObject({
      text: 'Target',
      marks: [{ type: 'link', attrs: { href: 'verd://file/target' } }],
    });
    await controller.executeAction('document.undo');
    expect(editor.getText()).toBe('');
    editor.commands.insertContent('Selected');
    editor.commands.setTextSelection({ from: 1, to: 9 });
    const captured = controller
      .actions()
      .find((action) => action.id === 'document.insert-link')!
      .capture();
    editor.commands.setTextSelection(1);
    await captured.execute({ href: 'verd://file/target', label: 'Ignored' });
    expect(editor.getText()).toBe('Selected');
    expect(
      editor.getJSON().content?.[0].content?.[0].marks?.[0].attrs?.['href'],
    ).toBe('verd://file/target');
    editor.setEditable(false);
    expect(
      await controller.executeAction('document.insert-link', {
        href: 'verd://file/target',
        label: 'Blocked',
      }),
    ).toMatchObject({ status: 'rejected', code: 'readonly' });
  });
});

describe('stable paragraph operations', () => {
  it('keeps the original address when pasting before it and gives copies unique identities', async () => {
    const editor = makeEditor(doc(paragraph(text('Original'))));
    const { controller } = makeController(editor);
    editor.commands.insertContent('!');
    const original = editor.state.doc.child(0);
    const id = original.attrs['blockId'];
    expect(id).toBeTruthy();
    editor.commands.insertContentAt(0, original.toJSON());
    expect(editor.state.doc.child(1).attrs['blockId']).toBe(id);
    expect(editor.state.doc.child(0).attrs['blockId']).not.toBe(id);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1);
    await controller.executeAction('document.block-up');
    expect(editor.state.doc.child(0).attrs['blockId']).toBe(id);
    editor.setEditable(false);
    expect(
      await controller.executeAction('document.locate-block', id),
    ).toMatchObject({ status: 'completed' });
  });
  it('preserves stable IDs while converting paragraphs and duplicates in one undo step', async () => {
    const editor = makeEditor(doc(paragraph(text('Decision'))));
    const { controller } = makeController(editor);
    editor.commands.insertContent('!');
    const id = editor.state.doc.child(0).attrs['blockId'];
    await controller.executeAction('document.set-heading', 2);
    expect(editor.state.doc.child(0).attrs['blockId']).toBe(id);
    await controller.executeAction('document.block-duplicate');
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(1).attrs['blockId']).not.toBe(id);
    await controller.executeAction('document.undo');
    expect(editor.state.doc.childCount).toBe(1);
  });
  it('persists a readonly excerpt as a source identity without copying source text', async () => {
    const editor = makeEditor();
    const { controller } = makeController(editor);
    await controller.executeAction('document.insert-excerpt', {
      targetDocumentId: 'source',
      blockId: 'block',
    });
    expect(
      editor
        .getJSON()
        .content?.some(
          (node) =>
            node.type === 'documentExcerpt' &&
            node.attrs?.['targetDocumentId'] === 'source',
        ),
    ).toBe(true);
    expect(editor.getText()).not.toContain('copied source');
  });
});
