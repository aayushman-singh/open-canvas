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
  CanvasSiteState,
  MediaKind,
  PublishedSnapshot,
  SymbolMaster,
} from '../canvas/schema.js';

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
    | 'carousel-slide';
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
  symbols?: SymbolMaster[];
}

export type AssetReferenceSource =
  | CanvasPage[]
  | AssetReferenceRoot
  | CanvasSiteState
  | PublishedSnapshot;

function referenceRootFrom(source: AssetReferenceSource): AssetReferenceRoot {
  return Array.isArray(source)
    ? { pages: source }
    : {
        pages: source.pages,
        ...(source.faviconAssetId !== undefined ? { faviconAssetId: source.faviconAssetId } : {}),
        ...(source.header !== undefined ? { header: source.header } : {}),
        ...(source.footer !== undefined ? { footer: source.footer } : {}),
        ...(source.symbols !== undefined ? { symbols: source.symbols } : {}),
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
  if (element.type === 'media') {
    pushReference(
      out,
      element.assetId,
      element.mediaKind,
      'asset',
      `${elementPath}.assetId`,
      element.id,
    );
    pushReference(
      out,
      element.posterAssetId,
      'image',
      'poster',
      `${elementPath}.posterAssetId`,
      element.id,
    );
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
  }
}

function collectSectionReferences(
  section: CanvasSection,
  sectionPath: string,
  out: ReferencedAsset[],
): void {
  pushReference(
    out,
    section.backgroundVideo,
    'video',
    'background-video',
    `${sectionPath}.backgroundVideo`,
  );
  for (const [elementIdx, element] of section.elements.entries()) {
    collectElementReferences(element, `${sectionPath}.elements[${String(elementIdx)}]`, out);
  }
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
  root.symbols?.forEach((symbol, idx) => {
    collectSectionReferences(symbol.section, `symbols[${String(idx)}].section`, out);
  });
  return out;
}

export function collectReferencedAssetIds(source: AssetReferenceSource): Set<string> {
  return new Set(collectReferencedAssets(source).map((ref) => ref.assetId));
}

function collectUnfilledSectionReferences(
  section: CanvasSection,
  sectionPath: string,
  out: UnfilledAssetReference[],
): void {
  for (const [elementIdx, element] of section.elements.entries()) {
    if (element.type !== 'media') continue;
    if (element.assetId === '') {
      out.push({
        role: 'asset',
        path: `${sectionPath}.elements[${String(elementIdx)}].assetId`,
        mediaElementId: element.id,
      });
    }
    if (element.posterAssetId === '') {
      out.push({
        role: 'poster',
        path: `${sectionPath}.elements[${String(elementIdx)}].posterAssetId`,
        mediaElementId: element.id,
      });
    }
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
  root.symbols?.forEach((symbol, idx) => {
    collectUnfilledSectionReferences(symbol.section, `symbols[${String(idx)}].section`, out);
  });
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
