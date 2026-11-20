import { isNodeCell } from '../../../packages/engine/core/src/cell/types';
import { createCellRegistry } from '../../../packages/engine/core/src/cell/registry';
import {
  EdgeUtil,
  NodeUtil,
} from '../../../packages/engine/core/src/cell/util';

/** Neutral geometry used to exercise kernel contracts, without real domain plugins. */
export const createTestCellRegistry = () =>
  createCellRegistry({
    plugins: [
      {
        id: 'kernel-test',
        install(registry) {
          for (const kind of ['geometry', 'text', 'image']) {
            registry.register(
              new (class extends NodeUtil {
                readonly kind = kind;
                readonly groupable = true;
                readonly fitText = kind === 'geometry';
                readonly canConnect = isNodeCell;
              })(),
            );
          }
          registry.register(
            new (class extends EdgeUtil {
              readonly kind = 'arrow';
              readonly groupable = true;
              readonly freeTerminals = true;
              readonly canConnect = isNodeCell;
            })(),
          );
        },
      },
    ],
  });
