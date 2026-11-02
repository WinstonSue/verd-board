---
'@sue/board-common': minor
'@sue/board-core': minor
'@sue/board-draw': minor
'@sue/board-mind': minor
'@sue/board-react': minor
'@sue/board-react-architecture': minor
'@sue/board-react-workflow': minor
'@sue/board-react-draw': minor
'@sue/board-react-mind': patch
'@sue/board-react-text': minor
'@sue/board-react-uml': minor
'@sue/board-mermaid-to-board': patch
'@sue/verd-board-ui': minor
'@sue/verd-board-app': patch
---

Add light and dark variants for Classic, Colorful, Soft, Retro, Fresh and Ocean while preserving existing theme IDs. Resolve canvas colors at render time, take over all unmarked component colors, and retain per-field custom color sources through edits, copying and inheritance. Adapt embedded documents, references and presentation without saving appearance into files or undo history. Image exports can use the current, light or dark appearance independently of their background choice and retain the full source content of selected references; existing third-party renderers retain legacy colors when appearance is omitted. Share domain color defaults across drawing and inspectors, add Mind branch reset, and distinguish explicitly authored Mermaid styles from renderer defaults.

Make rich-text color provenance explicit with optional textStyle.attrs.colorSource. Unmarked and theme text inherits readable local colors in canvases, standalone documents and embedded documents; custom text keeps its literal color. Share the schema across previews and editors, preserve original literals and sources in HTML, record identical manual color choices, and clear only the color override when returning to the theme. Keep legacy third-party rendering and user workspace files unchanged; cover real legacy text marks, appearance switching, history, source roundtrips and image exports.

Add five color roles, three emphasis levels and six coordinated categorical families to every theme appearance. Domain mappings distinguish workflow roles, architecture layers, UML classifiers and participants, drawing shape families, table headers and swimlanes. Share local fill/stroke/text resolution with inspectors and exports, preserve custom field overrides and Mind schemes, and document the actual palette values and swatches in the native architecture design.
