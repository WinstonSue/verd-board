import { useRef, useEffect, useLayoutEffect } from 'react';
import { useEditor } from '@tiptap/react';
import {
  type BoardTextDocument,
  type EditorTextChangeData,
  type BoardTextController,
} from '@sue/board-common';
import { paragraphExtensions } from '../constants/editor-config';
import {
  createBoardTextController,
  documentFromEditor,
} from '../utils/controller';
import { measureContainerSize } from '../utils/measure';

interface UseParagraphEditorProps {
  text: BoardTextDocument;
  readonly?: boolean;
  onChange?: (data: EditorTextChangeData) => void;
  afterInit?: (editor: BoardTextController) => void;
}

export function useParagraphEditor({
  text,
  readonly = false,
  onChange,
  afterInit,
}: UseParagraphEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const originalElementRef = useRef<BoardTextDocument>(text);
  const controllerRef = useRef<BoardTextController | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const afterInitRef = useRef(afterInit);
  afterInitRef.current = afterInit;

  useEffect(() => {
    originalElementRef.current = text;
  }, [text]);

  const emitChange = (editor: NonNullable<ReturnType<typeof useEditor>>) => {
    const oc = onChangeRef.current;
    if (!oc) {
      return;
    }
    const newText = {
      ...documentFromEditor(editor, originalElementRef.current),
      kind: 'block' as const,
    };
    originalElementRef.current = newText;
    oc({
      newText,
      ...measureContainerSize(editorContainerRef.current),
    });
  };

  const editor = useEditor(
    {
      extensions: paragraphExtensions,
      content: originalElementRef.current.content,
      editable: !readonly,
      editorProps: { attributes: { class: 'board-text-content' } },
      onUpdate: ({ editor }) => {
        // The host owns persistence. Commit before blur, navigation or shutdown
        // can unmount the editor, just as the inline editor does.
        emitChange(editor);
      },
    },
    [originalElementRef.current.id],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const controller = createBoardTextController(
      editor,
      originalElementRef.current,
      editorContainerRef.current,
    );
    controllerRef.current = controller;
    afterInitRef.current?.(controller);
  }, [editor, text]);

  const prevReadonlyRef = useRef(readonly);
  useLayoutEffect(() => {
    const prev = prevReadonlyRef.current;
    prevReadonlyRef.current = readonly;
    if (prev !== false || readonly !== true || !editor) {
      return;
    }
    const incoming = editor.schema.nodeFromJSON(
      originalElementRef.current.content,
    );
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(incoming.toJSON()))
      emitChange(editor);
  }, [readonly, editor]);

  return {
    editor,
    editorContainerRef,
    originalElementRef,
    controllerRef,
  };
}
