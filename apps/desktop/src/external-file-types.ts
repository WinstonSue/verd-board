import type { WorkspaceFile, WorkspaceHost } from '@sue/verd-board-app';

export type { ExternalFileBinding } from '@sue/verd-board-app';
import type { ExternalFileBinding } from '@sue/verd-board-app';
export interface DesktopFilesApi {
  binding(): Promise<ExternalFileBinding | null>;
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
  warnings(): Promise<string[]>;
  readImage(href: string): Promise<Uint8Array>;
  openLink(href: string): Promise<void>;
  resolve(
    action: 'load-disk' | 'keep-local' | 'save-copy',
    files: { file: WorkspaceFile; path: string }[],
  ): Promise<boolean>;
  setDefaults(): Promise<void>;
  onOpenWorkspaceFile(listener: (path: string) => void): () => void;
}
