import {
  createContext,
  useContext,
  type ComponentProps,
  type CSSProperties,
} from 'react';
import {
  readableThemeText,
  resolveBoardTheme,
  type ResolvedBoardTheme,
} from '@sue/board-core';

const legacyTheme = resolveBoardTheme();
export const FrameThemeContext = createContext<ResolvedBoardTheme>(legacyTheme);
export const useFrameTheme = () => useContext(FrameThemeContext);
export const useFrameAppearance = () => {
  const theme = useFrameTheme();
  return theme.adaptive ? theme.appearance : undefined;
};

/** The scope travels with each SVG frame and its foreignObject document editors. */
export function frameThemeStyle(theme: ResolvedBoardTheme): CSSProperties {
  if (!theme.adaptive)
    return { '--board-unmarked-text-color': 'initial' } as CSSProperties;
  return {
    colorScheme: theme.appearance,
    accentColor: theme.accent,
    color: theme.text,
    '--board-unmarked-text-color': 'currentColor',
    '--board-bg': theme.surface,
    '--board-surface': theme.surface,
    '--board-text': theme.text,
    '--board-text-secondary': theme.secondaryText,
    '--board-text-placeholder': theme.secondaryText,
    '--board-border': theme.stroke,
    '--board-hover': theme.header,
    '--board-active': theme.header,
    '--board-primary': theme.accent,
    '--board-title-color': readableThemeText(theme.header, theme.text),
    '--board-title-active-color': readableThemeText(theme.header, theme.accent),
    '--board-danger': theme.appearance === 'dark' ? '#fda4af' : '#b91c1c',
    '--board-danger-bg': theme.appearance === 'dark' ? '#3b202d' : '#fef2f2',
    '--board-code-bg': theme.header,
    '--board-table-head': theme.header,
    '--vm-background': theme.surface,
    '--vm-background-subtle': theme.background,
    '--vm-foreground': theme.text,
    '--vm-foreground-secondary': theme.secondaryText,
    '--vm-border': theme.stroke,
    '--vm-border-strong': theme.stroke,
    '--vm-fill-hover': theme.header,
    '--vm-fill-active': theme.header,
    '--vm-primary': theme.accent,
  } as CSSProperties;
}

/** Compose the theme scope without adding a DOM wrapper to the SVG scene. */
export function FrameThemeGroup({
  theme,
  style,
  ...props
}: ComponentProps<'g'> & { theme: ResolvedBoardTheme }) {
  return (
    <FrameThemeContext.Provider value={theme}>
      <g {...props} style={{ ...frameThemeStyle(theme), ...style }} />
    </FrameThemeContext.Provider>
  );
}
