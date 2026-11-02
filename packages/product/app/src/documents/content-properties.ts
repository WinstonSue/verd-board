export interface ContentProperties {
  tags: string[];
  status?: string;
  source?: string;
}
export function isContentProperties(
  value: unknown,
): value is ContentProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data['tags']) &&
    data['tags'].every((tag) => typeof tag === 'string') &&
    (data['status'] === undefined || typeof data['status'] === 'string') &&
    (data['source'] === undefined || typeof data['source'] === 'string')
  );
}
