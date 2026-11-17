import { collectArrangementBlocks, type ArrangementBlock } from './arrangement';
import {
  graphArrangementPositions,
  type ArrangementLink,
} from './arrangement-graph';
import { relationshipArrangementPositions } from './relationship-layout';
import { translateCellSelection } from './commands';
import { unionCellBounds } from './group';
import type { GeometryPlanningContext } from './geometry-policy';
import type { CellOperation } from './index';

/** Domain adapters supply topology/order; the core supplies rigid blocks and moves. */
export function planDomainGraphLayout(
  context: GeometryPlanningContext,
  options: {
    ids: readonly string[];
    links: readonly ArrangementLink[];
    rows?: (blocks: ArrangementBlock[]) => ArrangementBlock[][];
    horizontal?: boolean;
    anchorId?: string;
  },
): CellOperation[] {
  const { store, frameId, registry, spacing } = context;
  const blocks = collectArrangementBlocks(
    store,
    frameId,
    options.ids.filter((id) => store.cells[id]?.kind !== 'card'),
    registry,
  ).filter(
    (b) =>
      !b.locked && !b.members.some((id) => store.cells[id]?.kind === 'card'),
  );
  if (blocks.length < 2) return [];
  const owner = new Map(
    blocks.flatMap((b) => b.members.map((id) => [id, b.id] as const)),
  );
  const links = options.links.flatMap((e) => {
    const source = owner.get(e.source),
      target = owner.get(e.target);
    return source && target && source !== target ? [{ source, target }] : [];
  });
  const horizontal = options.horizontal;
  const rotated = blocks.map((b) => ({
    ...b,
    bounds: horizontal
      ? { ...b.bounds, width: b.bounds.height, height: b.bounds.width }
      : b.bounds,
  }));
  // Relationship layout condenses strongly connected components before ranking.
  const positions = options.rows
    ? graphArrangementPositions(
        options.rows(rotated),
        links,
        spacing.nodeGap,
        spacing.rankGap,
      )
    : relationshipArrangementPositions(
        rotated,
        links,
        spacing.nodeGap,
        spacing.rankGap,
      );
  const bounds = unionCellBounds(blocks.map((b) => b.bounds))!;
  const anchor = blocks.find((b) => b.members.includes(options.anchorId ?? ''));
  const point = (id: string) => {
    const p = positions.get(id)!;
    return horizontal ? [p[1], p[0]] : p;
  };
  const origin = anchor
    ? [
        anchor.bounds.x - point(anchor.id)[0],
        anchor.bounds.y - point(anchor.id)[1],
      ]
    : [bounds.x, bounds.y];
  return blocks.flatMap((b) =>
    translateCellSelection(
      store,
      [b.id],
      [
        origin[0] + point(b.id)[0] - b.bounds.x,
        origin[1] + point(b.id)[1] - b.bounds.y,
      ],
      registry,
      { preserveMembership: true },
    ),
  );
}
