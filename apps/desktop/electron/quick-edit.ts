import path from 'node:path';
import { defaultQuickEditDirectory } from '@sue/verd-board-app/node';

export { createQuickEditFile } from '@sue/verd-board-app/node';

export function quickEditDirectory(userData: string, interactiveDev: boolean) {
  return interactiveDev
    ? defaultQuickEditDirectory(path.resolve(__dirname, '../../..'))
    : path.join(userData, 'quick-edit');
}
