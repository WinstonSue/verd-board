import { describe, expect, it, vi } from 'vitest';
import type { EdgeCell, Point } from '@sue/board-core';
import {
  buildSelectedEndpointPlan,
  terminalKey,
  portKey,
  resolvePortGroup,
  type PortCandidate,
} from './frame-port-model';

const node: PortCandidate = {
  key: portKey('a', 'out'),
  point: [10, 20],
  owner: { kind: 'node', nodeId: 'a', portId: 'out' },
};
const edge = (id = 'e'): EdgeCell => ({
  id,
  cellType: 'edge',
  kind: 'arrow',
  source: { cellId: 'a', portId: 'out' },
  target: { point: [80, 20] },
  route: { mode: 'straight' },
});
const plan = (
  edges = [edge()],
  nodeMode = false,
  getPoints = (_edge: EdgeCell): readonly Point[] => [
    [10, 20],
    [80, 20],
  ],
) => {
  const getNodePorts = vi.fn(() => [node]);
  const queryNodePorts = vi.fn(() => []);
  const getRoute = vi.fn(getPoints);
  return {
    ...buildSelectedEndpointPlan({
      edges,
      selectedIds: new Set(edges.map((edge) => edge.id)),
      nodeMode,
      getPoints: getRoute,
      getNodePorts,
      queryNodePorts,
    }),
    getRoute,
    getNodePorts,
    queryNodePorts,
  };
};
describe('selected endpoint plans', () => {
  it('generates two stable endpoint identities and only reads selected routes', () => {
    const result = plan();
    expect(result.endpoints.map((end) => end.key)).toEqual([
      terminalKey('e', 'source'),
      terminalKey('e', 'target'),
    ]);
    expect(result.getRoute).toHaveBeenCalledOnce();
    expect(result.getNodePorts).toHaveBeenCalledWith('a');
    expect(result.queryNodePorts).toHaveBeenCalledOnce();
    expect(result.suppressedNodePortKeys.has(node.key)).toBe(true);
    expect(result.groups[0].owner?.owner).toEqual({
      kind: 'edge',
      edgeId: 'e',
      end: 'source',
    });
  });
  it('does not merge a portId binding whose actual route endpoint differs', () => {
    const result = plan([edge()], false, () => [
      [10, 25],
      [80, 20],
    ]);
    expect(result.suppressedNodePortKeys.size).toBe(0);
    expect(result.endpoints[0].point).toEqual([10, 25]);
    expect(result.hasPoint([10, 20])).toBe(false);
  });
  it('keeps node creation priority for mixed selection inside the independent group', () => {
    const result = plan([edge()], true);
    expect(result.groups[0].owner?.owner).toEqual(node.owner);
    expect(result.suppressedNodePortKeys.has(node.key)).toBe(true);
  });
  it('blocks shared selected endpoints without choosing an arbitrary edge', () => {
    const result = plan([edge('e2'), edge('e1')]);
    expect(result.endpoints).toHaveLength(4);
    expect(result.groups).toHaveLength(2);
    expect(
      result.groups.every((group) => group.blocked && group.owner === null),
    ).toBe(true);
  });
  it('retains both identities for a self-loop whose endpoints coincide', () => {
    const result = plan([edge()], false, () => [
      [10, 20],
      [10, 20],
    ]);
    expect(result.endpoints).toHaveLength(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].blocked).toBe(true);
  });
  it('merges floating point coincidence but not overlapping hit areas', () => {
    const result = plan([edge('a'), edge('b')], false, (edge) =>
      edge.id === 'a'
        ? [
            [10, 20],
            [80, 20],
          ]
        : [
            [10 + 5e-7, 20],
            [85, 20],
          ],
    );
    expect(result.groups).toHaveLength(3);
    expect(result.hasPoint([10 - 4e-7, 20])).toBe(true);
    expect(result.hasPoint([10, 21])).toBe(false);
  });
  it('does not let a pending connection override an explicitly selected edge', () => {
    const endpoint: PortCandidate = {
      key: terminalKey('e', 'source'),
      point: [10, 20],
      owner: { kind: 'edge', edgeId: 'e', end: 'source' },
    };
    expect(
      resolvePortGroup([node, endpoint], {
        selectedIds: new Set(['e']),
        nodeMode: false,
        connecting: true,
      }).owner,
    ).toBe(endpoint);
  });
});
