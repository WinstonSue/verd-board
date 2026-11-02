import { useState } from 'react';
import { SettingsCenter } from './settings-center';
export interface MyPageProps {
  onBack(): void;
  backLabel?: string;
}
export function MyPage({ onBack, backLabel }: MyPageProps) {
  const [section, setSection] = useState('personal.general');
  return (
    <SettingsCenter
      section={section}
      onSection={setSection}
      onBack={onBack}
      backLabel={backLabel}
      testId="my-page"
      backTestId="my-back"
    />
  );
}
