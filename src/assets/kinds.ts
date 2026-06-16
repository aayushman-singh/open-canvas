export const OWNER_ASSET_KINDS = ['image', 'video', 'lottie-json'] as const;

export type OwnerAssetKind = (typeof OWNER_ASSET_KINDS)[number];
export type MediaOwnerAssetKind = Extract<OwnerAssetKind, 'image' | 'video'>;

const OWNER_ASSET_KIND_SET = new Set<string>(OWNER_ASSET_KINDS);

export function isOwnerAssetKind(value: string): value is OwnerAssetKind {
  return OWNER_ASSET_KIND_SET.has(value);
}
