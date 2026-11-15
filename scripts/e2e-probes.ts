import type { Plugin } from 'vite';

/**
 * The same fault injection used by source E2E, applied before bundling for
 * production-mode regression builds. Ordinary production builds omit this
 * plugin and the extra host entry entirely; no testing API ships by default.
 */
export function workspaceE2EProbes(): Plugin {
  const injected = new Set<string>();
  return {
    name: 'workspace-e2e-fault-probes',
    apply: 'build',
    enforce: 'pre',
    buildEnd(error) {
      if (!error && injected.size !== 2)
        throw new Error(
          `Missing production E2E probes: ${[...injected].join(', ')}`,
        );
    },
    transform(source, id) {
      const file = id.split('?')[0].replaceAll('\\', '/');
      const insert = (marker: string, replacement: string) => {
        if (!source.includes(marker))
          throw new Error(`E2E probe marker missing: ${file}: ${marker}`);
        source = source.replace(marker, replacement);
      };
      if (file.endsWith('/product/ui/src/documents/document-page.tsx')) {
        injected.add('document-page');
        const marker = 'const t = labels[locale];';
        insert(
          marker,
          `${marker}
          if (globalThis.__verdForceDocumentError && value.id === 'feedback-b')
            throw new Error('Controlled document renderer failure');
        `,
        );
      } else if (
        file.endsWith('/react/text/src/components/document/document-editor.tsx')
      ) {
        injected.add('document-editor');
        const marker = 'flushEditing: async () => {';
        insert(
          marker,
          `${marker}\n await globalThis.__verdNavigationGate?.wait?.();`,
        );
        const ready = 'onReadyRef.current?.(controller);';
        insert(
          ready,
          `if (globalThis.__verdReadyGate && originalElementRef.current.id === 'feedback-d')
          void globalThis.__verdReadyGate.promise.then(() => onReadyRef.current?.(controller));
          else ${ready}`,
        );
      } else return null;
      return { code: source, map: null };
    },
  };
}
