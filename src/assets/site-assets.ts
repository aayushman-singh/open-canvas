// src/assets/site-assets.ts
//
// Reference-walking helpers shared by the publish guard, the canvas-agent
// pipeline, and the public read route. The legacy file once carried a
// data-URL parser and a base64-response builder; both are gone now that
// ADR 0006 moved Owner Asset bytes out of Postgres into R2.
//
// The helpers below are pure (no I/O), so they can be reused from any
// consumer that needs to know "which assets does this Canvas state
// reference, and do those references match the materialised row set".

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  MediaKind,
  PublishedSnapshot,
} from '../canvas/schema.js';
import type { RichMotionAsset } from '../canvas/behaviour-primitives.js';

export interface ReferencedAsset {
  assetId: string;
  expectedKind: MediaKind;
  role:
    | 'asset'
    | 'poster'
    | 'og-image'
    | 'favicon'
    | 'background-video'
    | 'nav-logo'
    | 'carousel-slide'
    | 'element-bg-image'
    | 'rich-motion-frame'
    | 'rich-motion-poster'
    | 'rich-motion-portrait'
    | 'rich-motion-asset';
  path: string;
  mediaElementId?: string;
}

export interface AssetKindRow {
  id: string;
  kind: MediaKind;
}

export interface AssetReferenceError extends ReferencedAsset {
  reason: 'missing' | 'kind-mismatch';
  actualKind?: MediaKind;
}

export interface UnfilledAssetReference {
  role: 'asset' | 'poster';
  path: string;
  mediaElementId: string;
}

export interface AssetReferenceRoot {
  pages: CanvasPage[];
  faviconAssetId?: string;
  header?: CanvasSection;
  footer?: CanvasSection;
  richMotionAssets?: RichMotionAsset[];
}

export type AssetReferenceSource =
  | CanvasPage[]
  | AssetReferenceRoot
  | EditableSite
  | PublishedSnapshot;

// Sentinel for media slots an Owner has dropped onto the canvas but not yet
// filled with a real asset. Treated as "unfilled" by the reference walker
// (save validator skips it; publish guard counts it as an unfilled slot).
const PLACEHOLDER_ASSET_ID = '__placeholder__';

/**
 * ADR 0065 D3 — `seedCustomTemplate` deep-clones `DEFAULT_CARD_TEMPLATE`
 * which carries the placeholder token `{{ogImageAssetId}}` in its
 * `assetId` field. The materializer resolves that token at publish time
 * against each entry's metadata; in editor state it lives as the literal
 * `{{ogImageAssetId}}` string.
 *
 * The reference walkers treat an asset substitution token as "not a real
 * asset reference" — counting it as one trips the publish guard
 * (`missing asset {{ogImageAssetId}}`) and the unfilled-asset hint set
 * (Owner can't fill a placeholder-resolved slot from the inspector).
 *
 * Codex review pass 3 finding 4 — detection is intentionally
 * case-SENSITIVE and restricted to the exact ASSET-resolving placeholder
 * set. The materializer's `PLACEHOLDER_FIELDS` enum is authoritative for
 * what the substitution pass consumes; per ADR 0063 D1/D8 the only
 * placeholder that resolves to an asset id is `ogImageAssetId`. The other
 * placeholders (`title`, `excerpt`, `body`, `publishedDate`, `author`,
 * `category`, `tag`, `slug`) substitute into TEXT fields, never into an
 * asset id slot, so they have no business being whitelisted here.
 *
 * A loose case-insensitive pattern (e.g. /i flag) would absorb typo'd
 * tokens like `{{ogImageAssetID}}` (uppercase ID), silently suppressing
 * a real-but-malformed asset id. The CLAUDE.md no-fallback rule says
 * fail loudly on real corruption — so a typo'd token does NOT match
 * here, reaches the rest of the pipeline as a fake asset id, and trips
 * the publish guard / save validator with a clear "missing asset
 * {{ogImageAssetID}}" error pinpointing the typo.
 *
 * Keep this in sync with the asset-resolving subset of
 * collection-materializer.ts's `PLACEHOLDER_FIELDS`. When a new
 * asset-resolving placeholder is added there, extend this union here.
 */
const ASSET_SUBSTITUTION_TOKEN_PATTERN = /^\{\{ogImageAssetId\}\}$/;

/**
 * Whether `value` is one of the materializer's asset-resolving
 * substitution tokens. Exported so the site-creation route's asset
 * rewrite walk (ADR 0065 Phase 4 / codex review pass 3 finding 1) can
 * share the same case-sensitive predicate that
 * `collectReferencedAssets` uses — without that share, the rewrite walk
 * would treat `{{ogImageAssetId}}` as a real asset id and reject site
 * creation with `template seed references invalid asset ids`.
 */
export function isAssetSubstitutionToken(value: string): boolean {
  return ASSET_SUBSTITUTION_TOKEN_PATTERN.test(value);
}

function siteFaviconAssetId(
  source: Exclude<AssetReferenceSource, CanvasPage[]>,
): string | undefined {
  return 'faviconAssetId' in source ? source.faviconAssetId : undefined;
}

function referenceRootFrom(source: AssetReferenceSource): AssetReferenceRoot {
  if (Array.isArray(source)) return { pages: source };
  const favicon = siteFaviconAssetId(source);
  const richMotionAssets =
    'richMotionAssets' in source ? source.richMotionAssets : undefined;
  return {
    pages: source.pages,
    ...(source.header !== undefined ? { header: source.header } : {}),
    ...(source.footer !== undefined ? { footer: source.footer } : {}),
    ...(favicon !== undefined ? { faviconAssetId: favicon } : {}),
    ...(richMotionAssets !== undefined ? { richMotionAssets } : {}),
  };
}

function pushReference(
  out: ReferencedAsset[],
  assetId: string | undefined,
  expectedKind: MediaKind,
  role: ReferencedAsset['role'],
  path: string,
  mediaElementId?: string,
): void {
  if (typeof assetId !== 'string' || assetId.length === 0) return;
  if (assetId === PLACEHOLDER_ASSET_ID) return;
  // ADR 0065 D3 + codex review pass 2 finding 1 — `customTemplate` recursion
  // (added in pass 1 F4) surfaces `{{ogImageAssetId}}` tokens from the
  // seeded default card. That is a pre-substitution placeholder, not an
  // asset id — counting it as a real reference makes the publish guard
  // reject the state with `missing asset {{ogImageAssetId}}`. Reject at
  // the early-return boundary so every walker (publish guard, save
  // validator, public read route) benefits without per-call-site
  // filtering. Codex review pass 3 finding 4 tightened the predicate to
  // an exact case-sensitive match — a typo'd `{{ogImageAssetID}}` no
  // longer slips through silently.
  if (isAssetSubstitutionToken(assetId)) return;
  out.push({
    assetId,
    expectedKind,
    role,
    path,
    ...(mediaElementId !== undefined ? { mediaElementId } : {}),
  });
}

function collectElementReferences(
  element: CanvasElement,
  elementPath: string,
  out: ReferencedAsset[],
): void {
  pushReference(
    out,
    element.elementStyle?.backgroundImageAssetId,
    'image',
    'element-bg-image',
    `${elementPath}.elementStyle.backgroundImageAssetId`,
    element.id,
  );
  if (element.type === 'media') {
    pushReference(
      out,
      element.assetId,
      element.mediaKind,
      'asset',
      `${elementPath}.assetId`,
      element.id,
    );
    if (element.mediaKind === 'video') {
      pushReference(
        out,
        element.posterAssetId,
        'image',
        'poster',
        `${elementPath}.posterAssetId`,
        element.id,
      );
    }
    return;
  }
  if (element.type === 'nav') {
    pushReference(out, element.logoAssetId, 'image', 'nav-logo', `${elementPath}.logoAssetId`);
    return;
  }
  if (element.type === 'carousel') {
    element.slides.forEach((slide, slideIdx) => {
      pushReference(
        out,
        slide.assetId,
        'image',
        'carousel-slide',
        `${elementPath}.slides[${String(slideIdx)}].assetId`,
        element.id,
      );
    });
    return;
  }
  if (element.type === 'tabs') {
    element.tabs.forEach((tab, tabIdx) => {
      tab.elements.forEach((child, childIdx) => {
        collectElementReferences(
          child,
          `${elementPath}.tabs[${String(tabIdx)}].elements[${String(childIdx)}]`,
          out,
        );
      });
    });
    return;
  }
  if (element.type === 'collection') {
    // ADR 0063 dec 6 — `entries` is the materializer's per-entry output;
    // its child assets (e.g. media element assetId from a per-entry
    // `ogImageAssetId`) must remain reachable so the publish guard does not
    // 404 a referenced asset.
    (element.entries ?? []).forEach((entry, entryIdx) => {
      entry.forEach((child, childIdx) => {
        collectElementReferences(
          child,
          `${elementPath}.entries[${String(entryIdx)}][${String(childIdx)}]`,
          out,
        );
      });
    });
    // ADR 0065 D2 + codex review pass 1 — `customTemplate` carries author-
    // authored template children that may bind to FIXED assetIds (e.g. a
    // brand logo overlay). These references must reach the publish guard
    // so deleting the asset triggers the cascade. Note: the materializer
    // ALSO clones customTemplate into entries[][] at publish time, but
    // the editor-state walk runs against pre-materialization state — the
    // customTemplate path is the only place a fixed assetId survives the
    // editor's save round-trip.
    (element.customTemplate ?? []).forEach((child, childIdx) => {
      collectElementReferences(child, `${elementPath}.customTemplate[${String(childIdx)}]`, out);
    });
    return;
  }
  if (element.type === 'flow-container') {
    element.items.forEach((item, itemIdx) => {
      collectElementReferences(
        item.element,
        `${elementPath}.items[${String(itemIdx)}].element`,
        out,
      );
    });
  }
}

function collectSectionReferences(
  section: CanvasSection,
  sectionPath: string,
  out: ReferencedAsset[],
): void {
  pushReference(
    out,
    section.backgroundVideoAssetId,
    'video',
    'background-video',
    `${sectionPath}.backgroundVideoAssetId`,
  );
  for (const [elementIdx, element] of section.elements.entries()) {
    collectElementReferences(element, `${sectionPath}.elements[${String(elementIdx)}]`, out);
  }
}

function collectRichMotionAssetReferences(
  richMotionAssets: RichMotionAsset[] | undefined,
  out: ReferencedAsset[],
): void {
  if (richMotionAssets === undefined) return;
  richMotionAssets.forEach((asset, assetIdx) => {
    const basePath = `richMotionAssets[${String(assetIdx)}]`;
    if (asset.kind === 'image-sequence') {
      asset.frameAssetIds.forEach((frameAssetId, frameIdx) => {
        pushReference(
          out,
          frameAssetId,
          'image',
          'rich-motion-frame',
          `${basePath}.frameAssetIds[${String(frameIdx)}]`,
        );
      });
      pushReference(
        out,
        asset.posterAssetId,
        'image',
        'rich-motion-poster',
        `${basePath}.posterAssetId`,
      );
      return;
    }
    if (asset.kind === 'video-stream') {
      pushReference(out, asset.assetId, 'video', 'rich-motion-asset', `${basePath}.assetId`);
      pushReference(
        out,
        asset.posterAssetId,
        'image',
        'rich-motion-poster',
        `${basePath}.posterAssetId`,
      );
      return;
    }
    if (asset.kind === 'model-3d') {
      pushReference(
        out,
        asset.posterAssetId,
        'image',
        'rich-motion-poster',
        `${basePath}.posterAssetId`,
      );
      return;
    }
    if (asset.kind === 'particle-field' && asset.sourceAssetId !== undefined) {
      pushReference(
        out,
        asset.sourceAssetId,
        'image',
        'rich-motion-portrait',
        `${basePath}.sourceAssetId`,
      );
    }
  });
}

/**
 * Walk a snapshot or editable site and return every referenced Owner Asset.
 * Passing a bare CanvasPage[] is still supported for older callers, but new
 * callers should pass the whole state/snapshot so site-wide header/footer
 * references are included. Used by:
 *   - publish guard: reject if any referenced id is missing from `ownerAsset`.
 *   - public `/assets/:assetId` route: 404 if the request is for an id not
 *     in the current snapshot's reachable set.
 *
 * Returns a fresh array so callers can mutate it without affecting the
 * source state.
 */
export function collectReferencedAssets(source: AssetReferenceSource): ReferencedAsset[] {
  const root = referenceRootFrom(source);
  const out: ReferencedAsset[] = [];
  pushReference(out, root.faviconAssetId, 'image', 'favicon', 'faviconAssetId');
  for (const [pageIdx, page] of root.pages.entries()) {
    pushReference(
      out,
      page.ogImageAssetId,
      'image',
      'og-image',
      `pages[${String(pageIdx)}].ogImageAssetId`,
    );
    for (const [sectionIdx, section] of page.sections.entries()) {
      collectSectionReferences(
        section,
        `pages[${String(pageIdx)}].sections[${String(sectionIdx)}]`,
        out,
      );
    }
  }
  if (root.header !== undefined) collectSectionReferences(root.header, 'header', out);
  if (root.footer !== undefined) collectSectionReferences(root.footer, 'footer', out);
  collectRichMotionAssetReferences(root.richMotionAssets, out);
  return out;
}

export function collectReferencedAssetIds(source: AssetReferenceSource): Set<string> {
  return new Set(collectReferencedAssets(source).map((ref) => ref.assetId));
}

function isUnfilledAssetId(assetId: unknown): boolean {
  // ADR 0065 D3 + codex review pass 2 finding 1 — substitution tokens like
  // `{{ogImageAssetId}}` are non-empty non-placeholder strings, so the two
  // existing conditions already exclude them from the unfilled set. The
  // explicit comment is here to pin the contract: substitution tokens are
  // pre-substitution placeholders the materializer resolves per entry —
  // NOT slots the Owner has to fill manually. If the unfilled-set rule is
  // ever broadened, the substitution-token case must be re-asserted.
  return assetId === '' || assetId === PLACEHOLDER_ASSET_ID;
}

function collectUnfilledElementReferences(
  element: CanvasElement,
  elementPath: string,
  out: UnfilledAssetReference[],
): void {
  if (element.type === 'media') {
    if (isUnfilledAssetId(element.assetId)) {
      out.push({
        role: 'asset',
        path: `${elementPath}.assetId`,
        mediaElementId: element.id,
      });
    }
    if (element.mediaKind === 'video' && isUnfilledAssetId(element.posterAssetId)) {
      out.push({
        role: 'poster',
        path: `${elementPath}.posterAssetId`,
        mediaElementId: element.id,
      });
    }
    return;
  }
  if (element.type === 'tabs') {
    element.tabs.forEach((tab, tabIdx) => {
      tab.elements.forEach((child, childIdx) => {
        collectUnfilledElementReferences(
          child,
          `${elementPath}.tabs[${String(tabIdx)}].elements[${String(childIdx)}]`,
          out,
        );
      });
    });
    return;
  }
  if (element.type === 'collection') {
    // ADR 0063 dec 6 — per-entry instances live in `entries`; walk them so
    // unfilled media assetIds surface in the editor publish-guard hints.
    (element.entries ?? []).forEach((entry, entryIdx) => {
      entry.forEach((child, childIdx) => {
        collectUnfilledElementReferences(
          child,
          `${elementPath}.entries[${String(entryIdx)}][${String(childIdx)}]`,
          out,
        );
      });
    });
    // ADR 0065 D2 + codex review pass 1 — walk customTemplate so an
    // unfilled Image inside the Owner's authored template (`assetId === ''`
    // or `'__placeholder__'`) surfaces in the publish-guard hints just
    // like an unfilled Image anywhere else on the canvas.
    (element.customTemplate ?? []).forEach((child, childIdx) => {
      collectUnfilledElementReferences(
        child,
        `${elementPath}.customTemplate[${String(childIdx)}]`,
        out,
      );
    });
    return;
  }
  if (element.type === 'flow-container') {
    element.items.forEach((item, itemIdx) => {
      collectUnfilledElementReferences(
        item.element,
        `${elementPath}.items[${String(itemIdx)}].element`,
        out,
      );
    });
  }
}

function collectUnfilledSectionReferences(
  section: CanvasSection,
  sectionPath: string,
  out: UnfilledAssetReference[],
): void {
  for (const [elementIdx, element] of section.elements.entries()) {
    collectUnfilledElementReferences(
      element,
      `${sectionPath}.elements[${String(elementIdx)}]`,
      out,
    );
  }
}

export function collectUnfilledAssetReferences(
  source: AssetReferenceSource,
): UnfilledAssetReference[] {
  const root = referenceRootFrom(source);
  const out: UnfilledAssetReference[] = [];
  for (const [pageIdx, page] of root.pages.entries()) {
    for (const [sectionIdx, section] of page.sections.entries()) {
      collectUnfilledSectionReferences(
        section,
        `pages[${String(pageIdx)}].sections[${String(sectionIdx)}]`,
        out,
      );
    }
  }
  if (root.header !== undefined) collectUnfilledSectionReferences(root.header, 'header', out);
  if (root.footer !== undefined) collectUnfilledSectionReferences(root.footer, 'footer', out);
  return out;
}

export function findAssetReferenceErrors(
  source: AssetReferenceSource,
  assets: AssetKindRow[],
): AssetReferenceError[] {
  const kindsById = new Map(assets.map((asset) => [asset.id, asset.kind]));
  const errors: AssetReferenceError[] = [];
  for (const reference of collectReferencedAssets(source)) {
    const actualKind = kindsById.get(reference.assetId);
    if (!actualKind) {
      errors.push({ ...reference, reason: 'missing' });
      continue;
    }
    if (actualKind !== reference.expectedKind) {
      errors.push({ ...reference, reason: 'kind-mismatch', actualKind });
    }
  }
  return errors;
}
