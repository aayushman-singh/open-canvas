// src/assets/delete.ts
//
// DELETE /api/owner/assets/:id — confirm-cascade delete per ADR 0004
// decision 3. The flow:
//
//   1. Find the ownerAsset row by (id, customerId). 404 if not found.
//   2. Compute the affected-sites + affected-pages report by scanning every
//      site the Owner owns and collecting every MediaElement whose
//      `assetId` or `posterAssetId` equals this id.
//   3. When the caller did not pass `?confirm=1`: return 412 with the
//      report. The editor displays "this asset is used in N slots across M
//      sites" and asks the Owner to re-submit with `confirm=1`.
//   4. When `confirm=1`: delete the row (cascade drops slot_history rows),
//      and delete the R2 object UNLESS another ownerAsset row references
//      the same contentHash (cross-Owner shared bytes).

import { and, eq, ne } from 'drizzle-orm';
import type { R2Client } from './r2-client.js';
import type { Db } from '../db/client.js';
import { ownerAsset, site } from '../db/schema.js';
import type { EditableSite, PublishedSnapshot } from '../canvas/schema.js';

export interface DeleteAssetDeps {
  db: Db;
  r2: R2Client;
}

export interface DeleteAssetInput {
  assetId: string;
  customerId: string;
  /** When `false`, the route returns a 412 with the reference report. */
  confirm: boolean;
}

export interface AssetReference {
  siteId: string;
  siteName: string;
  source: 'editable' | 'published';
  publishedAddress: string | null;
  pageSlug: string;
  elementId: string;
  role: 'asset' | 'poster' | 'og-image' | 'favicon';
}

interface OwnerSiteAssetScanRow {
  id: string;
  name: string;
  subdomain: string;
  publishedVersion: number;
  editableState: EditableSite;
  publishedSnapshot: PublishedSnapshot | null;
}

export type DeleteAssetResult =
  | { status: 'not_found' }
  | {
      status: 'confirm_required';
      references: AssetReference[];
    }
  | {
      status: 'deleted';
      references: AssetReference[];
      r2ObjectDeleted: boolean;
    };

export async function deleteOwnerAsset(
  deps: DeleteAssetDeps,
  input: DeleteAssetInput,
): Promise<DeleteAssetResult> {
  const rows = await deps.db
    .select({
      id: ownerAsset.id,
      contentHash: ownerAsset.contentHash,
      r2Key: ownerAsset.r2Key,
    })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, input.assetId), eq(ownerAsset.customerId, input.customerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return { status: 'not_found' };

  const ownerSites = await loadOwnerSites(deps.db, input.customerId);
  const references = collectAssetReferences(ownerSites, input.assetId);
  if (!input.confirm) {
    return { status: 'confirm_required', references };
  }

  for (const siteRow of ownerSites) {
    const cleared = clearAssetReferences(siteRow.editableState, input.assetId);
    if (!cleared.changed) continue;
    await deps.db
      .update(site)
      .set({ editableState: cleared.state })
      .where(and(eq(site.id, siteRow.id), eq(site.customerId, input.customerId)));
  }

  // Cascade deletes drop slot_history rows automatically.
  await deps.db
    .delete(ownerAsset)
    .where(and(eq(ownerAsset.id, input.assetId), eq(ownerAsset.customerId, input.customerId)));

  // Only delete the R2 object when no other ownerAsset row anywhere
  // (any Owner) still references the same contentHash. A different Owner's
  // shared row keeps the bytes alive — orphan-cleanup is a future ADR.
  const siblings = await deps.db
    .select({ id: ownerAsset.id })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.contentHash, row.contentHash), ne(ownerAsset.id, input.assetId)))
    .limit(1);
  let r2ObjectDeleted = false;
  if (siblings.length === 0) {
    r2ObjectDeleted = await deps.r2.delete(row.r2Key);
  }
  return { status: 'deleted', references, r2ObjectDeleted };
}

async function loadOwnerSites(db: Db, customerId: string): Promise<OwnerSiteAssetScanRow[]> {
  return db
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      publishedVersion: site.publishedVersion,
      editableState: site.editableState,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site)
    .where(eq(site.customerId, customerId));
}

function collectAssetReferences(
  ownerSites: OwnerSiteAssetScanRow[],
  assetId: string,
): AssetReference[] {
  const out: AssetReference[] = [];
  for (const siteRow of ownerSites) {
    collectFromPages(
      out,
      siteRow.id,
      siteRow.name,
      'editable',
      null,
      siteRow.editableState,
      assetId,
    );
    if (siteRow.publishedSnapshot) {
      collectFromPages(
        out,
        siteRow.id,
        siteRow.name,
        'published',
        siteRow.publishedVersion > 0 ? siteRow.subdomain : null,
        siteRow.publishedSnapshot,
        assetId,
      );
    }
  }
  return out;
}

function collectFromPages(
  out: AssetReference[],
  siteId: string,
  siteName: string,
  source: 'editable' | 'published',
  publishedAddress: string | null,
  state:
    | EditableSite
    | PublishedSnapshot
    | { pages: EditableSite['pages']; faviconAssetId?: string },
  assetId: string,
): void {
  const seen = new Set<string>();
  if (state.faviconAssetId === assetId) {
    const key = 'site|favicon|favicon';
    seen.add(key);
    out.push({
      siteId,
      siteName,
      source,
      publishedAddress,
      pageSlug: '',
      elementId: 'site',
      role: 'favicon',
    });
  }
  for (const page of state.pages) {
    if (page.ogImageAssetId === assetId) {
      const key = `${page.slug}|page|og-image`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          siteId,
          siteName,
          source,
          publishedAddress,
          pageSlug: page.slug,
          elementId: 'page',
          role: 'og-image',
        });
      }
    }
    for (const section of page.sections) {
      for (const element of section.elements) {
        collectFromElement(out, {
          siteId,
          siteName,
          source,
          publishedAddress,
          pageSlug: page.slug,
          element,
          assetId,
          seen,
        });
      }
    }
  }
}

// ADR 0065 D2 + codex review pass 5 finding 2 + pass 6 finding 3 — the
// publish-guard walks in site-assets.ts (`collectElementReferences`,
// `collectUnfilledElementReferences`) are the source of truth for
// "what counts as an asset reference on an element". The DELETE-asset
// endpoint's walks here MUST mirror that exact dispatch — every asset-
// bearing element type, every asset-bearing field — or the cascade
// goes half-blind:
//
//   * confirm-required under-counts references → Owner sees "0
//     references" and has no warning before deletion;
//   * `clearAssetReferences` leaves stale asset ids on element fields
//     the publish guard DOES check → next publish fails with a missing-
//     asset error pointing at a slot the cascade should have cleared.
//
// Pass 5 F2 mirrored customTemplate recursion. Pass 6 F3 extends to
// full parity: `elementStyle.backgroundImageAssetId` on any element,
// `nav.logoAssetId`, `carousel.slides[].assetId`. The video poster +
// recursion shapes (tabs panels, collection customTemplate) already
// matched site-assets.ts.
//
// `entries[][]` is materializer output (regenerated at publish time
// from `customTemplate`), so the editor-state walk skips it — same
// rule as site-assets.ts editor-state branch. The publish guard's
// snapshot walk DOES recurse entries, but a DELETE only mutates
// editableState; the publish snapshot is regenerated from editable
// at the next publish.
//
// If a new element type or asset-bearing field is added to the schema,
// extend BOTH this walker AND site-assets.ts's collectElementReferences
// / collectUnfilledElementReferences. Drift between the two pipelines
// is the bug class pass 6 F3 closed.
interface CollectFromElementParams {
  siteId: string;
  siteName: string;
  source: 'editable' | 'published';
  publishedAddress: string | null;
  pageSlug: string;
  element: unknown;
  assetId: string;
  seen: Set<string>;
}

function pushElementReference(
  out: AssetReference[],
  params: CollectFromElementParams,
  elementId: string,
  role: AssetReference['role'],
  keySuffix: string,
): void {
  const key = `${params.pageSlug}|${elementId}|${keySuffix}`;
  if (params.seen.has(key)) return;
  params.seen.add(key);
  out.push({
    siteId: params.siteId,
    siteName: params.siteName,
    source: params.source,
    publishedAddress: params.publishedAddress,
    pageSlug: params.pageSlug,
    elementId,
    role,
  });
}

function collectFromElement(out: AssetReference[], params: CollectFromElementParams): void {
  const { element, assetId } = params;
  if (typeof element !== 'object' || element === null) return;
  const el = element as {
    id?: string;
    type?: string;
    assetId?: string;
    mediaKind?: string;
    posterAssetId?: string;
    logoAssetId?: string;
    elementStyle?: { backgroundImageAssetId?: string };
    slides?: Array<{ assetId?: string }>;
    tabs?: Array<{ elements?: unknown[] }>;
    customTemplate?: unknown[];
  };
  const elementId = typeof el.id === 'string' ? el.id : '';

  // Pass 6 F3 — elementStyle.backgroundImageAssetId on ANY element type
  // (mirrors site-assets.ts collectElementReferences first push). The
  // role 'asset' is reused because AssetReference.role on the DELETE
  // walker's contract today carries the four cascade-actionable roles
  // (asset / poster / og-image / favicon). Adding 'element-bg-image'
  // here would be a breaking API change for the route + UI consumers
  // — instead we report the reference under 'asset' so the Owner sees
  // "this slot uses this asset" with the element id, and the cascade
  // path clears the elementStyle field below.
  if (
    elementId !== '' &&
    el.elementStyle &&
    typeof el.elementStyle === 'object' &&
    el.elementStyle.backgroundImageAssetId === assetId
  ) {
    pushElementReference(out, params, elementId, 'asset', 'element-bg-image');
  }

  if (el.type === 'media' && elementId !== '') {
    if (el.assetId === assetId) {
      pushElementReference(out, params, elementId, 'asset', 'asset');
    }
    if (el.mediaKind === 'video' && el.posterAssetId === assetId) {
      pushElementReference(out, params, elementId, 'poster', 'poster');
    }
    return;
  }
  if (el.type === 'nav' && elementId !== '') {
    if (el.logoAssetId === assetId) {
      pushElementReference(out, params, elementId, 'asset', 'nav-logo');
    }
    return;
  }
  if (el.type === 'carousel' && elementId !== '' && Array.isArray(el.slides)) {
    el.slides.forEach((slide, slideIdx) => {
      if (slide && typeof slide === 'object' && slide.assetId === assetId) {
        pushElementReference(out, params, elementId, 'asset', `carousel-slide-${String(slideIdx)}`);
      }
    });
    return;
  }
  if (el.type === 'tabs' && Array.isArray(el.tabs)) {
    for (const tab of el.tabs) {
      if (!tab || !Array.isArray(tab.elements)) continue;
      for (const child of tab.elements) {
        collectFromElement(out, { ...params, element: child });
      }
    }
    return;
  }
  if (el.type === 'collection' && Array.isArray(el.customTemplate)) {
    for (const child of el.customTemplate) {
      collectFromElement(out, { ...params, element: child });
    }
  }
}

function clearAssetReferences(
  state: EditableSite,
  assetId: string,
): { changed: false; state: EditableSite } | { changed: true; state: EditableSite } {
  let rootChanged = false;
  let rootState = state;
  if (state.faviconAssetId === assetId) {
    const { faviconAssetId: _removed, ...rest } = state;
    void _removed;
    rootState = rest;
    rootChanged = true;
  }
  let pagesChanged = false;
  const pages = rootState.pages.map((page) => {
    let pageChanged = page.ogImageAssetId === assetId;
    const sections = page.sections.map((section) => {
      let sectionChanged = false;
      const elements = section.elements.map((element) => {
        const cleared = clearElementAssetReferences(element, assetId);
        if (cleared === element) return element;
        sectionChanged = true;
        return cleared as (typeof section.elements)[number];
      });
      if (!sectionChanged) return section;
      pageChanged = true;
      return { ...section, elements };
    });
    if (!pageChanged) return page;
    pagesChanged = true;
    const nextPage = { ...page, sections };
    if (nextPage.ogImageAssetId === assetId) {
      delete nextPage.ogImageAssetId;
    }
    return nextPage;
  });

  if (!rootChanged && !pagesChanged) return { changed: false, state };
  return { changed: true, state: { ...rootState, pages } };
}

// ADR 0065 D2 + codex review pass 5 finding 2 + pass 6 finding 3 —
// recursive element-level clear, mirroring `collectFromElement` above
// for full parity with site-assets.ts's element walker. Every asset-
// bearing field the reference walker reports must also be cleared
// here, or the next publish trips the guard on a field the cascade
// failed to drain:
//
//   * `elementStyle.backgroundImageAssetId` on ANY element — clear to ''
//     (empty string is the "no asset" sentinel the schema treats as
//     absent, matching `isUnfilledAssetId('')` in site-assets.ts).
//   * `media.assetId` + `media.posterAssetId` (video only)
//   * `nav.logoAssetId`
//   * `carousel.slides[].assetId`
//   * recurse `tabs.tabs[].elements`
//   * recurse `collection.customTemplate`
//
// `entries[][]` is materializer output (regenerated at publish from
// `customTemplate`), so the editor-state walk skips it — same rule as
// site-assets.ts editor-state branch.
//
// Returns the same reference when no change is needed so the caller's
// `=== element` check decides whether to bubble the section-changed flag
// — matching the original walk's identity-as-no-op contract.
function clearElementAssetReferences(element: unknown, assetId: string): unknown {
  if (typeof element !== 'object' || element === null) return element;
  const el = element as Record<string, unknown>;
  let next: Record<string, unknown> = el;
  let changed = false;

  // Pass 6 F3 — `elementStyle.backgroundImageAssetId` lives on the
  // BaseElement and applies to every element type. Clear independently
  // before the type-specific dispatch so an Image with both an
  // `assetId` AND an `elementStyle.backgroundImageAssetId` pointing at
  // the deleted asset (yes, that combination is legal — the element
  // body is the media, the elementStyle.backgroundImage is decorative)
  // gets BOTH fields cleared in one walk.
  if (next.elementStyle && typeof next.elementStyle === 'object') {
    const style = next.elementStyle as Record<string, unknown>;
    if (style.backgroundImageAssetId === assetId) {
      const { backgroundImageAssetId: _removed, ...restStyle } = style;
      void _removed;
      next = { ...next, elementStyle: restStyle };
      changed = true;
    }
  }

  if (el.type === 'media') {
    if (next.assetId === assetId) {
      next = { ...next, assetId: '' };
      changed = true;
    }
    if (next.mediaKind === 'video' && next.posterAssetId === assetId) {
      next = { ...next, posterAssetId: '' };
      changed = true;
    }
    return changed ? next : element;
  }
  if (el.type === 'nav') {
    if (next.logoAssetId === assetId) {
      next = { ...next, logoAssetId: '' };
      changed = true;
    }
    return changed ? next : element;
  }
  if (el.type === 'carousel' && Array.isArray(el.slides)) {
    const slidesIn = el.slides as unknown[];
    let slidesChanged = false;
    const slides = slidesIn.map((slide) => {
      if (typeof slide !== 'object' || slide === null) return slide;
      const slideRec = slide as Record<string, unknown>;
      if (slideRec.assetId === assetId) {
        slidesChanged = true;
        return { ...slideRec, assetId: '' };
      }
      return slide;
    });
    if (slidesChanged) {
      next = { ...next, slides };
      changed = true;
    }
    return changed ? next : element;
  }
  if (el.type === 'tabs' && Array.isArray(el.tabs)) {
    const tabsIn = el.tabs as unknown[];
    let tabsChanged = false;
    const tabs = tabsIn.map((tab) => {
      if (typeof tab !== 'object' || tab === null) return tab;
      const tabRec = tab as Record<string, unknown>;
      if (!Array.isArray(tabRec.elements)) return tab;
      const panelIn = tabRec.elements as unknown[];
      let panelChanged = false;
      const panelElements = panelIn.map((child) => {
        const cleared = clearElementAssetReferences(child, assetId);
        if (cleared === child) return child;
        panelChanged = true;
        return cleared;
      });
      if (!panelChanged) return tab;
      tabsChanged = true;
      return { ...tabRec, elements: panelElements };
    });
    if (tabsChanged) {
      next = { ...next, tabs };
      changed = true;
    }
    return changed ? next : element;
  }
  if (el.type === 'collection' && Array.isArray(el.customTemplate)) {
    const templateIn = el.customTemplate as unknown[];
    let templateChanged = false;
    const customTemplate = templateIn.map((child) => {
      const cleared = clearElementAssetReferences(child, assetId);
      if (cleared === child) return child;
      templateChanged = true;
      return cleared;
    });
    if (templateChanged) {
      next = { ...next, customTemplate };
      changed = true;
    }
    return changed ? next : element;
  }
  return changed ? next : element;
}
