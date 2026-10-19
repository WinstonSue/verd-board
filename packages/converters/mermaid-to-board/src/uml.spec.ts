import { describe, it, expect } from 'vitest';
import { parseMermaidToFrameSnapshot, serializeFrameToMermaid } from './index';
import {
  isNodeCell,
  isEdgeCell,
  umlRoot,
  type UmlSequenceData,
  type NodeCell,
  type UmlClassData,
  type UmlFragmentData,
} from '@sue/board-core';
const classes = `classDiagram
class Service {
  +String name
  +run(id) Result
}
class Contract
<<interface>> Contract
Service ..|> Contract : implements
Service "1" o-- "*" Contract : owns
Service --> Contract : uses
`;
const sequence = `sequenceDiagram
actor A as User
participant B as Service
A->>B: run()
activate B
alt allowed
  loop each
    B->>B: compute()
  end
else denied
  Note over A,B: rejected
end
B-->>A: result
deactivate B
`;
describe('native UML Mermaid conversion', () => {
  it('round trips classifiers, raw members, relationship direction and multiplicities', async () => {
    const native = await parseMermaidToFrameSnapshot(classes, {
      scene: 'uml-class',
    });
    const values = Object.values(native.store.cells);
    expect(values.filter((c) => c.kind === 'uml-class')).toHaveLength(2);
    expect(
      (
        values.find(
          (c) =>
            c.kind === 'uml-class' &&
            isNodeCell(c) &&
            c.content?.label === 'Service',
        ) as NodeCell<UmlClassData>
      ).data!.methods,
    ).toEqual(['+run(id) Result']);
    const edges = values.filter(isEdgeCell);
    expect(edges.map((e) => (e.data as { relation: string }).relation)).toEqual(
      ['realization', 'aggregation', 'association'],
    );
    const output = serializeFrameToMermaid(native);
    expect(output).toContain('classDiagram');
    expect(output).toContain('..|>');
    const restored = await parseMermaidToFrameSnapshot(output, {
      scene: 'uml-class',
    });
    expect(restored).toEqual(native);
    expect(serializeFrameToMermaid(restored)).toBe(output);
  });
  it('round trips actor order, nested fragments, self calls, notes and explicit activations', async () => {
    const native = await parseMermaidToFrameSnapshot(sequence, {
      scene: 'uml-sequence',
    });
    const root = umlRoot(
      native.store,
      native.store.rootId,
    ) as NodeCell<UmlSequenceData>;
    expect(root.data!.participantIds).toHaveLength(2);
    expect(root.data!.events.map((e) => e.type)).toEqual([
      'cell',
      'activate',
      'cell',
      'cell',
      'deactivate',
    ]);
    expect(
      Object.values(native.store.cells).filter(
        (c) => c.kind === 'uml-fragment',
      ),
    ).toHaveLength(2);
    const output = serializeFrameToMermaid(native),
      restored = await parseMermaidToFrameSnapshot(output, {
        scene: 'uml-sequence',
      });
    expect(restored).toEqual(native);
    expect(serializeFrameToMermaid(restored)).toBe(output);
  });
  it('rejects unsupported semantic features and recovers the parser queue after failures', async () => {
    await expect(
      parseMermaidToFrameSnapshot(
        'classDiagram\nnamespace Domain {\nclass A\n}',
        { scene: 'uml-class' },
      ),
    ).rejects.toThrow('namespaces');
    await expect(
      parseMermaidToFrameSnapshot(
        'sequenceDiagram\nA->>B: hi\npar x\nA->>B: y\nend',
        { scene: 'uml-sequence' },
      ),
    ).rejects.toThrow('Unsupported');
    await expect(
      parseMermaidToFrameSnapshot('flowchart LR\nA-->B', {
        scene: 'uml-class',
      }),
    ).rejects.toThrow('Expected');
    const native = await parseMermaidToFrameSnapshot(sequence, {
      scene: 'uml-sequence',
    });
    expect(umlRoot(native.store, native.store.rootId)).toBeDefined();
    expect(document.querySelector('[id^="verd-mermaid-"]')).toBeNull();
  });
  it('keeps the existing whiteboard class import as ordinary editable geometry', async () => {
    const snapshot = await parseMermaidToFrameSnapshot('classDiagram\nclass A');
    expect(umlRoot(snapshot.store, snapshot.store.rootId)).toBeUndefined();
    expect(
      Object.values(snapshot.store.cells).some((c) => c.kind === 'geometry'),
    ).toBe(true);
  });
});

it('preserves literal quotes, semicolons, entity-like text and Unicode through UML export', async () => {
  const native = await parseMermaidToFrameSnapshot('classDiagram\nclass A', {
    scene: 'uml-class',
  });
  const classifier = Object.values(native.store.cells).find(
    (c) => c.kind === 'uml-class',
  ) as NodeCell<UmlClassData>;
  classifier.content = { label: 'Some "quoted" #59; 雪\\Path' };
  classifier.data!.attributes = ['#value: string; initialized'];
  const restored = await parseMermaidToFrameSnapshot(
    serializeFrameToMermaid(native),
    { scene: 'uml-class' },
  );
  expect((restored.store.cells[classifier.id] as NodeCell).content?.label).toBe(
    classifier.content.label,
  );
  expect(
    (restored.store.cells[classifier.id] as NodeCell<UmlClassData>).data!
      .attributes,
  ).toEqual(classifier.data!.attributes);
  const seq = await parseMermaidToFrameSnapshot(
    'sequenceDiagram\nA->>B: message',
    { scene: 'uml-sequence' },
  );
  const edge = Object.values(seq.store.cells).find(isEdgeCell)!;
  edge.labels = [{ text: 'value "quoted"; #59; 雪\nnext' }];
  const roundtrip = await parseMermaidToFrameSnapshot(
    serializeFrameToMermaid(seq),
    { scene: 'uml-sequence' },
  );
  expect((roundtrip.store.cells[edge.id] as typeof edge).labels).toEqual(
    edge.labels,
  );
});
