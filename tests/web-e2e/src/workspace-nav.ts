import { serviceFixture } from './service-fixture';
import { expect, type Page } from '@playwright/test';
import type { WorkspaceSessionState } from '../../../packages/product/app/src/host/workspace-host';

/**
 * Detail canvases open as workspace tabs (frameId is the tab identity), and
 * open canvases stay mounted so per-tab view state survives. Going "back"
 * activates the tab immediately before the active one; hidden tabs never
 * match `:visible`.
 */
export const backToPreviousCanvas = async (page: Page) => {
  const tabs = page.getByRole('tab');
  const active = await tabs.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.getAttribute('aria-selected') === 'true'),
  );
  const target = tabs.nth(Math.max(0, active - 1));
  await target.click({ position: { x: 8, y: 8 } });
  // The pane swap lands on the same render pass that flips aria-selected;
  // waiting here keeps callers from clicking inside a half-hidden pane.
  await expect(target).toHaveAttribute('aria-selected', 'true');
};

/**
 * Reloads restore the session's last-active tab, which is a detail view after
 * `frame-open`; tests that then operate on the board must switch back to the
 * first (board) tab.
 */
export const activateBoardTab = async (page: Page) => {
  const first = page.getByRole('tab').first();
  await first.click({ position: { x: 8, y: 8 } });
  await expect(first).toHaveAttribute('aria-selected', 'true');
};

/**
 * The workspace host persists each canvas as a `.verd.json` file inside
 * `verdboard-host` (files store, default workspace). This reader presents the
 * same shape the legacy `verdboard_store` manifest used: `rootId` resolves to
 * the top-level file — one no other file's frame-reference targets — matching
 * the legacy root-frame semantics rather than the active tab. `records` holds
 * each file's FrameFileV2 `{frame, cells}` keyed by frameId.
 */
export const persistedWorkspace = async (page: Page) => {
  const { nodes, meta } = await serviceFixture(page).readDisk();
  const records: Record<string, any> = {};
  const paths: Record<string, string> = {};
  for (const node of nodes) {
    if (node.kind !== 'file' || !node.path.endsWith('.verd.json')) continue;
    const parsed = JSON.parse(node.text);
    if (parsed?.format === 'verd-frame') {
      records[parsed.frame.id] = parsed;
      paths[parsed.frame.id] = node.path;
    }
  }
  const ids = Object.keys(records);
  if (!ids.length) return null;
  const referenced = new Set<string>();
  for (const record of Object.values(records))
    for (const cell of Object.values<any>(record.cells))
      if (cell.data?.targetFrameId) referenced.add(cell.data.targetFrameId);
  const detached = ids.filter((id) => !referenced.has(id));
  const session = (
    meta as
      | {
          session?: { activeTabId?: string; tabs?: { fileId: string }[] };
        }
      | undefined
  )?.session;
  const active = session?.activeTabId;
  const rootId =
    (active && detached.includes(active) && active) ||
    detached.sort()[0] ||
    ids.sort()[0];
  const manifest = {
    format: 'verd-workspace',
    rootId,
    frames: Object.fromEntries(ids.map((id) => [id, id])),
    detachedFrameIds: ids.filter((id) => id !== rootId && !referenced.has(id)),
  };
  return {
    manifest,
    records,
    paths,
    tabs: session?.tabs?.map(({ fileId }) => fileId) ?? [],
  };
};

/** Waits until the app has finished its initial workspace save. */
export const waitForWorkspacePersisted = async (page: Page) =>
  await expect.poll(() => persistedWorkspace(page)).not.toBeNull();

/** Navigation has its own debounce; content's saved badge can precede it. */
export const persistedNavigation = async (page: Page) =>
  (await serviceFixture(page).readDisk()).meta.session as
    WorkspaceSessionState | undefined;

/** Legacy fixtures are converted directly to native files by the service fixture. */
export const clearWorkspaceStorage = async (_page: Page) => {};
