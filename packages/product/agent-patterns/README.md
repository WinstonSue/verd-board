# VerdBoard Agent Patterns

Independent, data-only pattern library for native VerdBoard authoring. The versioned `workspace/` contains the maintained native documents and diagram templates. `catalog.json` links stable pattern IDs to parameters, native templates, guides and actual validator rule IDs.

Open the Agent pattern library from Desktop's workspace menu, or use `verd patterns workspace --dest /path/to/new-directory`. These initialize editable user copies. Existing Desktop copies survive upgrades; explicit CLI destinations must be new directories.

The package exports `patterns`, `patternRules`, and `patternWorkspaceUrl`. It does not depend on the CLI or filesystem host. Template instantiation and validation are performed by the agent tooling against the real engine and editor schema.
