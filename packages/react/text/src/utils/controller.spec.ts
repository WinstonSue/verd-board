// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { Alignment, createInlineText } from '@sue/board-common';
import { lineExtensions } from '../constants/editor-config';
import { createBoardTextController } from './controller';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
describe('native text controller', () => {
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
  });
});
