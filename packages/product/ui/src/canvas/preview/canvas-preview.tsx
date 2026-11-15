import {
  FrameCanvasPreview,
  useFrameAppearance,
  type FrameCanvasPreviewProps,
} from '@sue/board-react';
import { useMemo } from 'react';
import { useAppearancePreference } from '../../shared/preferences/appearance-preferences';
import { createVerdFramePluginSet } from '../frame-plugins';
/** Product defaults for the shared read-only preview runtime. */
export function CanvasPreview(
  props: Omit<FrameCanvasPreviewProps, 'pluginSet' | 'appearance'>,
) {
  const inheritedAppearance = useFrameAppearance();
  const { appearance } = useAppearancePreference();
  const pluginSet = useMemo(() => createVerdFramePluginSet(), []);
  return (
    <FrameCanvasPreview
      {...props}
      pluginSet={pluginSet}
      appearance={inheritedAppearance ?? appearance}
    />
  );
}
