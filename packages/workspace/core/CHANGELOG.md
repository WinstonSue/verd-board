# Changelog

## 2.2.1

### Patch Changes

- Updated dependencies
  - @sue/board-architecture@2.1.1
  - @sue/board-core@2.1.1
  - @sue/board-draw@2.1.1
  - @sue/board-mind@2.1.1
  - @sue/board-react-text@2.1.1
  - @sue/verd-board-agent-patterns@2.1.2
  - @sue/board-uml@2.1.1
  - @sue/board-workflow@2.1.1

## 2.2.0

### Minor Changes

- Extract the shared workspace SDK so third-party Node Agent consumers do not install product app/ui. Add the generic FrameCanvasPreview API while preserving product defaults and existing headless exports. Move Agent packages out of product and organize product UI source by responsibility without changing public entrypoints.

  Reserve the canvas label padding when sizing architecture layer headings so short Latin SDK names remain visible in standalone previews.

### Patch Changes

- Updated dependencies
  - @sue/verd-board-agent-patterns@2.1.1

## 2.1.0

- Introduce the shared workspace SDK extracted from the product headless implementation, preserving native formats, conditional commits, history, validation and resource semantics.
