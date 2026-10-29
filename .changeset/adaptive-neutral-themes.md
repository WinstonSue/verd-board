---
'@sue/board-core': minor
'@sue/board-draw': minor
'@sue/board-mind': minor
'@sue/board-react': minor
'@sue/board-react-draw': patch
'@sue/board-react-mind': patch
'@sue/board-react-text': patch
'@sue/board-react-uml': patch
'@sue/board-mermaid-to-board': patch
'@sue/verd-board-ui': minor
'@sue/verd-board-app': patch
---

Add light and dark variants for Classic, Colorful, Soft, Retro, Fresh and Ocean while preserving existing theme IDs. Resolve canvas colors at render time, take over all unmarked component colors, and retain per-field custom color sources through edits, copying and inheritance. Adapt embedded documents, references and presentation without saving appearance into files or undo history. Image exports can use the current, light or dark appearance independently of their background choice and retain the full source content of selected references; existing third-party renderers retain legacy colors when appearance is omitted. Share domain color defaults across drawing and inspectors, add Mind branch reset, and distinguish explicitly authored Mermaid styles from renderer defaults.
