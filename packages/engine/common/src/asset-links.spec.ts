import { it, expect } from 'vitest';
import { createAssetLink, parseAssetLink } from './asset-links';
it('preserves content identity and physical page while rejecting invalid targets', () => {
  const assetId = 'a'.repeat(64) + '.pdf';
  expect(parseAssetLink(createAssetLink({ assetId, page: 7 }))).toEqual({
    assetId,
    page: 7,
  });
  expect(parseAssetLink(`verd://asset/${assetId}#page=0`)).toBeNull();
  expect(parseAssetLink('verd://asset/../../secret')).toBeNull();
  expect(() => createAssetLink({ assetId, page: Infinity })).toThrow();
});
