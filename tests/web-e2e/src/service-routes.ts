import type { Page } from '@playwright/test';
import {
  decodeServiceValue,
  encodeServiceValue,
  type ServiceValue,
} from '../../../packages/product/app/src/host/service-protocol';
import type { CommitRequest } from '../../../packages/workspace/core/src/host/workspace-host';

type Rpc = { method: string; args: unknown[] };
const documentDetached = (error: unknown) =>
  /Execution context was destroyed|Target page, context or browser has been closed|Test ended/.test(
    String(error),
  );
export async function observeContentWrites(
  page: Page,
  counter: string,
  nativeOnly = false,
) {
  await page.addInitScript((name) => {
    (window as any)[name] = 0;
  }, counter);
  await page
    .evaluate((name) => {
      (window as any)[name] = 0;
    }, counter)
    .catch(() => {});
  await page.route('**/api/v1/rpc', async (route) => {
    const request = decodeServiceValue(
      route.request().postDataJSON() as ServiceValue,
    ) as Rpc;
    if (request.method === 'commit') {
      const commit = request.args[1] as CommitRequest;
      const changed = nativeOnly
        ? commit.writes?.some((write) =>
            /\.verd(?:(?:-doc)?\.json)?$/.test(write.path),
          )
        : [
            commit.writes,
            commit.resourceWrites,
            commit.moves,
            commit.trash,
            commit.restore,
            commit.mkdirs,
            commit.purge,
          ].some((items) => items?.length);
      if (changed)
        await page
          .evaluate((name) => {
            (window as any)[name] = ((window as any)[name] ?? 0) + 1;
          }, counter)
          .catch(() => {});
    }
    await route.fallback();
  });
}
export async function rejectNextCommit(page: Page) {
  let rejected = false;
  await page.route('**/api/v1/rpc', async (route) => {
    const request = decodeServiceValue(
      route.request().postDataJSON() as ServiceValue,
    ) as Rpc;
    if (!rejected && request.method === 'commit') {
      rejected = true;
      const commit = request.args[1] as CommitRequest;
      await route.fulfill({
        json: encodeServiceValue({
          value: {
            transactionId: commit.transactionId,
            outcome: 'rejected',
            reason: 'io-error',
          },
        }),
      });
    } else await route.fallback();
  });
}
export async function installSaveProbe(page: Page) {
  await page.route('**/api/v1/rpc', async (route) => {
    const request = decodeServiceValue(
      route.request().postDataJSON() as ServiceValue,
    ) as Rpc;
    if (request.method !== 'commit') {
      await route.fallback();
      return;
    }
    const commit = request.args[1] as CommitRequest;
    const paths = (commit.writes ?? []).map((write) => write.path);
    const state = await page
      .evaluate(
        ({ paths, navigation }) => {
          const probe = (window as any).__saveProbe;
          probe?.writes.push(paths);
          return {
            reject: !!probe?.rejectNavigation && navigation && !paths.length,
            hold: !!probe?.holdWrites && !!paths.length,
          };
        },
        { paths, navigation: !!commit.session },
      )
      .catch((error) => {
        // A best-effort unload save can outlive the document that owned the
        // probe. It still reaches the real service, without a new document's fault.
        if (documentDetached(error)) return { reject: false, hold: false };
        throw error;
      });
    if (state.reject) {
      await route.fulfill({
        json: encodeServiceValue({
          value: {
            transactionId: commit.transactionId,
            outcome: 'rejected',
            reason: 'io-error',
          },
        }),
      });
      return;
    }
    if (state.hold)
      await page
        .evaluate(() => (window as any).__saveProbe.wait())
        .catch((error) => {
          if (!documentDetached(error)) throw error;
        });
    await route.fallback();
  });
}
