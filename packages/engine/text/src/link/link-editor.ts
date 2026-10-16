import { BoardTextController } from '@sue/board-common';

export const LinkEditor = {
  wrapLink(editor: BoardTextController, _text: string, url: string) {
    editor.setLink({ href: url || 'https://' });
  },
  unwrapLink(editor: BoardTextController) {
    editor.setLink(null);
  },
  isLinkActive(editor: BoardTextController) {
    return Boolean(editor.getActiveLink());
  },
  getLinkElement(editor: BoardTextController) {
    const link = editor.getActiveLink();
    if (!link) {
      return null;
    }
    return [{ url: link.href, href: link.href }, []] as const;
  },
};
