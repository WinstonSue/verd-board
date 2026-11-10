import { expect, type Locator } from '@playwright/test';

/** Controls live above cell bodies, in the same SVG occurrence. */
export async function nodePorts(node: Locator) {
  const id = await node.getAttribute('data-cell-id');
  return node
    .locator('xpath=ancestor::*[local-name()="svg"][1]')
    .locator(`[data-port-node-id=${JSON.stringify(id)}] [data-port-id]`);
}

export async function nodePort(node: Locator, portId: string) {
  const id = await node.getAttribute('data-cell-id');
  return node
    .locator('xpath=ancestor::*[local-name()="svg"][1]')
    .locator(
      `[data-port-node-id=${JSON.stringify(id)}] [data-port-id=${JSON.stringify(portId)}]`,
    );
}

/** Find a real cell-body hit while avoiding foreground ports and clipped text. */
export async function cellBodyPoint(cell: Locator) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await cell.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const left = Math.max(0, box.left),
            right = Math.min(innerWidth, box.right);
          const top = Math.max(0, box.top),
            bottom = Math.min(innerHeight, box.bottom);
          for (let y = top + 2; y < bottom - 2; y += 3)
            for (let x = left + 2; x < right - 2; x += 3) {
              const hit = document.elementFromPoint(x, y);
              if (
                hit &&
                (element.hasAttribute('data-cell-id')
                  ? hit.closest('[data-cell-id]') === element
                  : element.contains(hit)) &&
                !hit.closest(
                  '[data-port-id], [data-control-hit], [data-selection-handles]',
                )
              )
                return { x, y };
            }
          return null;
        });
        return point;
      },
      { message: 'Waiting for an unobstructed cell-body hit', timeout: 5000 },
    )
    .not.toBeNull();
  return point!;
}
