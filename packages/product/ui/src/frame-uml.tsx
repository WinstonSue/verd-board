import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  isEdgeCell,
  isNodeCell,
  umlRoot,
  umlEvents,
  type Cell,
  type CellStore,
  type CellOperation,
  type NodeCell,
  type EdgeCell,
  type UmlClassData,
  type UmlSequenceData,
  type UmlFragmentData,
  type UmlNoteData,
  type UmlMessageData,
  type UmlRelationData,
  type UmlEvent,
  type UmlClassifier,
  type UmlRelation,
} from '@sue/board-core';
import {
  addUmlCell,
  addUmlActivation,
  createUmlClassCell,
  createUmlParticipantCell,
  createUmlRelationCell,
  createUmlMessageCell,
  createUmlNoteCell,
  createUmlFragmentCell,
  moveUmlEvent,
  reorderUmlParticipant,
  sequenceEventLocations,
} from '@sue/board-uml';
import { FramePropertyGroup } from './frame-property-panel';
type Props = {
  store: CellStore;
  frameId: string;
  cell?: Cell;
  zh: boolean;
  disabled: boolean;
  dispatch(operations: CellOperation[]): unknown;
};
const uid = () => crypto.randomUUID();
function Draft({
  value,
  onCommit,
  label,
  multiline = false,
}: {
  value: string;
  onCommit(value: string): void;
  label: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const canceled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const props = {
    'aria-label': label,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      if (!canceled.current && draft !== value) onCommit(draft);
      canceled.current = false;
    },
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (e.key === 'Escape') {
        canceled.current = true;
        setDraft(value);
        e.currentTarget.blur();
      }
      if (e.key === 'Enter' && !multiline) e.currentTarget.blur();
    },
  };
  return (
    <label>
      <span>{label}</span>
      {multiline ? <textarea {...props} rows={4} /> : <input {...props} />}
    </label>
  );
}
function Choice({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  items: { id: string; label: string }[];
}) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function UmlPalette({ store, frameId, zh, disabled, dispatch }: Props) {
  const root = umlRoot(store, frameId),
    sequence = root?.kind === 'uml-sequence-root';
  const cells = Object.values(store.cells).filter(
    (cell) =>
      cell.kind === (sequence ? 'uml-participant' : 'uml-class') &&
      (
        store.cells[frameId] as import('@sue/board-core').FrameCell
      ).children.includes(cell.id),
  );
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [branch, setBranch] = useState('');
  const frame = store.cells[frameId] as import('@sue/board-core').FrameCell;
  const operands = frame.children
    .map((id) => store.cells[id])
    .filter((cell) => cell.kind === 'uml-fragment')
    .flatMap((cell) =>
      (cell as NodeCell<UmlFragmentData>).data!.operands.map((operand) => ({
        ...operand,
        label: `${(cell as NodeCell<UmlFragmentData>).data!.operator}: ${operand.guard}`,
      })),
    );
  const operandId = operands.some((operand) => operand.id === branch)
    ? branch
    : undefined;
  const from = cells.some((c) => c.id === source)
      ? source
      : (cells[0]?.id ?? ''),
    to = cells.some((c) => c.id === target) ? target : (cells.at(-1)?.id ?? '');
  const add = (cell: Cell) => {
    if (cell.kind === 'uml-class' && isNodeCell(cell))
      cell.geometry = {
        ...cell.geometry,
        x: 60 + (cells.length % 3) * 260,
        y: 80 + Math.floor(cells.length / 3) * 200,
      };
    dispatch(addUmlCell(store, frameId, cell, operandId));
  };
  const names = cells.map((cell) => ({
    id: cell.id,
    label: (cell as NodeCell).content?.label ?? cell.id,
  }));
  return (
    <fieldset
      disabled={disabled}
      className="frame-uml-tools"
      aria-label={zh ? 'UML 工具' : 'UML tools'}
    >
      {sequence ? (
        <>
          <button onClick={() => add(createUmlParticipantCell(uid()))}>
            {zh ? '参与者' : 'Participant'}
          </button>
          <button onClick={() => add(createUmlParticipantCell(uid(), 'actor'))}>
            Actor
          </button>
        </>
      ) : (
        <>
          {(['class', 'interface', 'abstract', 'enum'] as const).map(
            (kind, i) => (
              <button
                key={kind}
                onClick={() => add(createUmlClassCell(uid(), kind))}
              >
                {zh ? ['类', '接口', '抽象类', '枚举'][i] : kind}
              </button>
            ),
          )}
        </>
      )}
      {sequence && operands.length > 0 && (
        <Choice
          label={zh ? '插入分支' : 'Insert into branch'}
          value={operandId ?? ''}
          onChange={setBranch}
          items={[{ id: '', label: zh ? '顶层' : 'Top level' }, ...operands]}
        />
      )}
      {cells.length > 0 && (
        <>
          <Choice
            label={zh ? '发送方 / 来源' : 'Source'}
            value={from}
            onChange={setSource}
            items={names}
          />
          <Choice
            label={zh ? '接收方 / 目标' : 'Target'}
            value={to}
            onChange={setTarget}
            items={names}
          />
          {sequence ? (
            <>
              <button
                onClick={() => add(createUmlMessageCell(uid(), from, to))}
              >
                {zh ? '消息' : 'Message'}
              </button>
              <button
                onClick={() =>
                  add(createUmlNoteCell(uid(), [...new Set([from, to])]))
                }
              >
                {zh ? '注释' : 'Note'}
              </button>
              <button
                onClick={() => {
                  const data = root!.data as UmlSequenceData;
                  dispatch(
                    addUmlActivation(
                      store,
                      frameId,
                      from,
                      0,
                      operandId
                        ? operands.find((operand) => operand.id === operandId)!
                            .events.length
                        : data.events.length,
                      uid,
                      operandId,
                    ),
                  );
                }}
              >
                {zh ? '激活区间' : 'Activation'}
              </button>
            </>
          ) : (
            <button onClick={() => add(createUmlRelationCell(uid(), from, to))}>
              {zh ? '关系' : 'Relation'}
            </button>
          )}
        </>
      )}
      {sequence &&
        (['alt', 'opt', 'loop'] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => add(createUmlFragmentCell(uid(), kind))}
          >
            {kind}
          </button>
        ))}
    </fieldset>
  );
}
export function UmlProperties(props: Props) {
  const { store, frameId, cell, zh, disabled, dispatch } = props,
    root = umlRoot(store, frameId);
  if (!root) return null;
  const replace = (next: Cell) =>
    !disabled && dispatch([{ type: 'replace_cell', cell: next }]);
  const update = (data: object) => {
    if (cell && (isNodeCell(cell) || isEdgeCell(cell)))
      replace({
        ...cell,
        data: { ...((cell as NodeCell).data as object), ...data },
      });
  };
  const members = (
    store.cells[frameId] as import('@sue/board-core').FrameCell
  ).children
    .map((id) => store.cells[id])
    .filter(isNodeCell);
  const participants = members
    .filter((c) => c.kind === 'uml-participant')
    .map((c) => ({ id: c.id, label: c.content?.label ?? c.id }));
  const sequence = root.kind === 'uml-sequence-root';
  const locations = sequence ? sequenceEventLocations(store, frameId) : [];
  const location = cell
    ? locations.find((item) => item.cellId === cell.id)
    : undefined;
  const branches = members
    .filter((c) => c.kind === 'uml-fragment' && c.id !== cell?.id)
    .flatMap((c) =>
      (c.data as UmlFragmentData).operands.map((o) => ({
        id: o.id,
        label: `${(c.data as UmlFragmentData).operator}: ${o.guard}`,
      })),
    );
  const data = (cell as NodeCell<UmlClassData> | undefined)?.data;
  return (
    <FramePropertyGroup id="uml" title={zh ? 'UML 设置' : 'UML settings'}>
      <fieldset disabled={disabled}>
        {cell?.kind === 'uml-class' && data && (
          <>
            <Choice
              label={zh ? '分类器' : 'Classifier'}
              value={data.classifier}
              items={['class', 'interface', 'abstract', 'enum'].map(
                (id, i) => ({
                  id,
                  label: zh ? ['类', '接口', '抽象类', '枚举'][i] : id,
                }),
              )}
              onChange={(classifier) => update({ classifier })}
            />
            <Draft
              label={zh ? '属性（每行一项）' : 'Attributes (one per line)'}
              value={data.attributes.join('\n')}
              multiline
              onCommit={(text) =>
                update({ attributes: text ? text.split('\n') : [] })
              }
            />
            <Draft
              label={zh ? '方法（每行一项）' : 'Methods (one per line)'}
              value={data.methods.join('\n')}
              multiline
              onCommit={(text) =>
                update({ methods: text ? text.split('\n') : [] })
              }
            />
          </>
        )}
        {cell?.kind === 'uml-relation' && (
          <>
            {(cell as EdgeCell<UmlRelationData>).data!.relation ===
              'association' && (
              <label>
                <input
                  type="checkbox"
                  checked={
                    !!(cell as EdgeCell<UmlRelationData>).data!.navigable
                  }
                  onChange={(event) =>
                    update({ navigable: event.target.checked })
                  }
                />
                {zh ? '可导航' : 'Navigable'}
              </label>
            )}
            <Choice
              label={zh ? '关系类型' : 'Relation type'}
              value={(cell as EdgeCell<UmlRelationData>).data!.relation}
              items={[
                'association',
                'dependency',
                'generalization',
                'realization',
                'aggregation',
                'composition',
              ].map((id, i) => ({
                id,
                label: zh
                  ? ['关联', '依赖', '泛化', '实现', '聚合', '组合'][i]
                  : id,
              }))}
              onChange={(relation) => update({ relation })}
            />
            <Draft
              label={zh ? '来源多重性' : 'Source multiplicity'}
              value={
                (cell as EdgeCell<UmlRelationData>).data!.sourceMultiplicity ??
                ''
              }
              onCommit={(sourceMultiplicity) => update({ sourceMultiplicity })}
            />
            <Draft
              label={zh ? '目标多重性' : 'Target multiplicity'}
              value={
                (cell as EdgeCell<UmlRelationData>).data!.targetMultiplicity ??
                ''
              }
              onCommit={(targetMultiplicity) => update({ targetMultiplicity })}
            />
          </>
        )}
        {cell?.kind === 'uml-message' && isEdgeCell(cell) && (
          <>
            <Choice
              label={zh ? '发送者' : 'Sender'}
              value={'cellId' in cell.source ? cell.source.cellId : ''}
              items={participants}
              onChange={(cellId) => replace({ ...cell, source: { cellId } })}
            />
            <Choice
              label={zh ? '接收者' : 'Receiver'}
              value={'cellId' in cell.target ? cell.target.cellId : ''}
              items={participants}
              onChange={(cellId) => replace({ ...cell, target: { cellId } })}
            />
            <Choice
              label={zh ? '消息类型' : 'Message type'}
              value={(cell.data as UmlMessageData).messageKind}
              items={['sync', 'async', 'return'].map((id, i) => ({
                id,
                label: zh ? ['同步', '异步', '返回'][i] : id,
              }))}
              onChange={(messageKind) => update({ messageKind })}
            />
          </>
        )}
        {cell?.kind === 'uml-participant' && (
          <>
            <Choice
              label={zh ? '参与者类型' : 'Participant type'}
              value={(cell as NodeCell<{ actorType: string }>).data!.actorType}
              items={[
                { id: 'participant', label: zh ? '参与者' : 'Participant' },
                { id: 'actor', label: 'Actor' },
              ]}
              onChange={(actorType) => update({ actorType })}
            />
            <button
              onClick={() => {
                const ids = (root.data as UmlSequenceData).participantIds;
                dispatch(
                  reorderUmlParticipant(
                    store,
                    frameId,
                    cell.id,
                    Math.max(0, ids.indexOf(cell.id) - 1),
                  ),
                );
              }}
            >
              {zh ? '向左' : 'Move left'}
            </button>
            <button
              onClick={() => {
                const ids = (root.data as UmlSequenceData).participantIds;
                dispatch(
                  reorderUmlParticipant(
                    store,
                    frameId,
                    cell.id,
                    ids.indexOf(cell.id) + 1,
                  ),
                );
              }}
            >
              {zh ? '向右' : 'Move right'}
            </button>
            <ActivationProperties {...props} participantId={cell.id} />
          </>
        )}
        {cell?.kind === 'uml-note' && (
          <>
            <Choice
              label={zh ? '注释位置' : 'Note position'}
              value={(cell as NodeCell<UmlNoteData>).data!.position}
              items={['left', 'right', 'over'].map((id, i) => ({
                id,
                label: zh ? ['左侧', '右侧', '上方'][i] : id,
              }))}
              onChange={(position) =>
                update({
                  position,
                  ...(position !== 'over'
                    ? {
                        participantIds: (
                          cell as NodeCell<UmlNoteData>
                        ).data!.participantIds.slice(0, 1),
                      }
                    : {}),
                })
              }
            />
            {[0, 1].map((at) => (
              <Choice
                key={at}
                label={zh ? `关联参与者 ${at + 1}` : `Participant ${at + 1}`}
                value={
                  (cell as NodeCell<UmlNoteData>).data!.participantIds[at] ?? ''
                }
                items={[{ id: '', label: zh ? '无' : 'None' }, ...participants]}
                onChange={(id) => {
                  const ids = [
                    ...(cell as NodeCell<UmlNoteData>).data!.participantIds,
                  ];
                  ids[at] = id;
                  update({ participantIds: [...new Set(ids.filter(Boolean))] });
                }}
              />
            ))}
          </>
        )}
        {cell?.kind === 'uml-fragment' && (
          <>
            {(cell as NodeCell<UmlFragmentData>).data!.operands.map(
              (operand, i) => (
                <div key={operand.id}>
                  <Draft
                    label={
                      zh ? `分支 ${i + 1} 条件` : `Branch ${i + 1} condition`
                    }
                    value={operand.guard}
                    onCommit={(guard) =>
                      update({
                        operands: (
                          cell as NodeCell<UmlFragmentData>
                        ).data!.operands.map((o) =>
                          o.id === operand.id ? { ...o, guard } : o,
                        ),
                      })
                    }
                  />
                  {(cell as NodeCell<UmlFragmentData>).data!.operator ===
                    'alt' && (
                    <button
                      disabled={
                        (cell as NodeCell<UmlFragmentData>).data!.operands
                          .length <= 1
                      }
                      onClick={() => {
                        const removed = operand.events
                          .filter((e) => e.type === 'cell')
                          .map((e) => (e as { cellId: string }).cellId);
                        dispatch([
                          {
                            type: 'replace_cell',
                            cell: {
                              ...cell,
                              data: {
                                ...(cell as NodeCell<UmlFragmentData>).data!,
                                operands: (
                                  cell as NodeCell<UmlFragmentData>
                                ).data!.operands.filter(
                                  (o) => o.id !== operand.id,
                                ),
                              },
                            },
                          },
                          ...removed.map((cellId) => ({
                            type: 'remove_cell' as const,
                            cellId,
                          })),
                        ]);
                      }}
                    >
                      {zh ? '删除分支' : 'Delete branch'}
                    </button>
                  )}
                </div>
              ),
            )}
            {(cell as NodeCell<UmlFragmentData>).data!.operator === 'alt' && (
              <button
                onClick={() =>
                  update({
                    operands: [
                      ...(cell as NodeCell<UmlFragmentData>).data!.operands,
                      { id: uid(), guard: 'else', events: [] },
                    ],
                  })
                }
              >
                {zh ? '添加分支' : 'Add branch'}
              </button>
            )}
          </>
        )}
        {cell && location && (
          <>
            <Choice
              label={zh ? '所在分支' : 'Containing branch'}
              value={location.operandId ?? ''}
              items={[
                { id: '', label: zh ? '顶层' : 'Top level' },
                ...branches,
              ]}
              onChange={(operandId) =>
                dispatch(
                  moveUmlEvent(store, frameId, cell.id, operandId || undefined),
                )
              }
            />
            <button
              onClick={() =>
                dispatch(
                  moveUmlEvent(
                    store,
                    frameId,
                    cell.id,
                    location.operandId,
                    Math.max(0, location.at - 1),
                  ),
                )
              }
            >
              {zh ? '前移' : 'Move earlier'}
            </button>
            <button
              onClick={() =>
                dispatch(
                  moveUmlEvent(
                    store,
                    frameId,
                    cell.id,
                    location.operandId,
                    location.at + 1,
                  ),
                )
              }
            >
              {zh ? '后移' : 'Move later'}
            </button>
          </>
        )}
        {cell && isEdgeCell(cell) && (
          <Draft
            label={zh ? '关系 / 消息名称' : 'Relation / message label'}
            value={cell.labels?.[0]?.text ?? ''}
            onCommit={(text) => replace({ ...cell, labels: [{ text }] })}
          />
        )}
        {!cell && (
          <p>
            {zh
              ? '选择对象编辑 UML 属性；从左侧工具添加元素。'
              : 'Select an object to edit UML properties. Add elements using the tools.'}
          </p>
        )}
      </fieldset>
    </FramePropertyGroup>
  );
}
function ActivationProperties({
  store,
  frameId,
  participantId,
  zh,
  dispatch,
}: Props & { participantId: string }) {
  const owners = Object.values(store.cells).filter(
    (cell) => cell.kind === 'uml-sequence-root' || cell.kind === 'uml-fragment',
  );
  const intervals: {
    owner: Cell;
    branch: number;
    start: number;
    end: number;
    id: string;
  }[] = [];
  for (const owner of owners)
    umlEvents(owner).forEach((events, branch) => {
      const stack: number[] = [];
      events.forEach((event, index) => {
        if (event.type === 'cell' || event.participantId !== participantId)
          return;
        if (event.type === 'activate') stack.push(index);
        else {
          const start = stack.pop();
          if (start !== undefined)
            intervals.push({
              owner,
              branch,
              start,
              end: index,
              id: (events[start] as { id: string }).id,
            });
        }
      });
    });
  const commit = (
    interval: (typeof intervals)[number],
    start: number,
    end: number,
    remove = false,
  ) => {
    const lists = umlEvents(interval.owner),
      events = [...lists[interval.branch]],
      a = events[interval.start],
      b = events[interval.end];
    const rest = events.filter(
      (_, i) => i !== interval.start && i !== interval.end,
    );
    if (!remove) {
      rest.splice(Math.max(0, Math.min(end, rest.length)), 0, b);
      rest.splice(Math.max(0, Math.min(start, rest.length)), 0, a);
    }
    const owner = interval.owner as NodeCell;
    const data =
      owner.kind === 'uml-sequence-root'
        ? { ...(owner.data as UmlSequenceData), events: rest }
        : {
            ...(owner.data as UmlFragmentData),
            operands: (owner.data as UmlFragmentData).operands.map((o, i) =>
              i === interval.branch ? { ...o, events: rest } : o,
            ),
          };
    dispatch([{ type: 'replace_cell', cell: { ...owner, data } }]);
  };
  return (
    <>
      {intervals.map((interval) => (
        <div key={interval.id}>
          <Draft
            label={zh ? '激活开始步骤' : 'Activation start step'}
            value={String(interval.start)}
            onCommit={(text) => {
              const n = Number(text);
              if (Number.isInteger(n) && n >= 0)
                commit(interval, n, Math.max(n, interval.end - 1));
            }}
          />
          <Draft
            label={zh ? '激活结束步骤' : 'Activation end step'}
            value={String(interval.end - 1)}
            onCommit={(text) => {
              const n = Number(text);
              if (Number.isInteger(n) && n >= interval.start)
                commit(interval, interval.start, n);
            }}
          />
          <button onClick={() => commit(interval, 0, 0, true)}>
            {zh ? '删除激活' : 'Remove activation'}
          </button>
        </div>
      ))}
    </>
  );
}
