---
'@sue/board-core': major
'@sue/board-draw': major
'@sue/board-mind': major
'@sue/board-workflow': major
'@sue/board-architecture': major
'@sue/board-uml': major
'@sue/board-react': major
'@sue/board-react-draw': major
'@sue/board-react-mind': major
'@sue/board-react-workflow': major
'@sue/board-react-architecture': major
'@sue/board-react-uml': major
'@sue/verd-board-ui': major
'@sue/verd-board-app': major
'@sue/board-markdown-to-board': major
'@sue/board-mermaid-to-board': major
'@sue/board-react-text': minor
---

Introduce explicit, instance-scoped CellPlugin and FrameUIPlugin composition for Draw, Mind, Workflow, Architecture and UML. Domain kinds and models move out of core. FrameEditor composes a complete editor from one domain; FrameCanvas takes the same pluginSet used for previews, references and image export. Add the Draw React package and public per-package CSS entries; keep rich text built into React core and inject optional converters from the host.

Pass the installed registry to independent domain-sensitive helpers. Reject unknown kinds before opening or importing files, with no normalization or writes. Duplicate plugin IDs and kind conflicts fail explicitly; runtime installation is unsupported. Preserve atomic transaction/history behavior and existing FrameFileV2/DocumentFileV1 serialized fields. See the native Architecture, React integration and migration documents for the next-major contract. No version bump or publication is performed in this change.
