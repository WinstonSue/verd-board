import { useState } from 'react';
import { SettingsCenter } from './settings-center';
export {
  FrameSettingsContent,
  useApplicationSettingsModel,
} from './application-settings';
export function FrameSettingsPage({
  onBack,
  backLabel,
}: {
  onBack(): void;
  backLabel?: string;
}) {
  const [section, setSection] = useState('personal.general');
  return (
    <SettingsCenter
      section={section}
      onSection={setSection}
      onBack={onBack}
      backLabel={backLabel}
      testId="settings-page"
      backTestId="settings-back"
    />
  );
}
