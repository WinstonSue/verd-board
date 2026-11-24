import type {
  ProductNavigationHost,
  WorkspaceFile,
  WorkspaceFileOpenTarget,
  WorkspaceHost,
} from '@sue/verd-board-app';

export type { ExternalFileBinding } from '@sue/verd-board-app';
import type { ExternalFileBinding } from '@sue/verd-board-app';
export interface DesktopFilesApi {
  binding(): Promise<ExternalFileBinding | null>;
  product: ProductNavigationHost & { startup(): Promise<boolean> };
  host: Pick<
    WorkspaceHost,
    | 'readSnapshot'
    | 'readFile'
    | 'readResource'
    | 'commit'
    | 'resolveConflict'
    | 'closeWorkspace'
    | 'subscribe'
  >;
  rename(stem: string): Promise<string>;
  onRenamed(listener: (name: string) => void): () => void;
  warnings(): Promise<string[]>;
  readImage(href: string): Promise<Uint8Array>;
  openLink(href: string): Promise<void>;
  resolve(
    action: 'load-disk' | 'keep-local' | 'save-copy',
    files: { file: WorkspaceFile; path: string }[],
  ): Promise<boolean>;
  setDefaults(): Promise<void>;
  onOpenWorkspaceFile(
    listener: (target: WorkspaceFileOpenTarget) => Promise<void>,
  ): () => void;
}
