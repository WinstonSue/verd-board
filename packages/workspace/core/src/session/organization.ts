/** Portable organization; file identities survive renames and moves. */
export interface WorkspaceOrganization {
  favorites: string[];
  sort: 'name' | 'manual';
  order: Record<string, string[]>;
}
export function readOrganization(
  value: Record<string, unknown>,
): WorkspaceOrganization {
  const raw = value['navigation'] as Partial<WorkspaceOrganization> | undefined;
  return {
    favorites: Array.isArray(raw?.favorites)
      ? raw.favorites.filter((id): id is string => typeof id === 'string')
      : [],
    sort: raw?.sort === 'manual' ? 'manual' : 'name',
    order:
      raw?.order && typeof raw.order === 'object' && !Array.isArray(raw.order)
        ? Object.fromEntries(
            Object.entries(raw.order)
              .filter(([, v]) => Array.isArray(v))
              .map(([k, v]) => [
                k,
                v.filter((id): id is string => typeof id === 'string'),
              ]),
          )
        : {},
  };
}
export const topLevelPaths = (paths: string[]) =>
  [...new Set(paths)].filter(
    (path) =>
      !paths.some((parent) => parent !== path && path.startsWith(`${parent}/`)),
  );
export function remapOrganization(
  value: Record<string, unknown>,
  moves: { from: string; to: string }[],
) {
  const navigation = readOrganization(value);
  const remap = (path: string) => {
    const move = moves.find(
      (item) => path === item.from || path.startsWith(`${item.from}/`),
    );
    return move ? move.to + path.slice(move.from.length) : path;
  };
  navigation.order = Object.fromEntries(
    Object.entries(navigation.order).map(([path, refs]) => [
      remap(path),
      refs.map((ref) =>
        ref.startsWith('path:') ? `path:${remap(ref.slice(5))}` : ref,
      ),
    ]),
  );
  return { ...value, navigation };
}
