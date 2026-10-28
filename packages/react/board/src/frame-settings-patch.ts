/** Apply only the fields edited since render to the latest host value. Arrays are atomic fields. */
export function mergeSettingsPatch<T>(before: T, proposed: T, latest: T): T {
  if (Object.is(before, proposed)) return latest;
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!record(before) || !record(proposed) || !record(latest)) return proposed;
  const entries = new Map(Object.entries(latest));
  for (const key of new Set([
    ...Object.keys(before),
    ...Object.keys(proposed),
  ])) {
    if (
      Object.is(before[key], proposed[key]) &&
      key in before === key in proposed
    )
      continue;
    if (!Object.hasOwn(proposed, key)) entries.delete(key);
    else
      entries.set(
        key,
        mergeSettingsPatch(before[key], proposed[key], latest[key]),
      );
  }
  return Object.fromEntries(entries) as T;
}
