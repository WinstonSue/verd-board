import {
  recommendations as catalog,
  loadRecommendationTemplates,
} from '@sue/verd-board-agent-patterns/recommendations';
import { localizePatterns } from './pattern-labels';
import { remapWorkspaceFiles } from '@sue/verd-board-workspace';
import { workspaceFileId, type WorkspaceFile } from '@sue/verd-board-workspace';
export const builtinTemplates = catalog;
export async function instantiateTemplate(patternId: string, title?: string) {
  const pattern = catalog.find((item) => item.id === patternId);
  if (!pattern) throw new Error('Unknown template');
  const files = (await loadRecommendationTemplates(
    patternId,
  )) as WorkspaceFile[];
  const ids = new Set(
    files.flatMap((file) =>
      file.format === 'verd-document'
        ? [file.id]
        : [file.frame.id, ...Object.keys(file.cells)],
    ),
  );
  const remapped = remapWorkspaceFiles(
    files,
    (id) => ids.has(id),
    () => crypto.randomUUID(),
  ).files;
  const rootIndex = files.findIndex(
    (file) => workspaceFileId(file) === pattern.rootFileId,
  );
  const root = remapped[rootIndex];
  if (root && title?.trim()) {
    if (root.format === 'verd-document') root.title = title.trim();
    else root.frame.name = title.trim();
  }
  return { files: remapped, rootId: root ? workspaceFileId(root) : undefined };
}

export function localizedTemplates(locale: 'zh' | 'en') {
  return localizePatterns(builtinTemplates, locale);
}
