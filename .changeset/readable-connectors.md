---
"@sue/board-core": patch
"@sue/board-architecture": patch
"@sue/board-react": patch
"@sue/board-react-draw": patch
"@sue/board-react-mind": patch
"@sue/board-react-uml": patch
---

Improve connected-node spacing, architecture terminal allocation and frame-wide orthogonal routing. Add display-only line jumps, rounded elbows and local relationship highlighting while preserving authored paths and document formats.

Keep relationship hints subordinate to selection and simplify automatic short connector stairs within a bounded crossing budget, preserving authored waypoints.

Unify node, connector and arrow interaction outlines in opaque #6366f1 with scene-scaled widths (authored width + 1 for selection/editing, authored width for self-hover and direct relationships) and a shared light/dark soft shadow. Keep interaction paint independent of authored opacity, width, color and shadow, update only local leaves during zoom or hover, and omit interaction outlines and filters from image export.

Strengthen the shared interaction shadow with a 0.75px shadow-only spread, 2.25px / 90% light halo and 1.25px / 65% dark halo, with half the effective local stroke width plus 12px screen-space filter padding. Verify actual shadow pixels beyond the interaction stroke across backgrounds and zoom levels.

Replace authored outlines during interaction instead of layering color over the original stroke. Highlight isolated nodes and Frame/reference shells on self-hover, preserve dash patterns and arrow semantics, and restore authored stroke paint in image clones without changing the live canvas.
