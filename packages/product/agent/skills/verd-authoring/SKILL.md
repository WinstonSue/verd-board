---
name: verd-authoring
description: Create, edit, validate, and preview VerdBoard native documents and diagrams using the verd CLI. Use for .verd-doc.json/.verd.json workspaces and agent pattern templates.
---

# VerdBoard authoring

Use the installed `verd` CLI against the requested workspace. `verd describe --json` exposes the installed operation schema, editor nodes/marks and cell kinds; `verd rules --json` explains diagnostics. Avoid inferring constraints from old examples or reverse engineering the desktop binary.

Select a pattern with `verd patterns --json` or inspect its entry with `verd patterns <id> --json`. To browse editable examples, initialize a separate copy with `verd patterns workspace --dest <new-directory>`. Edits to this copy do not change the CLI's installed templates or the source package.

For an existing workspace, inspect identities and current blocks first:

```sh
verd inspect --workspace <directory> --json
verd plan --workspace <directory> --input operations.json --out plan.json --json
verd validate --workspace <directory> --plan plan.json --json
verd preview <file-id> --workspace <directory> --plan plan.json --out preview.png --json
verd apply --workspace <directory> --plan plan.json --json
```

A first operation can be `{"type":"pattern.instantiate","patternId":"multi-system","dir":"design"}`. `plan` fixes identities and returns the final file IDs. Use the IDs from `inspect` for targeted edits. `document.splice` edits top-level blocks without rewriting unrelated rich text. Use scene-specific relation/sequence operations so membership and event order remain valid. All operations and accepted fields are available through `describe`.

Treat Markdown/Mermaid as creation/exchange inputs; preserve existing native structure, rich-text marks and references when making incremental changes. Templates provide organization principles, not project-specific business policy. For workflow retries use process mode; DAG layout does not accept cycles. Sequence positions follow participant/event order.

Resolve error diagnostics before applying. Basic visual warnings need inspection of the rendered image; a valid schema alone does not establish readable layout. Browser installation is only needed for preview: `verd preview --install-browser`.

A version conflict requires reading the latest workspace and preparing a fresh plan. Do not edit the old plan's version token or integrity. If commit outcome is unconfirmed, retry the exact same plan/transaction to confirm it. A successful apply is a saved local change; it does not publish or commit Git changes.
