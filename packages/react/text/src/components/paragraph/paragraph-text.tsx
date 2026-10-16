import React, { useEffect } from 'react';
import { EditorContent } from '@tiptap/react';
import { type ParagraphTextProps } from '../../types';
import { useParagraphEditor } from '../../hooks/useParagraphEditor';
import { safeFocus } from '../../utils/measure';
import './paragraph-text.scss';
import '../../styles/content.scss';
import { syncEditorDocument } from '../../utils/sync-document';

export const ParagraphText: React.FC<ParagraphTextProps> = (props) => {
  const { readonly = false, text, autoFocus = true } = props;
  const document = text;
  const { editor, editorContainerRef } = useParagraphEditor({
    ...props,
    text: document,
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readonly, false);
    }
  }, [readonly, editor]);

  useEffect(() => {
    if (!readonly && autoFocus && editor) {
      const timer = setTimeout(() => {
        if (!editor.isDestroyed && !editor.isFocused) safeFocus(editor);
      }, 120);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [readonly, autoFocus, editor]);

  useEffect(() => {
    if (editor) syncEditorDocument(editor, document);
  }, [document, editor]);

  if (!editor) {
    return (
      <div ref={editorContainerRef} className={'paragraphText'}>
        {document.plainText}
      </div>
    );
  }

  return (
    <div
      ref={editorContainerRef}
      className={`paragraphText${readonly ? ' readonly' : ''}`}
      style={{ textAlign: document.align ?? 'center' }}
    >
      <EditorContent editor={editor} />
    </div>
  );
};
