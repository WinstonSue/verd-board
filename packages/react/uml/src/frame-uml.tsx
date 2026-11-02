import {
  isEdgeCell,
  isNodeCell,
  type Cell,
  type CellOperation,
  type CellStore,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import {
  type FramePluginContext,
  FramePropertyGroup,
  FramePropertyContext,
  FrameSettingsText,
  FrameSettingsControl,
  mergeSettingsPatch,
} from '@sue/board-react';
import {
  sequenceEventLocations,
  umlEvents,
  umlRoot,
  type UmlClassData,
  type UmlFragmentData,
  type UmlMessageData,
  type UmlNoteData,
  type UmlRelationData,
  type UmlSequenceData,
} from '@sue/board-uml';
import { useId, useState } from 'react';
type Props = {
  store: CellStore;
  frameId: string;
  cell?: Cell;
  zh: boolean;
  disabled: boolean;
  dispatch(operations: CellOperation[]): unknown;
  executeAction: FramePluginContext['executeAction'];
  getStore?(): CellStore | undefined;
};
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
  return (
    <label>
      <span>{label}</span>
      <FrameSettingsText
        field={{
          key: label,
          label,
          commit: multiline ? 'blur' : 'enter-blur',
          props: { multiline, attributes: multiline ? { rows: 4 } : {} },
        }}
        value={value}
        onCommit={onCommit}
      />
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
      <FrameSettingsControl
        field={{
          key: label,
          editor: 'select',
          props: {
            id,
            children: items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            )),
          },
        }}
        value={value}
        onCommit={onChange}
      />
    </label>
  );
}
export function UmlPalette({
  store,
  frameId,
  zh,
  disabled,
  executeAction,
}: Props) {
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
          <button
            onClick={() => {
              void executeAction('uml.add-participant');
            }}
          >
            {zh ? '参与者' : 'Participant'}
          </button>
          <button
            onClick={() => {
              void executeAction('uml.add-actor');
            }}
          >
            Actor
          </button>
        </>
      ) : (
        <>
          {(['class', 'interface', 'abstract', 'enum'] as const).map(
            (kind, i) => (
              <button
                key={kind}
                onClick={() => {
                  void executeAction(`uml.add-${kind}`);
                }}
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
                onClick={() => {
                  void executeAction('uml.add-message', {
                    sourceId: from,
                    targetId: to,
                    operandId,
                  });
                }}
              >
                {zh ? '消息' : 'Message'}
              </button>
              <button
                onClick={() => {
                  void executeAction('uml.add-note', {
                    participantIds: [...new Set([from, to])],
                    operandId,
                  });
                }}
              >
                {zh ? '注释' : 'Note'}
              </button>
              <button
                onClick={() => {
                  void executeAction('uml.add-activation', {
                    participantId: from,
                    operandId,
                  });
                }}
              >
                {zh ? '激活区间' : 'Activation'}
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                void executeAction('uml.add-relation', {
                  sourceId: from,
                  targetId: to,
                });
              }}
            >
              {zh ? '关系' : 'Relation'}
            </button>
          )}
        </>
      )}
      {sequence &&
        (['alt', 'opt', 'loop'] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => {
              void executeAction(`uml.add-${kind}`, { operandId });
            }}
          >
            {kind}
          </button>
        ))}
    </fieldset>
  );
}
export function UmlProperties(props: Props) {
  const { store, frameId, cell, zh, disabled, getStore, executeAction } = props,
    root = umlRoot(store, frameId);
  if (!root) return null;
  const replace = (next: Cell) => {
    const latest = (getStore ? getStore() : store)?.cells[next.id];
    if (!disabled && latest)
      return executeAction('uml.update-properties', {
        operations: [
          {
            type: 'replace_cell',
            cell: mergeSettingsPatch(
              store.cells[next.id] ?? latest,
              next,
              latest,
            ),
          },
        ],
      });
    return undefined;
  };
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
    <FramePropertyContext.Provider
      value={{ identity: JSON.stringify([frameId, cell?.id]), disabled }}
    >
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
                  <FrameSettingsControl
                    field={{
                      key: 'frame-uml.0',
                      editor: 'input',
                      props: { type: 'checkbox' },
                    }}
                    value={
                      !!(cell as EdgeCell<UmlRelationData>).data!.navigable
                    }
                    onCommit={(value) => update({ navigable: value })}
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
                  (cell as EdgeCell<UmlRelationData>).data!
                    .sourceMultiplicity ?? ''
                }
                onCommit={(sourceMultiplicity) =>
                  update({ sourceMultiplicity })
                }
              />
              <Draft
                label={zh ? '目标多重性' : 'Target multiplicity'}
                value={
                  (cell as EdgeCell<UmlRelationData>).data!
                    .targetMultiplicity ?? ''
                }
                onCommit={(targetMultiplicity) =>
                  update({ targetMultiplicity })
                }
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
                value={
                  (cell as NodeCell<{ actorType: string }>).data!.actorType
                }
                items={[
                  { id: 'participant', label: zh ? '参与者' : 'Participant' },
                  { id: 'actor', label: 'Actor' },
                ]}
                onChange={(actorType) => update({ actorType })}
              />
              <button
                onClick={() => {
                  void executeAction('uml.participant-left');
                }}
              >
                {zh ? '向左' : 'Move left'}
              </button>
              <button
                onClick={() => {
                  void executeAction('uml.participant-right');
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
                    (cell as NodeCell<UmlNoteData>).data!.participantIds[at] ??
                    ''
                  }
                  items={[
                    { id: '', label: zh ? '无' : 'None' },
                    ...participants,
                  ]}
                  onChange={(id) => {
                    const ids = [
                      ...(cell as NodeCell<UmlNoteData>).data!.participantIds,
                    ];
                    ids[at] = id;
                    update({
                      participantIds: [...new Set(ids.filter(Boolean))],
                    });
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
                          void executeAction('uml.delete-branch', {
                            cellId: cell.id,
                            operandId: operand.id,
                          });
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
                  onClick={() => {
                    void executeAction('uml.add-branch');
                  }}
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
                onChange={(operandId) => {
                  void executeAction('uml.move-event-to-branch', {
                    cellId: cell.id,
                    operandId: operandId || undefined,
                  });
                }}
              />
              <button
                onClick={() => {
                  void executeAction('uml.event-earlier');
                }}
              >
                {zh ? '前移' : 'Move earlier'}
              </button>
              <button
                onClick={() => {
                  void executeAction('uml.event-later');
                }}
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
    </FramePropertyContext.Provider>
  );
}
function ActivationProperties({
  store,
  frameId,
  participantId,
  zh,
  dispatch,
  executeAction,
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
    void executeAction('uml.update-properties', {
      operations: [{ type: 'replace_cell', cell: { ...owner, data } }],
    });
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
          <button
            onClick={() => {
              void executeAction('uml.remove-activation', {
                ownerId: interval.owner.id,
                branch: interval.branch,
                activationId: interval.id,
              });
            }}
          >
            {zh ? '删除激活' : 'Remove activation'}
          </button>
        </div>
      ))}
    </>
  );
}
