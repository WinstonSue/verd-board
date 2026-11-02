import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Tone = { fill: string; strokeColor: string; textColor: string };
let values: Promise<Record<string, Tone>> | undefined;

/** Load the source palette once; this also works against a production browser build. */
export async function roleTone(
  _page: Page,
  themeId: string,
  appearance: 'light' | 'dark',
  role: string | number = 'primary',
  level: string = 'normal',
): Promise<Tone> {
  values ??= (async () => {
    // Keep the repository's ESM validation runtime out of Playwright's CommonJS transform.
    const nativeImport = new Function('url', 'return import(url)') as (
      url: string,
    ) => Promise<any>;
    const { withWorkspaceRuntime } = await nativeImport(
      pathToFileURL(path.resolve(__dirname, '../../../scripts/workspace.mjs'))
        .href,
    );
    return withWorkspaceRuntime(({ core }: any) => {
      const tones: Record<string, Tone> = {};
      for (const id of Object.values(core.ThemeColorMode))
        for (const mode of ['light', 'dark']) {
          const theme = core.resolveBoardTheme({ themeColorMode: id }, mode);
          for (const key of [
            'neutral',
            'primary',
            'secondary',
            'tertiary',
            'annotation',
            0,
            1,
            2,
            3,
            4,
            5,
          ])
            for (const emphasis of ['subtle', 'normal', 'strong'])
              tones[`${id}/${mode}/${key}/${emphasis}`] =
                typeof key === 'number'
                  ? core.resolveThemeSeries(theme, key, emphasis)
                  : core.resolveThemeRole(theme, key, emphasis);
        }
      return tones;
    });
  })();
  return (await values!)[`${themeId}/${appearance}/${role}/${level}`];
}
