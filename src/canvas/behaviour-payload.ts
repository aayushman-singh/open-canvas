import type {
  LayoutTransition,
  LoadExperience,
  MotionSequence,
  RichMotionAsset,
  ScrollScene,
} from './behaviour-primitives.js';

export interface BehaviourPayload {
  loadExperience?: LoadExperience;
  motionSequences: MotionSequence[];
  scrollScenes: ScrollScene[];
  layoutTransitions?: LayoutTransition[];
  richMotionAssets: Array<RichMotionAsset & { frameUrls?: string[]; posterUrl?: string; srcUrl?: string }>;
}

export function snapshotHasBehaviourPrimitives(snapshot: {
  loadExperience?: LoadExperience | { enabled?: boolean };
  motionSequences?: MotionSequence[];
  scrollScenes?: ScrollScene[];
  layoutTransitions?: LayoutTransition[];
  richMotionAssets?: RichMotionAsset[];
}): boolean {
  if (snapshot.loadExperience !== undefined && 'label' in snapshot.loadExperience) return true;
  if ((snapshot.motionSequences ?? []).length > 0) return true;
  if ((snapshot.scrollScenes ?? []).length > 0) return true;
  if ((snapshot.layoutTransitions ?? []).length > 0) return true;
  if ((snapshot.richMotionAssets ?? []).length > 0) return true;
  return false;
}

export function buildBehaviourPayload(
  snapshot: {
    loadExperience?: LoadExperience | { enabled?: boolean };
    motionSequences?: MotionSequence[];
    scrollScenes?: ScrollScene[];
    layoutTransitions?: LayoutTransition[];
    richMotionAssets?: RichMotionAsset[];
  },
  assetBasePath: string,
): BehaviourPayload | null {
  if (!snapshotHasBehaviourPrimitives(snapshot)) return null;
  const richMotionAssets = (snapshot.richMotionAssets ?? []).map((asset) => {
    if (asset.kind === 'image-sequence') {
      return {
        ...asset,
        frameUrls: asset.frameAssetIds.map((id) => `${assetBasePath}/${id}`),
        posterUrl: `${assetBasePath}/${asset.posterAssetId}`,
      };
    }
    if (asset.kind === 'rive') {
      return {
        ...asset,
        srcUrl: `${assetBasePath}/${asset.assetId}`,
      };
    }
    if (asset.kind === 'lottie') {
      return {
        ...asset,
        srcUrl: `${assetBasePath}/${asset.assetId}`,
      };
    }
    if (asset.kind === 'model-3d') {
      const modelAsset = {
        ...asset,
        srcUrl: `${assetBasePath}/${asset.assetId}`,
      };
      if (asset.posterAssetId !== undefined) {
        return { ...modelAsset, posterUrl: `${assetBasePath}/${asset.posterAssetId}` };
      }
      return modelAsset;
    }
    return asset;
  });
  const payload: BehaviourPayload = {
    motionSequences: snapshot.motionSequences ?? [],
    scrollScenes: snapshot.scrollScenes ?? [],
    layoutTransitions: snapshot.layoutTransitions ?? [],
    richMotionAssets,
  };
  if (snapshot.loadExperience !== undefined && 'label' in snapshot.loadExperience) {
    payload.loadExperience = snapshot.loadExperience;
  }
  return payload;
}

export function serializeBehaviourPayload(payload: BehaviourPayload): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}
