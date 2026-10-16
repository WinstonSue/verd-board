---
'@sue/board-architecture': minor
'@sue/board-react': minor
'@sue/verd-board-ui': minor
'@sue/verd-board-app': minor
---

Add fullscreen presentation of current canvas content in an independent read-only overlay using the same registry and render extensions with click-to-focus, overview, a laser pointer, and structural steps for mind maps and architecture layers. Exit restores the editing viewport; presentation state stays in memory without changing document history or saved files.

Remove obsolete slide generation, persisted decks, speaker notes, ink, timers, autoplay, and audience-window protocols and preload/IPC plumbing. Ignore stale imported presentation fields without migration or proactive rewrites, and preserve node appearance FramePresentation hooks.
