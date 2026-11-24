# desktop

## 0.2.0

- Add workspace navigation and search, Quick Create, and editing for independent files.
- Review local Codex tasks in the workspace and browse bundled libraries from Home.

## 0.1.0

Initial VerdBoard development baseline.

- Support portable project-folder workspaces shared by Desktop and a local Web editor. The Node HTTP/SSE service discovers the enclosing Git repository, scopes commits and restores to workspace files, keeps host sessions separate, and makes Agent setup explicit. Trashing files preserves committed Git history.
- Use .verd for new JSON canvas files and support opening existing .verd.json files. Desktop opens Markdown and canvas files from the system in independent windows. Visual Markdown editing saves to the original file.
