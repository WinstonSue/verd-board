---
name: verd-authoring
description: Create, edit, validate, and preview VerdBoard native documents and diagrams using the verd CLI. Use for .verd-doc.json/.verd.json workspaces and agent pattern templates.
---

# VerdBoard authoring

First read the root `AGENTS.md` managed guide and run `.verdscrolls/shared/bin/verd context --json` from the project root (Windows: `.verdscrolls\shared\bin\verd.cmd context --json`). This project-local launcher carries its own Node runtime; do not assume a global `verd` or Node installation. In the commands below, `verd` means that launcher. Use `context` for the project identity, description, reading entries, current file identities and installed specification version. Empty description/entry fields mean the user has not provided them; do not invent project policy. Open the entry documents before choosing a pattern.

Commands discover the nearest initialized ancestor from a subdirectory and stop at an uninitialized Git root. An explicit `--workspace` takes precedence. `verd doctor` only inspects; `verd init` and `verd doctor --repair` may initialize/migrate metadata and repair the managed guide/shared link. Missing links should be repaired by reopening the folder in Desktop or using `--shared <resource-directory>` from an installed launcher. Preserve all text outside the VerdScrolls managed AGENTS block. Do not edit the shared resource bundle; the pattern library browsing copy is separate.

Use the installed CLI against the requested workspace. `verd describe --json` exposes the installed operation schema, editor nodes/marks and cell kinds; `verd rules --json` explains diagnostics. Avoid inferring constraints from old examples or reverse engineering the desktop binary.

Select a pattern with `verd patterns --json` or inspect its entry with `verd patterns <id> --json`. To browse editable examples, initialize a separate copy with `verd patterns workspace --dest <new-directory>`. Edits to this copy do not change the CLI's installed templates or the source package.

Before creating or modifying a diagram, read the installed native quality guide `.verdscrolls/shared/patterns/图表编写规范.verd-doc.json` (document ID `pattern-guide:diagram-quality`). Its `text.content` is the source; `text.plainText` is the reading cache. For a standalone CLI installation without shared resources, read `图表编写规范.verd-doc.json` under the `patternWorkspace` returned by `verd describe --json`. Follow its judgment, text fitting and visual review rules together with the selected pattern guide.

For an existing workspace, inspect identities and current blocks first:

```sh
verd inspect --workspace <directory> --json
verd plan --workspace <directory> --input operations.json --out plan.json --json
verd validate --workspace <directory> --plan plan.json --json
verd preview <file-id> --workspace <directory> --plan plan.json --out preview.png --json
verd apply --workspace <directory> --plan plan.json --json
```

For a copied canvas node link, run `verd inspect 'verd://file/board#cell%3Atask' --workspace <directory> --json`. It returns the saved `node`, current `fileId`, workspace-relative `path`, `fileVersion` and JSON `pointer`. The node ID resolves to its current owner after a move. A missing or duplicated identity returns `missing-cell` or `ambiguous-cell` and a nonzero exit code.

A first operation can be `{"type":"pattern.instantiate","patternId":"multi-system","dir":"design"}`. `plan` fixes identities and returns the final file IDs. Use the IDs from `inspect` for targeted edits. `document.splice` edits top-level blocks without rewriting unrelated rich text. Use scene-specific relation/sequence operations so membership and event order remain valid. All operations and accepted fields are available through `describe`.

Treat Markdown/Mermaid as creation/exchange inputs; preserve existing native structure, rich-text marks and references when making incremental changes. Templates provide organization principles, not project-specific business policy. For workflow retries use process mode; DAG layout does not accept cycles. Sequence positions follow participant/event order.

Before applying diagram edits, complete semantic self-review, run `validate`, run `preview` for each affected diagram using the current plan, and open the rendered images. Inspect affected nodes and nearby connections at readable detail; fix problems and repeat validation and preview after changes. Follow the quality guide's acceptance checklist even when no visual warnings are returned. For workflow, architecture, and UML class diagrams, use orthogonal connectors. Workflow defaults use right-out/left-in horizontally and bottom-out/top-in vertically. Explicit ports may be used for branches and loops. In these diagram kinds, a swimlane can record same-frame node IDs in `data.laneMembers`, keyed by its lane header entry ID. Keep each node within its lane body and group nodes within one lane or among unassigned nodes. Use sequence lifelines and combined fragments for sequence diagrams.

Resolve error diagnostics before applying. Browser installation is only needed for preview: `verd preview --install-browser`.

A shared resource upgrade invalidates uncommitted plans; generate a new plan. Confirmed receipts remain available by transaction ID after metadata migration. A version conflict requires reading the latest workspace and preparing a fresh plan. Do not edit the old plan's version token or integrity. If commit outcome is unconfirmed, retry the exact same plan/transaction to confirm it. A successful apply is a saved local change; it does not publish or commit Git changes.
