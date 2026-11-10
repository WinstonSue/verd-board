// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { Alignment, createInlineText } from '@sue/board-common';
import { lineExtensions } from '../constants/editor-config';
import { createBoardTextController } from './controller';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
describe('native text controller', () => {
  it('restores the selected model range when returning from an external input', () => {
    const text = createInlineText('Selection sample');
    const editor = new Editor({
      extensions: lineExtensions,
      content: text.content,
    });
    editors.push(editor);
    const input = document.createElement('input');
    document.body.append(editor.view.dom, input);
    const controller = createBoardTextController(editor, text);
    controller.selectRange(1, 10);
    input.focus();
    const native = document.getSelection()!;
    const node = editor.view.dom.querySelector('p')!.firstChild!;
    native.collapse(node, 16);
    const content = controller.commit();
    controller.focus('preserve');
    expect(document.activeElement).toBe(editor.view.dom);
    expect(native.toString()).toBe('Selection');
    expect(controller.getSelection()).toEqual({
      from: 1,
      to: 10,
      collapsed: false,
    });
    expect(controller.commit()).toEqual(content);
    editor.view.dom.remove();
    input.remove();
  });

  it('reads a collapsed native caret before the model observer without changing content or history', () => {
    const text = createInlineText('Selection sample');
    const editor = new Editor({
      extensions: lineExtensions,
      content: text.content,
    });
    editors.push(editor);
    document.body.append(editor.view.dom);
    const controller = createBoardTextController(editor, text);
    editor.commands.selectAll();
    editor.view.focus();
    const before = editor.state;
    const contentBefore = controller.commit();
    const native = document.getSelection()!;
    const node = editor.view.dom.querySelector('p')!.firstChild!;
    native.collapse(node, 0);
    expect(editor.state.selection.empty).toBe(false);
    expect(controller.getSelection()).toEqual({
      from: 1,
      to: 1,
      collapsed: true,
    });
    expect(editor.state).toBe(before);
    expect(controller.commit()).toEqual(contentBefore);
    editor.view.dom.remove();
  });

  it('snapshots the focused native range and falls back to the model after focus leaves the editor', () => {
    const text = createInlineText('Selection sample');
    const editor = new Editor({
      extensions: lineExtensions,
      content: text.content,
    });
    editors.push(editor);
    const input = document.createElement('input');
    document.body.append(editor.view.dom, input);
    const controller = createBoardTextController(editor, text);
    editor.commands.setTextSelection(1);
    editor.view.focus();
    const before = editor.state;
    const node = editor.view.dom.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 9);
    const native = document.getSelection()!;
    native.removeAllRanges();
    native.addRange(range);
    expect(editor.state.selection.empty).toBe(true);
    expect(controller.getSelection()).toEqual({
      from: 1,
      to: 10,
      collapsed: false,
    });
    expect(editor.state).toBe(before);
    input.focus();
    expect(controller.getSelection()).toEqual({
      from: 1,
      to: 1,
      collapsed: true,
    });
    editor.view.dom.remove();
    input.remove();
  });

  it('commits current text and formatting, retaining the document identity', () => {
    const document = createInlineText('Before');
    const editor = new Editor({
      extensions: lineExtensions,
      content: document.content,
    });
    editors.push(editor);
    const controller = createBoardTextController(editor, document);
    editor.commands.setContent(createInlineText('After').content);
    editor.commands.selectAll();
    controller.toggleMark('bold');
    controller.applyMark('fontSize', 24);
    controller.setAlign('right');
    const committed = controller.commit();
    expect(committed.id).toBe(document.id);
    expect(committed.plainText).toBe('After');
    expect(committed.content.content?.[0].content?.[0].marks).toContainEqual({
      type: 'bold',
    });
    expect(committed.content.content?.[0].content?.[0].marks).toContainEqual({
      type: 'textStyle',
      attrs: { color: null, fontSize: '24px', fontFamily: null },
    });
    expect(committed.content.content?.[0].attrs?.textAlign).toBe('right');
    expect(controller.document).toEqual(committed);
    expect(controller.getActiveAlign!()).toBe('right');
    expect(document.plainText).toBe('Before');
  });
  it('uses the display default, then follows the selected paragraph instead of document alignment', () => {
    const document = { ...createInlineText('Before'), align: Alignment.left };
    const editor = new Editor({
      extensions: lineExtensions,
      content: document.content,
    });
    editors.push(editor);
    const controller = createBoardTextController(editor, document);
    expect(controller.getActiveAlign!()).toBe('left');
    controller.setAlign(Alignment.center);
    expect(controller.getActiveAlign!()).toBe('center');
    expect(controller.commit().align).toBe('left');
    editor.commands.selectAll();
    expect(controller.getActiveAlign!()).toBe('center');
  });
});
