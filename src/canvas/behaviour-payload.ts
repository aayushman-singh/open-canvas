import type {
  LoadExperience,
  MotionSequence,
  RichMotionAsset,
  ScrollScene,
} from './behaviour-primitives.js';

export interface BehaviourPayload {
  loadExperience?: LoadExperience;
  motionSequences: MotionSequence[];
  scrollScenes: ScrollScene[];
  richMotionAssets: Array<RichMotionAsset & { frameUrls?: string[]; posterUrl?: string }>;
}

export function snapshotHasBehaviourPrimitives(snapshot: {
  loadExperience?: LoadExperience | { enabled?: boolean };
  motionSequences?: MotionSequence[];
  scrollScenes?: ScrollScene[];
  richMotionAssets?: RichMotionAsset[];
}): boolean {
  if (snapshot.loadExperience !== undefined && 'label' in snapshot.loadExperience) return true;
  if ((snapshot.motionSequences ?? []).length > 0) return true;
  if ((snapshot.scrollScenes ?? []).length > 0) return true;
  if ((snapshot.richMotionAssets ?? []).length > 0) return true;
  return false;
}

export function buildBehaviourPayload(
  snapshot: {
    loadExperience?: LoadExperience | { enabled?: boolean };
    motionSequences?: MotionSequence[];
    scrollScenes?: ScrollScene[];
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
    return asset;
  });
  const payload: BehaviourPayload = {
    motionSequences: snapshot.motionSequences ?? [],
    scrollScenes: snapshot.scrollScenes ?? [],
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
