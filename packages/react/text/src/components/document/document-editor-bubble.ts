import { useEffect, useState } from 'react';
import {
  BubbleMenuPlugin,
  type BubbleMenuPluginProps,
} from '@tiptap/extension-bubble-menu';
import type { Editor } from '@tiptap/react';

export function useDocumentBubble(
  editor: Editor,
  key: string,
  visible: boolean,
  anchor?: () => {
    getBoundingClientRect(): DOMRect;
    contextElement: Element;
  } | null,
  onPositioned?: (host: HTMLElement) => void,
  placement: NonNullable<BubbleMenuPluginProps['options']>['placement'] = anchor
    ? 'bottom-start'
    : 'top',
) {
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'document-block-popover-host';
    return element;
  });
  useEffect(() => {
    if (!visible || editor.isDestroyed) return;
    editor.registerPlugin(
      BubbleMenuPlugin({
        editor,
        element: host,
        pluginKey: key,
        updateDelay: 0,
        resizeDelay: 0,
        appendTo: () =>
          editor.view.dom.closest<HTMLElement>('.board-document-editor') ??
          document.body,
        shouldShow: ({ view }) => !view.composing && (!anchor || !!anchor()),
        getReferencedVirtualElement: anchor,
        options: {
          strategy: 'fixed',
          placement,
          offset: 6,
          flip: true,
          shift: { padding: 8 },
          hide: { strategy: 'referenceHidden' },
          onUpdate: () => onPositioned?.(host),
        },
      }),
    );
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!editor.isDestroyed)
          editor.view.dispatch(editor.state.tr.setMeta(key, 'updatePosition'));
      });
    };
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(reposition);
    resize?.observe(host);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      resize?.disconnect();
      cancelAnimationFrame(frame);
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
      host.remove();
    };
  }, [anchor, editor, host, key, onPositioned, placement, visible]);
  return host;
}
