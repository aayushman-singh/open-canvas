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

// ADR 0065 D2 + codex review pass 5 finding 2 — the publish-guard walks
// in site-assets.ts (`collectElementReferences`,
// `collectUnfilledElementReferences`) recurse into `customTemplate` per pass
// 1 F4 so a fixed assetId inside the template participates in publish-guard
// + cascade detection. The DELETE-asset endpoint owned a SEPARATE pair of
// walks here that stopped at the top-level element, so:
//
//   * the confirm-required report under-counted references for a
//     customTemplate-only assetId (Owner saw "0 references" and had no
//     warning before deletion);
//   * the `clearAssetReferences` cascade left customTemplate's assetId
//     stale after delete, so the next publish failed the publish guard
//     (which does walk customTemplate) with a missing-asset error.
//
// Both walks now mirror the site-assets.ts recursion: media at the top
// level, recurse into Tabs panels, and recurse into Collection's
// `customTemplate` (entries[][] is materializer output — outside the
// editor-state walk). The recursion keeps shape parity with site-assets.ts
// so the two pipelines never diverge again.
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

function collectFromElement(out: AssetReference[], params: CollectFromElementParams): void {
  const { element, assetId, seen, pageSlug } = params;
  if (typeof element !== 'object' || element === null) return;
  const el = element as {
    id?: string;
    type?: string;
    assetId?: string;
    mediaKind?: string;
    posterAssetId?: string;
    tabs?: Array<{ elements?: unknown[] }>;
    customTemplate?: unknown[];
  };
  if (el.type === 'media' && typeof el.id === 'string') {
    if (el.assetId === assetId) {
      const key = `${pageSlug}|${el.id}|asset`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          siteId: params.siteId,
          siteName: params.siteName,
          source: params.source,
          publishedAddress: params.publishedAddress,
          pageSlug,
          elementId: el.id,
          role: 'asset',
        });
      }
    }
    if (el.mediaKind === 'video' && el.posterAssetId === assetId) {
      const key = `${pageSlug}|${el.id}|poster`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          siteId: params.siteId,
          siteName: params.siteName,
          source: params.source,
          publishedAddress: params.publishedAddress,
          pageSlug,
          elementId: el.id,
          role: 'poster',
        });
      }
    }
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

// ADR 0065 D2 + codex review pass 5 finding 2 — recursive element-level
// clear. Mirrors `collectFromElement` above: clear media assetIds at the
// top level, recurse Tabs panels, recurse Collection's `customTemplate`.
// `entries[][]` is materializer output (regenerated at publish time) so
// the editor-state walk skips it.
//
// Returns the same reference when no change is needed so the caller's
// `=== element` check decides whether to bubble the section-changed flag
// — matching the original walk's identity-as-no-op contract.
function clearElementAssetReferences(element: unknown, assetId: string): unknown {
  if (typeof element !== 'object' || element === null) return element;
  const el = element as Record<string, unknown>;
  if (el.type === 'media') {
    let next: Record<string, unknown> = el;
    if (next.assetId === assetId) {
      next = { ...next, assetId: '' };
    }
    if (next.mediaKind === 'video' && next.posterAssetId === assetId) {
      next = { ...next, posterAssetId: '' };
    }
    return next === el ? element : next;
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
    if (!tabsChanged) return element;
    return { ...el, tabs };
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
    if (!templateChanged) return element;
    return { ...el, customTemplate };
  }
  return element;
}
