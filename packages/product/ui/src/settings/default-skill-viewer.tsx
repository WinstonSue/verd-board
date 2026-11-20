import { useEffect, useId, useRef, useState } from 'react';
import type { BoardTextDocument } from '@sue/board-common';
import { DocumentEditor } from '@sue/board-react-text';
import { ArrowLeft } from 'lucide-react';
import { WorkspaceButton } from '../shared/workspace-design';

export interface DefaultSkillContent {
  skills: {
    name: string;
    description: string;
    source: string;
    document: BoardTextDocument;
  }[];
  rules: { title: string; source?: string; document: BoardTextDocument }[];
}
const ignoreChange = () => {};

export function DefaultSkillViewer({
  value,
  zh,
  onClose,
  backLabel = zh ? '返回编辑' : 'Back to editor',
}: {
  value: DefaultSkillContent | string;
  zh: boolean;
  onClose(): void;
  backLabel?: string;
}) {
  const titleId = useId();
  const back = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(0);
  const [source, setSource] = useState(false);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  const items =
    typeof value === 'string'
      ? []
      : [
          ...value.skills.map((skill) => ({ title: skill.name, ...skill })),
          ...value.rules.map((rule) => ({
            ...rule,
            description: undefined,
          })),
        ];
  const item = items[selected];
  return (
    <section
      aria-labelledby={titleId}
      className="workspace-default-skill-viewer"
      data-testid="workspace-default-skill-viewer"
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <WorkspaceButton
        ref={back}
        type="button"
        intent="ghost"
        icon={<ArrowLeft size={16} aria-hidden />}
        data-testid="workspace-default-skill-back"
        onClick={onClose}
      >
        {backLabel}
      </WorkspaceButton>
      <h2 id={titleId} className="workspace-default-skill-heading">
        {zh ? '默认 Skill 与规则' : 'Default Skills and rules'}
      </h2>
      <p>
        {zh
          ? '供 AI 使用的内置编写规范，仅供查看。返回后可编辑当前工作区的补充要求。'
          : 'Built-in writing instructions for AI, shown read-only. Return to edit this workspace’s instructions.'}
      </p>
      <div
        className="workspace-default-skill-tabs"
        role="group"
        aria-label={zh ? '默认内容' : 'Default content'}
      >
        {items.map((entry, index) => (
          <WorkspaceButton
            key={entry.title}
            type="button"
            intent={selected === index ? 'primary' : 'ghost'}
            aria-pressed={selected === index}
            onClick={() => {
              setSelected(index);
              setSource(false);
            }}
          >
            {entry.title}
          </WorkspaceButton>
        ))}
      </div>
      {item?.description && <p>{item.description}</p>}
      {item?.source && (
        <WorkspaceButton
          type="button"
          intent="ghost"
          data-testid="workspace-default-skill-source"
          onClick={() => setSource(!source)}
        >
          {source
            ? zh
              ? '阅读文档'
              : 'Read document'
            : zh
              ? '查看 Markdown 源码'
              : 'View Markdown source'}
        </WorkspaceButton>
      )}
      <div
        className="workspace-default-skill-content"
        data-testid="workspace-skill-guide"
      >
        {typeof value === 'string' ? (
          <pre>{value}</pre>
        ) : source && item?.source ? (
          <pre>{item.source}</pre>
        ) : (
          item && (
            <DocumentEditor
              key={item.document.id}
              value={item.document}
              locale={zh ? 'zh' : 'en'}
              readonly
              {...{ autoFocus: false }}
              onChange={ignoreChange}
            />
          )
        )}
      </div>
    </section>
  );
}
