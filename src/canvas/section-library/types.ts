// src/canvas/section-library/types.ts
//
// ADR 0061 — Section Library shared types.
//
// `SectionLibraryEntry` is the code-defined shape that the boot upsert
// (boot-upsert.ts) projects into rows in `library_section`. It carries
// everything the upsert needs to construct a row except the synthetic
// columns (`id`, `version`, `parentId`, `visibility`, `customerId`) —
// those are derived deterministically per Decision 4 (code-defined
// entries are always v1, parent=null, visibility='global', customerId=null).
//
// `SectionInstanceRef` is the shape a TemplateSeed composition embeds
// per Decision 6. The Section Library row itself never carries an
// instance scope; the scope is stamped onto the section at instantiation
// time (see CanvasSection.instanceScope in src/canvas/schema.ts — added
// in Phase D).

import type { AssetManifestEntry, SectionCategory } from '../../db/schema.js';
import type { CanvasElement, CanvasSection } from '../schema.js';

export type { SectionCategory };

export interface SectionLibraryEntry {
  /** Origin-named slug per ADR 0061 dec 5 — e.g. `home-template-hero`, `library-template-testimonial-quote`. */
  baseSlug: string;
  /** Picker-filter axis. Closed enum per Decision 8. */
  category: SectionCategory;
  /** Display name in the picker card title. */
  name: string;
  /** Description displayed in the picker card body. */
  description: string;
  /** Existing recipe enum value (AGENT_RECIPE_IDS ∪ 'custom'). */
  recipeId: string;
  /** First text element's heading content, surfaced in search per Decision 11. */
  headingPreview: string;
  /** The CanvasSection blob the row stores in `section_data`. */
  sectionData: CanvasSection;
  /** Snapshot of any ownerAsset rows the section references. Empty for asset-free sections. */
  assetManifest: AssetManifestEntry[];
  /**
   * Which TemplateSeed originally housed this section, if any. Carried for
   * picker filter/display in Phase E (`originTemplateName` joins to the
   * registry's display name). `null` for standalone library fixtures
   * (the `library-template-*` slug prefix per Decision 5).
   */
  originTemplateId: string | null;
}

/**
 * ADR 0061 Decision 6 — a TemplateSeed composition embeds these refs
 * instead of raw `CanvasSection` blobs. `sectionId` pins the exact
 * pool row (a specific `(base_slug, version)`); `instanceId` scopes
 * element ids per Decision 7; `overrides` mutates fields on individual
 * elements at instantiation time.
 */
export interface SectionInstanceRef {
  sectionId: string;
  instanceId: string;
  overrides?: { [origElementId: string]: Partial<CanvasElement> };
}
