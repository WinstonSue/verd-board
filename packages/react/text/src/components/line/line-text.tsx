import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { lineExtensions } from '../../constants/editor-config';
import { type BoardTextDocument } from '@sue/board-common';
import { type LineTextProps, type LineTextRef } from '../../types';
import { safeFocus, measureContainerSize } from '../../utils/measure';
import {
  createBoardTextController,
  documentFromEditor,
} from '../../utils/controller';
import './line-text.css';
import '../../styles/content.scss';
import { syncEditorDocument } from '../../utils/sync-document';

export const LineText = React.forwardRef<LineTextRef, LineTextProps>(
  function LineText(props, ref) {
    const {
      element,
      text,
      onChange,
      onSizeChange,
      readonly = false,
      autoFocus = true,
      attributes,
      afterInit,
    } = props;
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const [currentSize, setCurrentSize] = useState({ width: 0, height: 0 });
    const dataSource = element || text;
    const afterInitRef = useRef(afterInit);
    afterInitRef.current = afterInit;

    const editor = useEditor(
      {
        extensions: lineExtensions,
        content: dataSource.content,
        editable: !readonly,
        onUpdate: ({ editor }) => {
          if (!onChange) return;
          const newText: BoardTextDocument = {
            ...documentFromEditor(editor, dataSource),
            kind: 'inline',
            plainText: editor.getText().replace(/\s+/g, ' ').trim(),
          };
          const size = measureContainerSize(editorContainerRef.current);
          onChange({
            newText,
            oldText: text,
            ...size,
          });
          measureAndNotifySize();
        },
        editorProps: {
          attributes: {
            ...attributes,
            class: ['board-text-content', attributes?.['class']]
              .filter(Boolean)
              .join(' '),
          },
          handlePaste: (view, event) => {
            event.preventDefault();
            const clipboardData = event.clipboardData;
            if (clipboardData) {
              const pasted = (clipboardData.getData('text/plain') || '')
                .replace(/\n/g, ' ')
                .replace(/\r/g, ' ')
                .trim();
              view.dispatch(view.state.tr.insertText(pasted));
            }
            return true;
          },
          handleKeyDown: (_view, event) => {
            if (event.isComposing || event.keyCode === 229) return false;
            if (event.key === 'Enter') {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
      },
      [readonly],
    );

    // React StrictMode may discard an initial editor. Bind the controller to
    // the instance actually mounted by EditorContent, rather than onCreate.
    useEffect(() => {
      if (editor && !editor.isDestroyed)
        afterInitRef.current?.(
          createBoardTextController(
            editor,
            dataSource,
            editorContainerRef.current,
          ),
        );
    }, [editor, dataSource]);

    const measureAndNotifySize = useCallback(() => {
      if (editorContainerRef.current && onSizeChange) {
        const size = measureContainerSize(editorContainerRef.current);
        setCurrentSize(size);
        onSizeChange(size);
      }
    }, [onSizeChange]);

    React.useImperativeHandle(
      ref,
      () => ({
        getSize: () => currentSize,
        measureSize: () =>
          measureContainerSize(editorContainerRef.current) || {
            width: 0,
            height: 0,
          },
        focus: () => {
          if (editor && !editor.isDestroyed && !editor.isFocused) {
            safeFocus(editor);
          }
        },
      }),
      [currentSize, editor],
    );

    useEffect(() => {
      if (editor && editorContainerRef.current && onSizeChange) {
        setTimeout(() => measureAndNotifySize(), 0);
      }
    }, [editor, measureAndNotifySize, onSizeChange]);

    useEffect(() => {
      if (!readonly && autoFocus) {
        const timer = setTimeout(() => {
          if (editor) {
            safeFocus(editor);
          }
        }, 120);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [readonly, editor, autoFocus]);

    useEffect(() => {
      if (editor) {
        editor.setEditable(!readonly, false);
      }
    }, [readonly, editor]);

    useEffect(() => {
      if (editor) syncEditorDocument(editor, dataSource);
    }, [dataSource, editor]);

    return (
      <div
        ref={editorContainerRef}
        className={readonly ? 'lineText readonly' : 'lineText'}
        role="textbox"
        tabIndex={readonly ? -1 : 0}
        style={{
          textAlign: dataSource.align ?? 'center',
        }}
        onClick={() => {
          if (editor && !readonly) {
            editor.commands.focus();
          }
        }}
      >
        {editor ? <EditorContent editor={editor} /> : dataSource.plainText}
      </div>
    );
  },
);
