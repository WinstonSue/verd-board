# desktop

## 0.1.0

Initial VerdBoard development baseline.

- Support portable project-folder workspaces shared by Desktop and a local Web editor. The Node HTTP/SSE service discovers the enclosing Git repository, scopes commits and restores to workspace files, keeps host sessions separate, and makes Agent setup explicit. Trashing files preserves committed Git history.
- Use .verd for new JSON canvas files and support opening existing .verd.json files. Desktop opens Markdown and canvas files from the system in independent windows. Visual Markdown editing saves to the original file.
