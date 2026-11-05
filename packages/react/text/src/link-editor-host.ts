import { createContext } from 'react';
import { sameBoardText, type ActionResult } from '@sue/board-common';
import type { DocumentEditorController } from './types/document';

export interface LinkEditRequest {
  sourceFileId?: string;
  href?: string;
  mixed?: boolean;
  canRemove?: boolean;
  canInsertText?: boolean;
  isCurrent(): boolean;
  commit(
    href: string | null,
    label?: string,
    signal?: AbortSignal,
  ): Promise<ActionResult>;
  finish?(reason: 'saved' | 'cancelled' | 'invalidated'): void;
}

export const LinkEditorHost = createContext<
  ((request: LinkEditRequest) => void) | null
>(null);

export function requestDocumentLink(
  open: (request: LinkEditRequest) => void,
  controller: DocumentEditorController,
) {
  const selection = controller.getSelection();
  const document = controller.getDocument();
  const href = controller.getToolbarState().link ?? undefined;
  const capture = (id: string) =>
    controller
      .actions()
      .find((action) => action.id === `document.${id}`)
      ?.capture();
  const set = capture('set-link');
  const insert = capture('insert-link');
  if (!selection || !set || !insert || !set.getState(null).enabled) return;
  const isCurrent = () =>
    set.getState(null).enabled &&
    sameBoardText(document, controller.getDocument());
  open({
    sourceFileId: document.id,
    href,
    canRemove: !!href,
    canInsertText: selection.collapsed && !href,
    isCurrent,
    commit: (href, label, signal) =>
      href && label
        ? insert.execute({ href, label }, { source: 'toolbar', signal })
        : set.execute(href, { source: 'toolbar', signal }),
    finish: (reason) => {
      if (reason === 'invalidated' || (reason === 'cancelled' && !isCurrent()))
        return;
      if (reason === 'cancelled') controller.restoreSelection(selection);
      controller.focus('preserve');
    },
  });
}
