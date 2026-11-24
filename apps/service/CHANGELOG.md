# service

## 0.2.0

### Minor Changes

- Release VerdBoard 0.2.0 with workspace navigation and search, independent file editing and Quick Create, local Codex task review, and read-only bundled libraries.

### Patch Changes

- Updated dependencies
  - @sue/verd-board-agent@0.2.0
  - @sue/verd-board-app@0.2.0

## 0.1.0

Initial VerdBoard development baseline.

- Support portable project-folder workspaces shared by Desktop and a local Web editor. The Node HTTP/SSE service discovers the enclosing Git repository, scopes commits and restores to workspace files, keeps host sessions separate, and makes Agent setup explicit. Trashing files preserves committed Git history.
