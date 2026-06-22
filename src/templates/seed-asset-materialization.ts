import { contentHashToR2Key, extFromMediaType } from '../assets/hash.js';
import { collectReferencedAssets, isAssetSubstitutionToken } from '../assets/site-assets.js';
import { SEED_ASSET_REGISTRY } from '../canvas/seed-assets.js';
import type { CanvasElement, CanvasSection, EditableSite, MediaKind } from '../canvas/schema.js';

// Row shape inserted into `owner_asset` when materialising a Template Seed
// for a new site. After ADR 0004 the asset root is the Owner, not the site
// — the materialised id is keyed on `customerId` so two sites under the
// same Owner share the same seed asset rows.
export interface SeedOwnerAssetRow {
  id: string;
  customerId: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: MediaKind;
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

export type PreparedSeedAssets =
  | { ok: true; editableState: EditableSite; seedRows: SeedOwnerAssetRow[] }
  | {
      ok: false;
      unknownSeedIds: string[];
      assetKindErrors: Array<{ assetId: string; expectedKind: MediaKind; actualKind: MediaKind }>;
    };

export type AssetIdResolution = string | { missing: string };
export type AssetIdResolver = (assetId: string, path: string) => AssetIdResolution;

function customerSeedAssetId(customerId: string, seedAssetId: string): string {
  return `seed-${customerId}-${seedAssetId}`;
}

function rewriteElementAssetIds(
  element: CanvasElement,
  elementPath: string,
  resolveAssetId: AssetIdResolver,
): string | null {
  // Codex review pass 3 finding 1 — every leaf that calls `resolveAssetId`
  // must first skip pre-substitution placeholder tokens (e.g.
  // `{{ogImageAssetId}}`). Pass 1 F4 added customTemplate recursion to
  // this walk; pass 2 F1 filtered tokens out of `collectReferencedAssets`
  // so `mappedIds` never contains them. Without the matching skip here,
  // the rewrite walk reaches `materializeAssetId({{ogImageAssetId}})`,
  // finds no mapping (correctly), and reports `missing` — breaking site
  // creation from any Template Seed whose Collection's customTemplate
  // carries the seeded default card. The check runs at each leaf so the
  // walk preserves the literal token verbatim — substitution happens at
  // publish time inside the materializer, not at site-creation rewrite.
  const esBgImage = element.elementStyle?.backgroundImageAssetId;
  if (
    typeof esBgImage === 'string' &&
    esBgImage.length > 0 &&
    !isAssetSubstitutionToken(esBgImage)
  ) {
    const mapped = resolveAssetId(esBgImage, `${elementPath}.elementStyle.backgroundImageAssetId`);
    if (typeof mapped !== 'string') return mapped.missing;
    element.elementStyle = { ...element.elementStyle, backgroundImageAssetId: mapped };
  }

  if (element.type === 'media') {
    if (!isAssetSubstitutionToken(element.assetId)) {
      const mapped = resolveAssetId(element.assetId, `${elementPath}.assetId`);
      if (typeof mapped !== 'string') return mapped.missing;
      element.assetId = mapped;
    }
    if (
      element.mediaKind === 'video' &&
      element.posterAssetId !== undefined &&
      !isAssetSubstitutionToken(element.posterAssetId)
    ) {
      const posterMapped = resolveAssetId(element.posterAssetId, `${elementPath}.posterAssetId`);
      if (typeof posterMapped !== 'string') return posterMapped.missing;
      element.posterAssetId = posterMapped;
    }
    return null;
  }

  if (
    element.type === 'nav' &&
    typeof element.logoAssetId === 'string' &&
    element.logoAssetId.length > 0 &&
    !isAssetSubstitutionToken(element.logoAssetId)
  ) {
    const mapped = resolveAssetId(element.logoAssetId, `${elementPath}.logoAssetId`);
    if (typeof mapped !== 'string') return mapped.missing;
    element.logoAssetId = mapped;
    return null;
  }

  if (element.type === 'carousel') {
    for (let slideIdx = 0; slideIdx < element.slides.length; slideIdx++) {
      const slide = element.slides[slideIdx];
      if (!slide) continue;
      if (isAssetSubstitutionToken(slide.assetId)) continue;
      const mapped = resolveAssetId(
        slide.assetId,
        `${elementPath}.slides[${String(slideIdx)}].assetId`,
      );
      if (typeof mapped !== 'string') return mapped.missing;
      slide.assetId = mapped;
    }
    return null;
  }

  if (element.type === 'tabs') {
    for (let tabIdx = 0; tabIdx < element.tabs.length; tabIdx++) {
      const tab = element.tabs[tabIdx];
      if (!tab) continue;
      for (let childIdx = 0; childIdx < tab.elements.length; childIdx++) {
        const child = tab.elements[childIdx];
        if (!child) continue;
        const missing = rewriteElementAssetIds(
          child,
          `${elementPath}.tabs[${String(tabIdx)}].elements[${String(childIdx)}]`,
          resolveAssetId,
        );
        if (missing !== null) return missing;
      }
    }
    return null;
  }

  if (element.type === 'collection') {
    // ADR 0063 dec 6 — per-entry instances live in `entries` (materializer
    // output). Walk them so asset-id rewrites on import touch every nested
    // media reference.
    const collectionEntries = element.entries ?? [];
    for (let entryIdx = 0; entryIdx < collectionEntries.length; entryIdx++) {
      const entry = collectionEntries[entryIdx];
      if (!entry) continue;
      for (let childIdx = 0; childIdx < entry.length; childIdx++) {
        const child = entry[childIdx];
        if (!child) continue;
        const missing = rewriteElementAssetIds(
          child,
          `${elementPath}.entries[${String(entryIdx)}][${String(childIdx)}]`,
          resolveAssetId,
        );
        if (missing !== null) return missing;
      }
    }
    // ADR 0065 D2 + codex review pass 1 — `customTemplate` carries author-
    // authored template children that may bind to fixed assetIds. Asset-id
    // rewrite on import / clone must touch them too, mirroring the
    // `entries` walk above; otherwise a cloned site arrives with stale
    // upstream asset ids inside its custom card template.
    const customTemplate = element.customTemplate ?? [];
    for (let childIdx = 0; childIdx < customTemplate.length; childIdx++) {
      const child = customTemplate[childIdx];
      if (!child) continue;
      const missing = rewriteElementAssetIds(
        child,
        `${elementPath}.customTemplate[${String(childIdx)}]`,
        resolveAssetId,
      );
      if (missing !== null) return missing;
    }
  }

  return null;
}

function rewriteSectionAssetIds(
  section: CanvasSection | undefined,
  sectionPath: string,
  resolveAssetId: AssetIdResolver,
): string | null {
  if (!section) return null;
  if (
    typeof section.backgroundVideoAssetId === 'string' &&
    section.backgroundVideoAssetId.length > 0
  ) {
    const mapped = resolveAssetId(
      section.backgroundVideoAssetId,
      `${sectionPath}.backgroundVideoAssetId`,
    );
    if (typeof mapped !== 'string') return mapped.missing;
    section.backgroundVideoAssetId = mapped;
  }
  for (let elementIdx = 0; elementIdx < section.elements.length; elementIdx++) {
    const element = section.elements[elementIdx];
    if (!element) continue;
    const missing = rewriteElementAssetIds(
      element,
      `${sectionPath}.elements[${String(elementIdx)}]`,
      resolveAssetId,
    );
    if (missing !== null) return missing;
  }
  return null;
}

export function rewriteEditableSiteAssetIds(
  editableState: EditableSite,
  resolveAssetId: AssetIdResolver,
): string | null {
  for (const [pageIdx, page] of editableState.pages.entries()) {
    const pagePath = `pages[${String(pageIdx)}]`;
    if (typeof page.ogImageAssetId === 'string' && page.ogImageAssetId.length > 0) {
      const mapped = resolveAssetId(page.ogImageAssetId, `${pagePath}.ogImageAssetId`);
      if (typeof mapped !== 'string') return mapped.missing;
      page.ogImageAssetId = mapped;
    }
    for (const [sectionIdx, section] of page.sections.entries()) {
      const missing = rewriteSectionAssetIds(
        section,
        `${pagePath}.sections[${String(sectionIdx)}]`,
        resolveAssetId,
      );
      if (missing !== null) return missing;
    }
  }
  let missing = rewriteSectionAssetIds(editableState.header, 'header', resolveAssetId);
  if (missing !== null) return missing;
  missing = rewriteSectionAssetIds(editableState.footer, 'footer', resolveAssetId);
  if (missing !== null) return missing;
  if (typeof editableState.faviconAssetId === 'string' && editableState.faviconAssetId.length > 0) {
    const mapped = resolveAssetId(editableState.faviconAssetId, 'faviconAssetId');
    if (typeof mapped !== 'string') return mapped.missing;
    editableState.faviconAssetId = mapped;
  }
  return null;
}

/**
 * Materialise the Owner Asset rows a new site needs from a Template Seed.
 *
 * Re-rooted per ADR 0004: the materialised asset id is now keyed on
 * `customerId`, not `siteId`. Two sites under the same Owner share the
 * materialised seed rows; deleting one site does NOT cascade-drop the
 * shared Owner Asset. The function still rewrites the editable state's
 * MediaElement.assetId references to point at the materialised ids.
 */
export function prepareSeedAssetsForCustomer(
  customerId: string,
  state: EditableSite,
  /**
   * Existing (contentHash → ownerAsset.id) for this customer. When a seed's
   * contentHash already maps to an existing asset row, the canvas state is
   * rewritten to reference that existing id instead of materialising a new
   * `seed-{customerId}-{seedId}` row. Required for correctness under the
   * `owner_asset_customer_content_hash_unique` constraint — without this map,
   * the insert would silently no-op on conflict and the canvas state would
   * point at an id that doesn't exist.
   *
   * Pass an empty Map when the caller has no existing assets for this
   * customer (e.g. first site).
   */
  existingByHash: Map<string, string>,
): PreparedSeedAssets {
  const editableState = structuredClone(state);
  const mappedIds = new Map<string, string>();
  const seedRows: SeedOwnerAssetRow[] = [];
  const unknownSeedIds = new Set<string>();
  const assetKindErrors: Array<{
    assetId: string;
    expectedKind: MediaKind;
    actualKind: MediaKind;
  }> = [];

  for (const reference of collectReferencedAssets(editableState)) {
    const seed = SEED_ASSET_REGISTRY[reference.assetId];
    if (!seed) {
      unknownSeedIds.add(reference.assetId);
      continue;
    }
    if (seed.kind !== reference.expectedKind) {
      assetKindErrors.push({
        assetId: reference.assetId,
        expectedKind: reference.expectedKind,
        actualKind: seed.kind,
      });
      continue;
    }
    if (mappedIds.has(reference.assetId)) continue;
    const existingId = existingByHash.get(seed.contentHash);
    if (existingId !== undefined) {
      mappedIds.set(reference.assetId, existingId);
      continue;
    }
    const materializedId = customerSeedAssetId(customerId, reference.assetId);
    mappedIds.set(reference.assetId, materializedId);
    existingByHash.set(seed.contentHash, materializedId);
    seedRows.push({
      id: materializedId,
      customerId,
      contentHash: seed.contentHash,
      r2Key: contentHashToR2Key(seed.contentHash, extFromMediaType(seed.mediaType)),
      mediaType: seed.mediaType,
      kind: seed.kind,
      alt: seed.alt,
      width: seed.width,
      height: seed.height,
      byteSize: seed.byteSize,
    });
  }

  if (unknownSeedIds.size > 0 || assetKindErrors.length > 0) {
    return { ok: false, unknownSeedIds: [...unknownSeedIds], assetKindErrors };
  }

  function materializeAssetId(assetId: string, path: string): string | { missing: string } {
    const materializedAssetId = mappedIds.get(assetId);
    if (!materializedAssetId) {
      console.error(`[site-seed] missing materialized asset for ${path}: ${assetId}`);
      return { missing: assetId };
    }
    return materializedAssetId;
  }

  const missing = rewriteEditableSiteAssetIds(editableState, materializeAssetId);
  if (missing !== null) return { ok: false, unknownSeedIds: [missing], assetKindErrors: [] };

  return { ok: true, editableState, seedRows };
}
