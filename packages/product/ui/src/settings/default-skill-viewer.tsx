import { useState } from 'react';
import type { BoardTextDocument } from '@sue/board-common';
import { DocumentEditor } from '@sue/board-react-text';
import { VmDialog } from '../shared/components/vm-dialog';
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
}: {
  value: DefaultSkillContent | string;
  zh: boolean;
  onClose(): void;
}) {
  const [selected, setSelected] = useState(0);
  const [source, setSource] = useState(false);
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
    <VmDialog
      title={zh ? '默认 Skill 与规则' : 'Default Skills and rules'}
      onClose={onClose}
      closeLabel={zh ? '关闭默认 Skill' : 'Close default Skills'}
      className="workspace-default-skill-dialog"
      data-testid="workspace-default-skill-viewer"
    >
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
    </VmDialog>
  );
}
