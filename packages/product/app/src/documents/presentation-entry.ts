import type { ActionResult } from '@sue/board-common';

/** Preserve the initiating gesture while waiting for the captured editor. */
export async function enterDocumentPresentation(options: {
  requestFullscreen(): void;
  flushEditing(): Promise<ActionResult>;
  isCurrent(): boolean;
  enter(): void;
  cancel(): void;
  onError(message: string): void;
}): Promise<ActionResult> {
  options.requestFullscreen();
  try {
    const receipt = await options.flushEditing();
    if (!options.isCurrent()) {
      options.cancel();
      return { status: 'cancelled', code: 'stale-context' };
    }
    if (receipt.status !== 'completed' && receipt.status !== 'noop') {
      options.cancel();
      if ('code' in receipt) options.onError(receipt.message ?? receipt.code);
      return receipt;
    }
    options.enter();
    return { status: 'completed' };
  } catch (error) {
    options.cancel();
    const message = error instanceof Error ? error.message : String(error);
    options.onError(message);
    return { status: 'rejected', code: 'presentation-failed', message };
  }
}
