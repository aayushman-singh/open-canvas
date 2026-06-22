import type { EditableSite, StyleKit, StyleKitPreset } from '../../canvas/schema.js';
import type { SectionLibraryEntry } from '../../canvas/section-library/index.js';

export type ReplicaCompileTarget = 'seed' | 'import' | 'both';
export type ReplicaDeclaredTarget = Exclude<ReplicaCompileTarget, 'both'>;
export type ReplicaFidelityStatus = 'native' | 'unsupported' | 'omitted';

export interface ReplicaSourceRef {
  kind: 'url' | 'github';
  url?: string;
  repository?: string;
}

export interface ReplicaAssetSource {
  id: string;
  sourcePath: string;
  mediaType: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  alt: string;
}

export interface ReplicaMetadata {
  id: string;
  name: string;
  tagline: string;
  source: ReplicaSourceRef;
  targets: ReplicaDeclaredTarget[];
  styleKit: StyleKit;
  customStyleKit?: StyleKitPreset;
  pageOrder: string[];
  requiredCopy: string[];
  requiredAssetIds: string[];
  forbiddenRuntimeTokens: string[];
  assets: ReplicaAssetSource[];
}

export interface ReplicaPageSource {
  fileStem: string;
  id: string;
  slug: string;
  title: string;
  width: number;
  sections: string[];
  description?: string;
  pageBackground?: string;
  sectionGap?: number;
}

export interface ReplicaFidelityItem {
  id: string;
  sourceBehaviour: string;
  status: ReplicaFidelityStatus;
  primitive?: string;
  evidence?: string[];
  unsupportedId?: string;
}

export interface ReplicaUnsupportedFinding {
  id: string;
  sourceBehaviour: string;
  reason: string;
  requiredPrimitive: string;
}

export interface ReplicaSourcePackage {
  rootDir: string;
  metadata: ReplicaMetadata;
  pages: ReplicaPageSource[];
  sections: SectionLibraryEntry[];
  fidelityLedger: ReplicaFidelityItem[];
  unsupported: ReplicaUnsupportedFinding[];
}

export interface ReplicaCompileReport {
  replicaId: string;
  target: ReplicaCompileTarget;
  writtenFiles: string[];
  editableSite?: EditableSite;
  unsupported: ReplicaUnsupportedFinding[];
  fidelityLedger: ReplicaFidelityItem[];
}
