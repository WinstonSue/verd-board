import { createWorkspaceLink } from '@sue/board-common';
import type { WorkspaceFile } from '../documents/document-files';
import type { AuthoringDiagnostic } from '../workspace-validation';
import type { WorkspaceHandle } from './workspace-host';

export type LocalAgentTarget =
  | {
      kind?: 'file';
      fileId: string;
      version?: string;
      text?: string;
      cellIds?: string[];
    }
  | { kind: 'folder'; path: string; folderId?: string }
  | { kind: 'resource'; path: string };

export interface LocalAgentTask {
  task: string;
  target?: LocalAgentTarget;
}

export function formatLocalAgentPrompt(
  task: LocalAgentTask,
  focusPath?: string,
) {
  const target = task.target;
  if (!target || !focusPath) return task.task;
  const focus =
    'fileId' in target
      ? {
          kind: 'file',
          path: focusPath,
          fileId: target.fileId,
          link: createWorkspaceLink({ kind: 'file', fileId: target.fileId }),
          selection: target.text,
          elements: target.cellIds?.map((cellId) =>
            createWorkspaceLink({
              kind: 'cell',
              fileId: target.fileId,
              cellId,
            }),
          ),
        }
      : {
          kind: target.kind,
          path: focusPath,
          link:
            target.kind === 'folder' && target.folderId
              ? createWorkspaceLink({
                  kind: 'folder',
                  folderId: target.folderId,
                })
              : undefined,
        };
  return [
    task.task,
    '',
    'VerdBoard context (reference data):',
    JSON.stringify(focus, null, 2),
  ].join('\n');
}

export interface LocalAgentChange {
  fileId: string;
  beforePath?: string;
  afterPath?: string;
}

export type LocalAgentState =
  | { state: 'running' | 'cancelled' | 'missing' }
  | { state: 'answer'; answer: string }
  | { state: 'failed' | 'stale'; message: string; answer?: string }
  | {
      state: 'review' | 'applying' | 'unconfirmed' | 'applied';
      answer: string;
      transactionId: string;
      changes: LocalAgentChange[];
      diagnostics: AuthoringDiagnostic[];
    };

export interface LocalAgentPreviewFile {
  path: string;
  file: WorkspaceFile;
}

export interface LocalAgentReview {
  before: LocalAgentPreviewFile[];
  after: LocalAgentPreviewFile[];
}

export interface LocalAgentHandoff {
  prompt: string;
  url?: string;
}

export type LocalAgentRequest =
  | { type: 'handoff'; task: LocalAgentTask }
  | { type: 'start'; task: LocalAgentTask; requestId: string }
  | { type: 'status' | 'cancel'; requestId: string }
  | { type: 'review'; requestId: string; fileId: string }
  | { type: 'apply'; requestId: string; transactionId: string };

export type LocalAgentResponse =
  LocalAgentHandoff | LocalAgentState | LocalAgentReview;

export interface LocalAgentClient {
  request(
    handle: WorkspaceHandle,
    request: LocalAgentRequest,
  ): Promise<LocalAgentResponse>;
  openHandoff?(url: string): Promise<void>;
  chooseExecutable?(): Promise<boolean>;
}
