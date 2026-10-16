import type { ReactNode } from 'react';
import { I18nProvider, useI18n } from '../i18n';
import './workspace-switcher.scss';

/** Editor type a frame file opens in. Real workspaces use a separate identity type. */
export type EditorKind = 'board' | 'mind' | 'workflow' | 'architecture';
/** @deprecated Use EditorKind; kept as a public compatibility alias. */
export type WorkspaceId = EditorKind;
export type WorkflowGraphModeOption = 'dag' | 'process';

export const ExclusiveEditorBar = ({
  editor,
  onBack,
  actions,
}: {
  editor: Exclude<EditorKind, 'board'>;
  onBack: () => void;
  actions?: ReactNode;
}) => {
  const { t } = useI18n();
  return (
    <div className="exclusive-editor-bar" data-testid="exclusive-editor-bar">
      <button
        type="button"
        data-testid="workspace-back"
        className="exclusive-editor-bar__back"
        onClick={onBack}
      >
        {t('workspace.back')}
      </button>
      <span
        className="exclusive-editor-bar__title"
        data-testid="exclusive-editor-title"
      >
        {editor === 'mind'
          ? t('workspace.mind')
          : editor === 'architecture'
            ? t('workspace.architecture')
            : t('workspace.workflow')}
      </span>
      {actions ? (
        <div className="exclusive-editor-bar__actions">{actions}</div>
      ) : null}
    </div>
  );
};

export const WorkflowGraphModeSelect = ({
  value,
  onChange,
}: {
  value: WorkflowGraphModeOption;
  onChange: (value: WorkflowGraphModeOption) => void;
}) => {
  const { t } = useI18n();
  return (
    <label className="workflow-graph-mode">
      {t('workflow.mode.label')}
      <select
        data-testid="workflow-graph-mode"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as WorkflowGraphModeOption)
        }
      >
        <option value="dag">{t('workflow.mode.dag')}</option>
        <option value="process">{t('workflow.mode.process')}</option>
      </select>
    </label>
  );
};

export const ProductShell = ({
  workspace,
  onBack,
  actions,
  children,
}: {
  workspace: EditorKind;
  onBack?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <I18nProvider>
    <div className="verd-product-shell">
      {workspace !== 'board' && onBack ? (
        <ExclusiveEditorBar
          editor={workspace}
          onBack={onBack}
          actions={actions}
        />
      ) : null}
      <div className="verd-product-shell__body">{children}</div>
    </div>
  </I18nProvider>
);
