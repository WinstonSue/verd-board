import { createCellRegistry, createCellRuntime } from '@sue/board-core';
import { registerMindCells } from '@sue/board-mind';
import { registerDrawCells } from '@sue/board-draw';
import { registerWorkflowCells } from '@sue/board-workflow';
import { registerArchitectureCells } from '@sue/board-architecture';
import { registerUmlCells } from '@sue/board-uml';
import {
  createDocumentFile,
  createWebWorkspaceHost,
  frameFileFor,
  openWorkspaceSession,
} from '@sue/verd-board-app';
import {
  parseMarkdownToFrameSnapshot,
  serializeFrameToMarkdown,
} from '@sue/board-markdown-to-board';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from '@sue/board-markdown-to-text';
import {
  parseMermaidToFrameSnapshot,
  serializeFrameToMermaid,
} from '@sue/board-mermaid-to-board';

/** Runs in the browser against installed packages, including real IndexedDB. */
export async function verifyReleaseExamples() {
  const registry = createCellRegistry();
  [
    registerDrawCells,
    registerMindCells,
    registerWorkflowCells,
    registerArchitectureCells,
    registerUmlCells,
  ].forEach((register) => register(registry));
  const mind = parseMarkdownToFrameSnapshot('# Center\n## Topic');
  if (!serializeFrameToMarkdown(mind).includes('Topic'))
    throw new Error('Mind Markdown round-trip failed');
  const { document, warnings } = parseMarkdownToTextDocument(
    '# Document\n\nBody',
    { id: 'consumer-document' },
  );
  if (
    warnings.length ||
    !serializeTextDocumentToMarkdown(document).markdown.includes('Body')
  )
    throw new Error('Document Markdown round-trip failed');
  const uml = await parseMermaidToFrameSnapshot('classDiagram\nclass User', {
    scene: 'uml-class',
  });
  createCellRuntime(uml, registry);
  if (!serializeFrameToMermaid(uml).includes('classDiagram'))
    throw new Error('Native UML round-trip failed');

  const host = createWebWorkspaceHost({
    dbName: `verd-consumer-${crypto.randomUUID()}`,
  });
  const handle = await host.openWorkspace({ name: 'Consumer', default: true });
  if (!handle) throw new Error('Workspace did not open');
  const session = await openWorkspaceSession(host, handle, { registry });
  const file = createDocumentFile('consumer-document', 'Consumer');
  file.text = document;
  const imported = await session.apply({
    type: 'import-files',
    files: [frameFileFor(mind.store, mind.store.rootId), file],
  });
  if (!imported.ok || !(await session.flush()))
    throw new Error('Workspace save failed');
  session.dispose();
  const reopened = await openWorkspaceSession(host, handle, { registry });
  if (
    reopened.exportDocument('consumer-document')?.text.plainText !==
    document.plainText
  )
    throw new Error('Independent document was not restored');
  if (!reopened.exportFiles(mind.store.rootId).length)
    throw new Error('Canvas was not restored');
  if (!(await reopened.flush()))
    throw new Error('Reopened workspace has pending writes');
  reopened.dispose();
  await host.closeWorkspace(handle);
}
