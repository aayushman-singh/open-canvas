import type {
  LayoutTransition,
  LoadExperience,
  MotionSequence,
  RichMotionAsset,
  ScrollScene,
} from './behaviour-primitives.js';
import type { CanvasElement, CanvasSection, NavThemeReducedMotionMode, NavThemeTarget } from './schema.js';

export interface NavThemeRuntime {
  navElementId: string;
  defaultTheme: NavThemeTarget;
  reducedMotion: NavThemeReducedMotionMode;
}

export interface SmoothScrollRuntime {
  mode: 'inertial';
  durationMs: number;
  reducedMotion: 'native' | 'disabled';
  paddingTop?: number;
}

export interface BehaviourPayload {
  loadExperience?: LoadExperience;
  motionSequences: MotionSequence[];
  scrollScenes: ScrollScene[];
  layoutTransitions?: LayoutTransition[];
  navThemes?: NavThemeRuntime[];
  smoothScroll?: SmoothScrollRuntime;
  richMotionAssets: Array<RichMotionAsset & { frameUrls?: string[]; posterUrl?: string; srcUrl?: string }>;
}

interface SnapshotWithBehaviour {
  loadExperience?: LoadExperience | { enabled?: boolean };
  motionSequences?: MotionSequence[];
  scrollScenes?: ScrollScene[];
  layoutTransitions?: LayoutTransition[];
  richMotionAssets?: RichMotionAsset[];
  scrollBehavior?: {
    smooth?: boolean;
    paddingTop?: number;
    mode?: string;
    durationMs?: number;
    reducedMotion?: string;
  };
  pages?: Array<{ sections?: CanvasSection[] }>;
  header?: CanvasSection;
  footer?: CanvasSection;
}

function collectNavThemeRuntimes(snapshot: SnapshotWithBehaviour): NavThemeRuntime[] {
  const out: NavThemeRuntime[] = [];
  const seen = new Set<string>();
  const visitElement = (element: CanvasElement): void => {
    if (element.type === 'nav' && element.themeOnScroll?.enabled === true && !seen.has(element.id)) {
      seen.add(element.id);
      out.push({
        navElementId: element.id,
        defaultTheme: element.themeOnScroll.defaultTheme,
        reducedMotion: element.themeOnScroll.reducedMotion,
      });
    }
    if (element.type === 'tabs') {
      for (const tab of element.tabs) {
        for (const child of tab.elements) visitElement(child);
      }
    } else if (element.type === 'collection') {
      if (Array.isArray(element.customTemplate)) {
        for (const child of element.customTemplate) visitElement(child);
      }
      if (Array.isArray(element.entries)) {
        for (const entry of element.entries) {
          for (const child of entry) visitElement(child);
        }
      }
    } else if (element.type === 'flow-container') {
      for (const item of element.items) visitElement(item.element);
    }
  };
  const visitSection = (section: CanvasSection | undefined): void => {
    if (!section) return;
    for (const element of section.elements) visitElement(element);
  };
  visitSection(snapshot.header);
  for (const page of snapshot.pages ?? []) {
    for (const section of page.sections ?? []) visitSection(section);
  }
  visitSection(snapshot.footer);
  return out;
}

function collectSmoothScrollRuntime(snapshot: SnapshotWithBehaviour): SmoothScrollRuntime | null {
  const scroll = snapshot.scrollBehavior;
  if (!scroll || scroll.mode !== 'inertial') return null;
  if (typeof scroll.durationMs !== 'number' || scroll.durationMs < 100 || scroll.durationMs > 5000) {
    throw new Error('smooth-scroll-runtime-invalid-duration');
  }
  if (scroll.reducedMotion !== 'native' && scroll.reducedMotion !== 'disabled') {
    throw new Error('smooth-scroll-runtime-invalid-reduced-motion');
  }
  const runtime: SmoothScrollRuntime = {
    mode: 'inertial',
    durationMs: scroll.durationMs,
    reducedMotion: scroll.reducedMotion,
  };
  if (typeof scroll.paddingTop === 'number' && scroll.paddingTop >= 0) {
    runtime.paddingTop = scroll.paddingTop;
  }
  return runtime;
}

export function snapshotHasBehaviourPrimitives(snapshot: SnapshotWithBehaviour): boolean {
  if (snapshot.loadExperience !== undefined && 'label' in snapshot.loadExperience) return true;
  if ((snapshot.motionSequences ?? []).length > 0) return true;
  if ((snapshot.scrollScenes ?? []).length > 0) return true;
  if ((snapshot.layoutTransitions ?? []).length > 0) return true;
  if ((snapshot.richMotionAssets ?? []).length > 0) return true;
  if (collectSmoothScrollRuntime(snapshot) !== null) return true;
  if (collectNavThemeRuntimes(snapshot).length > 0) return true;
  return false;
}

export function buildBehaviourPayload(
  snapshot: SnapshotWithBehaviour,
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
  const navThemes = collectNavThemeRuntimes(snapshot);
  const smoothScroll = collectSmoothScrollRuntime(snapshot);
  const payload: BehaviourPayload = {
    motionSequences: snapshot.motionSequences ?? [],
    scrollScenes: snapshot.scrollScenes ?? [],
    layoutTransitions: snapshot.layoutTransitions ?? [],
    richMotionAssets,
  };
  if (navThemes.length > 0) payload.navThemes = navThemes;
  if (smoothScroll) payload.smoothScroll = smoothScroll;
  if (snapshot.loadExperience !== undefined && 'label' in snapshot.loadExperience) {
    payload.loadExperience = snapshot.loadExperience;
  }
  return payload;
}

export function serializeBehaviourPayload(payload: BehaviourPayload): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}