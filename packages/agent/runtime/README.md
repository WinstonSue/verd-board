# VerdBoard Agent

CLI and typed authoring APIs for native VerdBoard workspaces. The npm CLI requires Node.js 22+. Desktop ships a self-contained Node 24.18.1 runtime and complete dependencies; its project launcher needs no system Node/npm.

`verd describe --json` exposes the operation schema. `verd rules --json` and `verd patterns --json` expose installed rules and patterns. `verd skill` locates the bundled skill.

```sh
# Desktop creates the managed guide and shared directory link automatically.
.verdscrolls/shared/bin/verd context --json
verd doctor --workspace /path/to/workspace
verd init --workspace /path/to/workspace --shared /path/to/agent-resources
verd patterns workspace --dest /path/to/new-pattern-copy
verd inspect --workspace /path/to/workspace --json
verd plan --workspace /path/to/workspace --input operations.json --out plan.json
verd validate --workspace /path/to/workspace --plan plan.json
verd preview FILE_ID --workspace /path/to/workspace --plan plan.json --out preview.png
verd apply --workspace /path/to/workspace --plan plan.json
```

Preview uses bundled browser assets; install Chromium once with `verd preview --install-browser`. Other commands do not need a browser. All commands output JSON; failures use nonzero exit codes (validation 1, input/environment 2, stale workspace 3). Read-only `doctor` exits 0 when `ready` is true and 1 when the project is unready; it never initializes or repairs the project without `--repair`.

The public API exports `AuthoringOperation`, `PreparedBatch`, `AuthoringDiagnostic`, `readNativeSnapshot`, `prepareAuthoringBatch`, and `applyPreparedBatch`. `@sue/verd-board-agent/node` exports the same filesystem host used by Desktop and the local Web service.

Native rules and executable templates live in `@sue/verd-board-agent-patterns`. Local browsing copies preserve edits and never change the installed templates. No MCP server or publishing is involved.

Commands discover the nearest initialized ancestor, stopping at an uninitialized Git root. Explicit `--workspace` selects exactly that directory. `context` and `doctor` are read-only; `init` and `doctor --repair` share Desktop initialization and metadata migration. Root `AGENTS.md` retains user prose outside its managed block. `.verdscrolls/config.json` owns project identity/name plus `project.description` and `project.entryDocumentIds`; empty fields remain empty. The internal `.gitignore` keeps portable config and excludes machine links/runtime state. A missing resource bundle is reported as unready; open the folder in Desktop or supply `--shared` to repair it.

The `/node` entry exports `WorkspaceProjectContext`, discovery, initialization, status inspection and versioned resource deployment. Migration atomically renames legacy `.verdboard` before recovery. Populated dual directories and old writers block writes; unreadable journals remain on disk. A resource build change invalidates pending plans; confirmed transaction IDs still return their original receipts. macOS/Linux use directory symlinks and Windows uses junctions.

`verd resource-import --input /absolute/paper.pdf --workspace /path/to/workspace --json` stores a bounded, content-addressed local resource and returns attachment attributes. Pass these attributes to an `attachment` node in `document.set` or `document.splice`; PDF page references use `verd://asset/<sha256>.pdf#page=1`.

The `/node` entry also exports `createLocalWorkspaceManager`, `seedBuiltinWorkspace` and `createBuiltinWorkspaceUpdater`. Desktop and Service share initialization, recent workspaces, seeding, updates, backups and recovery while injecting their own directory selection and data locations.

## Third-party SDK integration

The Agent is independent of the product app/ui packages. Install `@sue/verd-board-agent` for Node authoring and the `verd` CLI; use `@sue/verd-board-workspace` directly for shared file models, host/session APIs and validation. The Agent's public entrypoints, operation schema, prepared plans and transaction receipts retain their existing contracts. Browser preview assets are bundled with the Agent and compose the React SDK plugins directly.
