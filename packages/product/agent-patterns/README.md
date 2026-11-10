# VerdBoard Agent Patterns

Independent content package for native VerdBoard authoring, with separate executable Agent defaults and user-facing authoring recommendations. `catalog.json` describes only Agent patterns; `recommendations.json` describes the user library.

Open the Document authoring recommendations from Desktop's workspace menu, or use `verd patterns workspace --dest /path/to/new-directory`. These initialize editable user copies. Existing Desktop copies survive upgrades; explicit CLI destinations must be new directories.

Executable Agent defaults live in `agent/`, with their own catalog, rules, Skills and templates. The `./agent` entry exports `patterns`, `patternRules`, `patternWorkspaceUrl` and the default loaders; the root entry retains these exports for compatibility.

User authoring advice lives independently in `workspace/`, indexed by `recommendations.json`. The `./recommendations` entry exports `recommendations`, `recommendationWorkspaceUrl` and `loadRecommendationTemplates`. Product template creation and editable browsing copies use this source. User advice never supplies default Agent prompts, Skills or constraints. Shared runtime upgrades retain full integrity checks and invalidate uncommitted plans.

The package does not depend on the CLI or filesystem host. Template instantiation and validation are performed against the real engine and editor schema.
