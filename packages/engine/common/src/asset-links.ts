export interface AssetTarget {
  assetId: string;
  page?: number;
}
const validId = /^[a-f0-9]{64}\.[a-z0-9]+$/;
export function createAssetLink(target: AssetTarget): string {
  if (
    !validId.test(target.assetId) ||
    (target.page !== undefined &&
      (!Number.isSafeInteger(target.page) || target.page < 1))
  )
    throw new Error('Invalid asset target');
  return `verd://asset/${target.assetId}${target.page ? `#page=${target.page}` : ''}`;
}
export function parseAssetLink(href: string): AssetTarget | null {
  const match =
    /^verd:\/\/asset\/([a-f0-9]{64}\.[a-z0-9]+)(?:#page=([1-9]\d*))?$/.exec(
      href,
    );
  if (!match || (match[2] && !Number.isSafeInteger(Number(match[2]))))
    return null;
  return { assetId: match[1], ...(match[2] ? { page: Number(match[2]) } : {}) };
}
