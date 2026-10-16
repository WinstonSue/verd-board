export interface EntrySource {
  sourceFileId: string;
  refId: string;
  occurrenceId: string;
}

/** Latest entry replaces the previous one. Opening without a source clears it. */
export const rememberEntrySource = (
  sources: Map<string, EntrySource>,
  fileId: string,
  source?: EntrySource,
): Map<string, EntrySource> => {
  if (source) sources.set(fileId, source);
  else sources.delete(fileId);
  return sources;
};

export type ReturnToSourcePlan =
  | { type: 'drop' }
  | { type: 'missing-shell'; fileId: string }
  | { type: 'reveal'; fileId: string; cellId: string };

/** Source context is memory only. A deleted source file drops the back entry. */
export const planReturnToSource = (
  source: EntrySource,
  sourceFileExists: boolean,
  shellExists: boolean,
): ReturnToSourcePlan => {
  if (!sourceFileExists) return { type: 'drop' };
  if (!shellExists)
    return { type: 'missing-shell', fileId: source.sourceFileId };
  return {
    type: 'reveal',
    fileId: source.sourceFileId,
    cellId: source.refId,
  };
};
