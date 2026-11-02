import {
  patterns as catalog,
  loadPatternTemplates,
} from '@sue/verd-board-agent-patterns';
import { remapWorkspaceFiles } from './workspace-references';
import { workspaceFileId, type WorkspaceFile } from './document-files';
export const builtinTemplates = catalog;
export async function instantiateTemplate(patternId: string, title?: string) {
  const pattern = catalog.find((item) => item.id === patternId);
  if (!pattern) throw new Error('Unknown template');
  const files = (await loadPatternTemplates(patternId)) as WorkspaceFile[];
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

const templateLabels: Record<string, [string, string]> = {
  'rich-document': [
    'Rich document',
    'Organize sections around reader questions and keep referenced sources independent.',
  ],
  whiteboard: [
    'Whiteboard',
    'Arrange shapes, notes, tables and arrows by information area.',
  ],
  'mind-map': [
    'Mind map',
    'Use parent-child relationships for categories and links across branches.',
  ],
  'workflow-dag': [
    'DAG workflow',
    'Describe dependencies, branches and joins without cycles.',
  ],
  'workflow-process': [
    'Retries and handoffs',
    'Define retry loops, failure exits, stop conditions and human handoffs.',
  ],
  architecture: [
    'Layered architecture',
    'Use layers for responsibility boundaries and label interfaces and data flows.',
  ],
  'uml-class': [
    'UML class diagram',
    'Describe static contracts with classes, interfaces and relationships.',
  ],
  'uml-sequence': [
    'UML sequence diagram',
    'Arrange participants and events with branches and loops.',
  ],
  'multi-system': [
    'Multi-system overview',
    'Describe system boundaries and handoffs, with separate internal diagrams.',
  ],
  'technical-proposal': [
    'Technical proposal',
    'State the problem, intended users and measurable goals.',
  ],
  adr: ['ADR decision record', 'Proposed, accepted or superseded decisions.'],
  'system-design': [
    'System design',
    'Describe key use cases, capacity and quality goals.',
  ],
  requirements: [
    'Requirements',
    'Explain who encounters which problem and in what context.',
  ],
};
export function localizedTemplates(locale: 'zh' | 'en') {
  return builtinTemplates.map((item) => {
    const labels = locale === 'en' ? templateLabels[item.id] : undefined;
    return labels
      ? { ...item, title: labels[0], description: labels[1] }
      : item;
  });
}
