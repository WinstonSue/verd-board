---
"@sue/board-core": patch
"@sue/board-mind": patch
"@sue/board-workflow": patch
"@sue/board-react": patch
"@sue/verd-board-ui": patch
---

Reuse calculation-scoped hierarchy indexes for drag snap candidates and presentation visibility checks, removing quadratic whole-store scans from drag initialization and commit rendering. Preserve group, ancestor-lock, hidden-content and collapsed Mind semantics without caching mutable stores globally. Reuse pure topology, Workflow ownership and Mind branch reads within each synchronous full validation, clearing the context on completion or failure. Keep grouped Workflow and architecture layout conflicts visible through the shared lightweight availability check.
