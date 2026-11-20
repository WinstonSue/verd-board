# @sue/board-react-actions

Shared React action scopes, command palette and shortcut help. React 18 or later is required. The runtime depends only on React and `@sue/board-common`; it does not import the board renderer, text editor or product packages.

<!-- consumer-example -->

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { createActionRegistry } from '@sue/board-common';
import { ActionScope } from '@sue/board-react-actions';
import '@sue/board-react-actions/style.css';

export function ActionsExample() {
  const registry = useMemo(() => {
    const actions = createActionRegistry({ getContext: () => ({}) });
    actions.register({
      id: 'example.inspect',
      label: { zh: '检查内容', en: 'Inspect content' },
      category: 'Example',
      effect: 'view',
      shortcuts: [{ key: 'i', mod: true, shift: true }],
      execute: () => ({ status: 'completed' }),
    });
    actions.seal();
    return actions;
  }, []);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) registry.dispose();
      });
    };
  }, [registry]);
  return (
    <ActionScope registry={registry}>
      <button>Example surface</button>
    </ActionScope>
  );
}
```

`Ctrl/Cmd+Shift+P` opens the palette for the nearest scope. `onReady` exposes `openPalette()` and `openHelp()` for menu buttons; cleanup reports `null`. Scopes preserve layout with `display: contents`, route parent bindings once, and protect text input, composition, native clipboard transport and local disabled bindings.

Palette keys use the capture phase so an editor's key isolation does not swallow them; other shortcuts continue to use bubbling. Set `paletteFallback` on one root scope to open its palette when focus is on `body` or `html`, including immediately after reload. It defaults to `false`, does not infer an active editor, and stays inactive while a visible menu or dialog owns interaction. Focus inside a nested or disabled scope never falls through to this document-level fallback.

Use `action.capture()` before opening a custom menu so subsequent focus changes cannot retarget the command. `CommandPalette` and `ActionHelp` capture their supplied `actions` on mount; pass `sources` to subscribe to live availability. Internal actions with required arguments should set `palette: false` and expose a separate argument-selecting dialog action.

Registry lifetime belongs to the host. The example defers disposal for one microtask so React StrictMode can replay its effect without disposing a reused registry. Refresh a captured context by its original identity, invalidate after host state changes, and dispose when that editing scope is permanently closed. Action definitions performing asynchronous work must check `invocation.signal` or `invocation.checkpoint()` before committing after an await.

For clipboard or file-picker commands that also mutate content, `beforeFlush(context, args, invocation)` can start transport synchronously after permission/argument checks. Its return value is available as `invocation.preflight` during execution. Capture and validate the original source again after asynchronous transport completes, before committing operations.
