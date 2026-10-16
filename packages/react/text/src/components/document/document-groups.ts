import type { Transaction } from '@tiptap/pm/state';
import type { DocumentChangeSource } from '../../types/document';

/** Typing bursts within this window share one history group. */
export const INPUT_GROUP_MS = 500;

/**
 * Coarse step direction so continuous typing and continuous deleting merge
 * separately into history.
 */
function stepDirection(transaction: Transaction): 'insert' | 'delete' | 'mix' {
  let direction: 'insert' | 'delete' | 'mix' | undefined;
  transaction.steps.forEach((step) => {
    let inserted = 0;
    let deleted = 0;
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      deleted += oldEnd - oldStart;
      inserted += newEnd - newStart;
    });
    const kind = deleted === 0 ? 'insert' : inserted === 0 ? 'delete' : 'mix';
    direction =
      direction === undefined ? kind : direction === kind ? kind : 'mix';
  });
  return direction ?? 'mix';
}

/**
 * Assigns history group keys to emitted changes. Consecutive input changes
 * sharing a key collapse into one undo step in the workspace history; every
 * paste, format, insert or replace command always stands alone.
 */
export class DocumentGroupTracker {
  private seq = 0;
  private inputGroup: string | null = null;
  private inputDirection: 'insert' | 'delete' | null = null;
  private lastInputAt = 0;
  private structuralBreak = false;
  private compositionGroup: string | null = null;

  private next(prefix: string) {
    return `${prefix}${++this.seq}`;
  }

  /** Explicit caret move, blur or external restore ends the typing run. */
  breakInputGroup() {
    this.inputGroup = null;
    this.inputDirection = null;
  }

  /** Enter — the split forms its own structural operation. */
  breakStructural() {
    this.structuralBreak = true;
  }

  compositionStart() {
    this.compositionGroup = null;
    this.breakInputGroup();
  }

  compositionEnd() {
    this.breakInputGroup();
  }

  externalRestore() {
    this.compositionGroup = null;
    this.breakInputGroup();
  }

  groupFor(
    source: DocumentChangeSource,
    transaction: Transaction,
    now = Date.now(),
  ): string {
    if (source === 'composition') {
      if (!this.compositionGroup) this.compositionGroup = this.next('c');
      this.inputGroup = null;
      return this.compositionGroup;
    }
    this.compositionGroup = null;
    if (source !== 'input') {
      this.breakInputGroup();
      return this.next(source[0]);
    }
    const direction = stepDirection(transaction);
    const kind = direction === 'mix' ? null : direction;
    const expired =
      this.structuralBreak ||
      !this.inputGroup ||
      now - this.lastInputAt > INPUT_GROUP_MS ||
      (kind !== null &&
        this.inputDirection !== null &&
        kind !== this.inputDirection);
    this.structuralBreak = false;
    this.inputDirection = kind;
    if (expired || !this.inputGroup) this.inputGroup = this.next('i');
    this.lastInputAt = now;
    return this.inputGroup;
  }
}
