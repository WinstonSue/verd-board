import { useState } from 'react';
import { SettingsCenter } from './settings-center';
import type { WorkspaceSettingsProps } from './workspace-settings-content';
export type {
  WorkspaceSettingsProps,
  WorkspaceSettingsConfig,
  WorkspaceSettingsPatch,
} from './workspace-settings-content';
export function WorkspaceSettings(props: WorkspaceSettingsProps) {
  const [section, setSection] = useState(
    props.initialSection === 'trash' ? 'workspace.trash' : 'workspace.project',
  );
  return (
    <SettingsCenter
      workspace={props}
      section={section}
      onSection={setSection}
      onBack={props.onBack}
      testId="workspace-settings-page"
      backTestId="workspace-settings-back"
    />
  );
}
