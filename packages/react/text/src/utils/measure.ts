export function safeFocus(
  editor:
    | {
        commands: {
          focus: (
            pos?: 'end',
            options?: { scrollIntoView?: boolean },
          ) => unknown;
        };
        view?: unknown;
      }
    | null
    | undefined,
) {
  if (!editor || !editor.view) {
    return;
  }
  try {
    // Focus must not scroll a clipped, vertically centered canvas text box.
    editor.commands.focus('end', { scrollIntoView: false });
  } catch (error) {
    console.warn('[Editor] focus failed:', error);
  }
}

export function measureContainerSize(container: HTMLElement | null): {
  width: number;
  height: number;
} {
  if (!container) {
    return { width: 0, height: 0 };
  }
  return {
    width: container.scrollWidth,
    height: container.scrollHeight,
  };
}
