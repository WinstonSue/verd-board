# VerdBoard Agent

CLI and typed authoring APIs for native VerdBoard workspaces. Requires Node.js 22+.

`verd describe --json` exposes the operation schema. `verd rules --json` and `verd patterns --json` expose installed rules and patterns. `verd skill` locates the bundled skill.

```sh
verd patterns workspace --dest /path/to/new-pattern-copy
verd inspect --workspace /path/to/workspace --json
verd plan --workspace /path/to/workspace --input operations.json --out plan.json
verd validate --workspace /path/to/workspace --plan plan.json
verd preview FILE_ID --workspace /path/to/workspace --plan plan.json --out preview.png
verd apply --workspace /path/to/workspace --plan plan.json
```

Preview uses bundled browser assets; install Chromium once with `verd preview --install-browser`. Other commands do not need a browser. All commands output JSON; failures use nonzero exit codes (validation 1, input/environment 2, stale workspace 3).

The public API exports `AuthoringOperation`, `PreparedBatch`, `AuthoringDiagnostic`, `readNativeSnapshot`, `prepareAuthoringBatch`, and `applyPreparedBatch`. `@sue/verd-board-agent/node` exports the same filesystem host used by Desktop.

Native rules and executable templates live in `@sue/verd-board-agent-patterns`. Local browsing copies preserve edits and never change the installed templates. No MCP server or publishing is involved.
