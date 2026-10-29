import { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import { createInlineText, formatBoardText } from '@sue/board-common';
import { contentExtensions } from './editor-config';

const legacy = () => {
  const text = createInlineText('Legacy body');
  text.content.content![0].content![0].marks = [
    { type: 'textStyle', attrs: { color: '#24354b', fontSize: '18px' } },
  ];
  return text;
};

describe('theme-aware text color schema', () => {
  it.each([undefined, 'theme', 'custom'] as const)(
    'keeps original literals and %s source through JSON and HTML without emitting edits on open',
    (source) => {
      const text = legacy(),
        onUpdate = vi.fn();
      if (source)
        text.content.content![0].content![0].marks![0].attrs!['colorSource'] =
          source;
      const bytes = JSON.stringify(text);
      const editor = new Editor({
        extensions: contentExtensions,
        content: text.content,
        onUpdate,
      });
      const again = new Editor({ extensions: contentExtensions });
      try {
        const attrs = editor.getJSON().content![0].content![0].marks![0].attrs!;
        expect(attrs['colorSource']).toBe(source);
        if (!source)
          expect(JSON.stringify(editor.getJSON())).not.toContain('colorSource');
        // jsdom's CSS parser drops var() color declarations; inspect the schema
        // output here and verify actual computed colors in Chromium below.
        const mark = editor.state.doc.firstChild!.firstChild!.marks[0];
        expect(JSON.stringify(mark.type.spec.toDOM!(mark, false))).toContain(
          source === 'custom'
            ? 'color: #24354b'
            : 'var(--board-unmarked-text-color, #24354b)',
        );
        again.commands.setContent(editor.getHTML());
        const roundtrip =
          again.getJSON().content![0].content![0].marks![0].attrs!;
        expect(roundtrip['color']).toBe('#24354b');
        expect(roundtrip['colorSource']).toBe(source);
        expect(JSON.stringify(again.getJSON())).not.toContain('var(');
        expect(JSON.stringify(text)).toBe(bytes);
        expect(onUpdate).not.toHaveBeenCalled();
      } finally {
        editor.destroy();
        again.destroy();
      }
    },
  );

  it('marks explicit commands and pasted HTML as custom, and clears both color and source', () => {
    const editor = new Editor({
      extensions: contentExtensions,
      content: legacy().content,
    });
    try {
      editor.commands.selectAll();
      editor.commands.setColor('#24354b');
      expect(editor.getAttributes('textStyle')['colorSource']).toBe('custom');
      expect(editor.getHTML()).not.toContain('var(');
      editor.commands.unsetColor();
      expect(editor.getAttributes('textStyle')['color']).toBeNull();
      expect(editor.getAttributes('textStyle')['colorSource']).toBeUndefined();
      expect(editor.getAttributes('textStyle')['fontSize']).toBe('18px');
      editor.commands.setContent(
        '<p><span style="color:#123456">Pasted</span></p>',
      );
      expect(
        editor.getJSON().content![0].content![0].marks![0].attrs,
      ).toMatchObject({ color: '#123456', colorSource: 'custom' });
      editor.commands.selectAll();
      editor.commands.unsetColor();
      expect(editor.getJSON().content![0].content![0].marks).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });

  it('treats choosing the existing literal as a manual edit and removes only color on theme reset', () => {
    const text = legacy();
    const manual = formatBoardText(text, { color: '#24354b' });
    expect(
      manual.content.content![0].content![0].marks![0].attrs,
    ).toMatchObject({
      color: '#24354b',
      colorSource: 'custom',
      fontSize: '18px',
    });
    const reset = formatBoardText(manual, { color: null });
    expect(reset.content.content![0].content![0].marks![0].attrs).toEqual({
      fontSize: '18px',
    });
  });
});
