# @sue/verd-board-agent

## 0.2.0

### Minor Changes

- Release VerdBoard 0.2.0 with workspace navigation and search, independent file editing and Quick Create, local Codex task review, and read-only bundled libraries.

### Patch Changes

- Updated dependencies
  - @sue/board-architecture@0.2.0
  - @sue/board-common@0.2.0
  - @sue/board-core@0.2.0
  - @sue/board-draw@0.2.0
  - @sue/board-layouts@0.2.0
  - @sue/board-markdown-to-text@0.2.0
  - @sue/board-mermaid-to-board@0.2.0
  - @sue/board-mind@0.2.0
  - @sue/board-react-text@0.2.0
  - @sue/board-uml@0.2.0
  - @sue/board-workflow@0.2.0
  - @sue/verd-board-agent-patterns@0.2.0
  - @sue/verd-board-file-workspace@0.2.0
  - @sue/verd-board-workspace@0.2.0

## 0.1.0

Initial VerdBoard development baseline.

- Support portable project-folder workspaces shared by Desktop and a local Web editor. The Node HTTP/SSE service discovers the enclosing Git repository, scopes commits and restores to workspace files, keeps host sessions separate, and makes Agent setup explicit. Trashing files preserves committed Git history.
- Use .verd for new JSON canvas files and support opening existing .verd.json files. Desktop opens Markdown and canvas files from the system in independent windows. Visual Markdown editing saves to the original file.
