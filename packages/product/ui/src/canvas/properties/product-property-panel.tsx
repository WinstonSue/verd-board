import {
  FramePropertyPanel,
  FrameSettingsComponentsProvider,
} from '@sue/board-react';
import type { ComponentProps } from 'react';
import {
  SettingsSelectEditor,
  SettingsSelectScope,
} from '../../shared/settings-select';

/** Only the product inspector opts into design-library selects. */
export function ProductPropertyPanel({
  active,
  ...props
}: ComponentProps<typeof FramePropertyPanel> & { active: boolean }) {
  return (
    <SettingsSelectScope
      active={active && props.open}
      identity={props.identity}
    >
      <FrameSettingsComponentsProvider
        components={{ select: SettingsSelectEditor }}
      >
        <FramePropertyPanel {...props} />
      </FrameSettingsComponentsProvider>
    </SettingsSelectScope>
  );
}
