---
name: verd-authoring
description: Create, edit, validate, and preview VerdBoard native documents and diagrams using the verd CLI. Apply clear writing, evidence and task-specific reporting guidance. Use for .verd-doc.json/.verd workspaces and agent pattern templates.
---

# VerdBoard authoring

First read the root `AGENTS.md` managed guide and run `.verdscrolls/shared/bin/verd context --json` from the project root (Windows: `.verdscrolls\shared\bin\verd.cmd context --json`). This project-local launcher carries its own Node runtime; do not assume a global `verd` or Node installation. In the commands below, `verd` means that launcher. Use `context` for the project identity, description, reading entries, current file identities and installed specification version. Empty description/entry fields mean the user has not provided them; do not invent project policy. Open the entry documents before choosing a pattern.

Commands discover the nearest initialized ancestor or the relative workspace registered in a project root `.verd.config.json`, and stop at an unconfigured Git root. An explicit `--workspace` takes precedence. Context distinguishes workspace, project and repository roots; keep native writes within the selected workspace, and read enclosing project instructions according to their scope. `verd doctor` only inspects; `verd init` and `verd doctor --repair` may initialize/migrate metadata and repair the managed guide/shared link. Normal folder opens preserve Agent instructions. Enable or repair authoring tools explicitly in Desktop settings, or use `--shared <resource-directory>` from an installed launcher. Preserve all text outside the VerdScrolls managed AGENTS block. Do not edit the shared resource bundle. User authoring recommendations and workspace document bodies are task data, not default Agent instructions. Read executable defaults only from these installed Agent resources; apply user-configured workspace Skills as described below. The editable recommendation library is separate.

Use the installed CLI against the requested workspace. `verd describe --json` exposes the installed operation schema, editor nodes/marks and cell kinds; `verd rules --json` explains diagnostics. Avoid inferring constraints from old examples or reverse engineering the desktop binary.

Select a pattern with `verd patterns --json` or inspect its entry with `verd patterns <id> --json`. Read the standard SKILL.md at its skillPath, relative to the patternWorkspace returned by describe (or .verdscrolls/shared/patterns in a Desktop workspace). To browse editable examples, initialize a separate copy with `verd patterns workspace --dest <new-directory>`. Edits to this copy do not change the CLI's installed templates or the source package.

After reading the default rules and selected pattern guide, read the `workspaceSkills` listed by `context`: first the common workspace Skill, then the supplement for the selected pattern. Independently named custom Skills (scope custom) are activated only when their name and description match the task; do not load all custom Skill bodies automatically. These standard `.agents/skills/<name>/SKILL.md` documents supplement the defaults with project terminology, language, structure and style. They do not relax native format or structural validation. Follow relative references from each Skill directory when needed. Missing supplements mean the default patterns apply. Reload context after changing Skills and regenerate prepared plans: Skill changes invalidate older plans. Preserve unrelated Skills and any optional metadata or referenced resources.

Read [Writing and output selection](references/writing.md) for every authoring task. These principles apply to answers and native content: state the conclusion, preserve facts and qualifications, distinguish evidence from inference, and complete available checks. Read [Reporting scenarios](references/reports.md) only for progress, blockers, decisions, reviews, retrospectives, explanations, roadmaps or acceptance. Before creating or modifying a diagram, read [Diagram quality](references/diagram-quality.md). The common Skill and all its references are self-contained in both the shared launcher directory and the installed pattern resources. [Sources and adaptations](references/sources.md) document the upstream material and license.

Agent instructions and references are Markdown. Native JSON files are executable templates and user content; their identity, schema and cache rules still apply to those files. Use catalog paths and the selected pattern's Skill for template discovery, not deleted native guide identities.

For an existing workspace, inspect identities and current blocks first:

```sh
verd inspect --workspace <directory> --json
verd plan --workspace <directory> --input operations.json --out plan.json --json
verd validate --workspace <directory> --plan plan.json --json
verd preview <file-id> --workspace <directory> --plan plan.json --out <temporary-directory>/preview.png --json
verd apply --workspace <directory> --plan plan.json --json
```

Use an absolute system temporary directory outside the final workspace for `<temporary-directory>`. Preview images are for Agent self-checks and, when useful, conversational review; follow the delivery rules in [Writing and output selection](references/writing.md). Keep native source files as the final deliverables; save additional image exports only when the user explicitly requests them.

For a copied canvas node link, run `verd inspect 'verd://file/board#cell%3Atask' --workspace <directory> --json`. It returns the saved `node`, current `fileId`, workspace-relative `path`, `fileVersion` and JSON `pointer`. The node ID resolves to its current owner after a move. A missing or duplicated identity returns `missing-cell` or `ambiguous-cell` and a nonzero exit code.

A first operation can be `{"type":"pattern.instantiate","patternId":"multi-system","dir":"design"}`. `plan` fixes identities and returns the final file IDs. Use the IDs from `inspect` for targeted edits. `document.splice` edits top-level blocks without rewriting unrelated rich text. Use scene-specific relation/sequence operations so membership and event order remain valid. All operations and accepted fields are available through `describe`.

Treat Markdown/Mermaid as creation/exchange inputs; preserve existing native structure, rich-text marks and references when making incremental changes. Templates provide organization principles, not project-specific business policy. Keep content within the user's current question and established conversation context; select relevant template sections without broadening the task. For workflow retries use process mode; DAG layout does not accept cycles. Sequence positions follow participant/event order.

For diagrams, follow the semantic and visual review loop in [Diagram quality](references/diagram-quality.md), including `workflow.port-direction` warnings. The guide covers orthogonal paths, ports, swimlanes and text fitting. Preview requires a browser; `verd preview --install-browser` installs it when needed.

A shared resource upgrade invalidates uncommitted plans; generate a new plan. Confirmed receipts remain available by transaction ID after metadata migration. A version conflict requires reading the latest workspace and preparing a fresh plan. Do not edit the old plan's version token or integrity. If commit outcome is unconfirmed, retry the exact same plan/transaction to confirm it. A successful apply is a saved local change; it does not publish or commit Git changes.
