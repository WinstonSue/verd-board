# VerdBoard Agent Patterns

Independent content package for native VerdBoard authoring, with separate executable Agent defaults and user-facing authoring recommendations. `catalog.json` describes only Agent patterns; `recommendations.json` describes the user library.

Open the read-only Document authoring recommendations from the Desktop or local Web home page. The first open after this change replaces the old built-in copy with the bundled content. To create an editable workspace, run `verd patterns workspace --dest /path/to/new-directory` with a new destination.

Executable Agent defaults live in `agent/`, with their own catalog, rules, Skills and templates. The `./agent` entry exports `patterns`, `patternRules`, `patternWorkspaceUrl` and the default loaders; the root entry retains these exports for compatibility.

Agent instructions use Markdown as their single maintained source. The common Skill keeps writing/output selection, reporting scenarios and diagram quality in its own `references/`; scenario details are read as needed. Pattern-specific references live beside their Skills, with five document patterns sharing the rich-document guide. Catalogs and structural rules remain JSON; native execution templates keep their identities and paths. `verd patterns` and the standard Skill entrances provide navigation.

Breaking guide API change: `loadPatternGuide(patternId?)` returns `AgentGuideSource { path, title, source }`, with the title taken from the Markdown H1. With no pattern ID it returns the common writing guide. `loadPatternGuides(patternId?)` returns common, scenario, diagram and selected-pattern sources in reading order, deduplicated by path. Consumers read `source` instead of the former native `text` field. The app converts Markdown to an in-memory reading model and exposes its source; no derived native JSON is maintained or written. The content package has no converter dependency.

The common Skill is self-contained when copied to the shared launcher directory. Its references include the plain-report-skills copyright and MIT notice. User documents and reusable output continue to use native documents and independent diagrams.

User authoring advice lives independently in `workspace/`, indexed by `recommendations.json`. The `./recommendations` entry exports `recommendations`, `recommendationWorkspaceUrl` and `loadRecommendationTemplates`. The read-only library and editable CLI copies use this source. User advice never supplies default Agent prompts, Skills or constraints. Shared runtime upgrades retain full integrity checks and invalidate uncommitted plans.

The package does not depend on the CLI or filesystem host. Template instantiation and validation are performed against the real engine and editor schema.
