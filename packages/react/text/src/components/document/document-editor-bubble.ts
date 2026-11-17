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
  canShow?: () => boolean,
  fitViewport = false,
) {
  const [content] = useState(() => {
    const element = document.createElement('div');
    element.className = 'document-block-popover-content';
    return element;
  });
  useEffect(() => {
    if (!visible || editor.isDestroyed) return;
    // TipTap shows the element before its asynchronous position calculation.
    // A fresh shell also isolates late calculations from an old plugin.
    const host = document.createElement('div');
    host.className = 'document-block-popover-host';
    Object.assign(host.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: 'max-content',
    });
    host.append(content);
    let disposed = false;
    const resetPosition = () => {
      delete host.dataset['positioned'];
      host.inert = true;
      host.setAttribute('aria-hidden', 'true');
    };
    resetPosition();
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
        shouldShow: ({ view }) =>
          !disposed &&
          !view.composing &&
          (!canShow || canShow()) &&
          (!anchor || !!anchor()),
        getReferencedVirtualElement: anchor,
        options: {
          strategy: 'fixed',
          placement,
          offset: 6,
          flip: true,
          shift: { padding: 8, ...(fitViewport ? { crossAxis: true } : {}) },
          size: fitViewport
            ? {
                padding: 8,
                apply({ availableHeight, availableWidth }) {
                  const menu = content.firstElementChild;
                  if (!disposed && menu instanceof HTMLElement) {
                    menu.style.maxHeight = `${Math.max(0, availableHeight)}px`;
                    menu.style.maxWidth = `${Math.max(0, availableWidth)}px`;
                  }
                },
              }
            : false,
          hide: { strategy: 'referenceHidden' },
          onShow: () => {
            resetPosition();
            // TipTap's deferred focus handler may outlive the plugin view.
            if (disposed) host.remove();
          },
          onHide: resetPosition,
          onDestroy: resetPosition,
          onUpdate: () => {
            if (disposed || !host.isConnected) return;
            host.dataset['positioned'] = '';
            host.inert = false;
            host.removeAttribute('aria-hidden');
            onPositioned?.(host);
          },
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
      disposed = true;
      resetPosition();
      window.removeEventListener('scroll', reposition, true);
      resize?.disconnect();
      cancelAnimationFrame(frame);
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
      host.remove();
    };
  }, [
    anchor,
    canShow,
    content,
    editor,
    fitViewport,
    key,
    onPositioned,
    placement,
    visible,
  ]);
  return content;
}
