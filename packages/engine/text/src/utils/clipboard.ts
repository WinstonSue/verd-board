import { BoardTextDocument, NodeUtils } from '@sue/board-common';
import { CLIPBOARD_FORMAT_KEY } from '../constant';

export const getTextFromClipboard = (data: DataTransfer | null) => {
  const encoded = data?.getData(`application/${CLIPBOARD_FORMAT_KEY}`);
  const text = (data ? data.getData(`text/plain`) : '') as string;
  if (encoded) {
    const decoded = decodeURIComponent(window.atob(encoded));
    const res = JSON.parse(decoded) as BoardTextDocument[];
    if (res.length === 1 && NodeUtils.string(res[0])) {
      return res[0];
    }
  }
  return text.trim() || '';
};
