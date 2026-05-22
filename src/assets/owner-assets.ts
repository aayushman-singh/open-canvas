// src/assets/owner-assets.ts
//
// Owner Asset helpers — pure walker functions, DB accessors, and upload
// utilities. This is the single source of truth; the legacy site-assets.ts
// module has been removed.

import { and, eq } from 'drizzle-orm';
import type { CanvasPage, CanvasSiteState, MediaKind } from '../canvas/schema.js';
import { ownerAsset, site } from '../db/schema.js';
import type { Db } from '../db/client.js';

// ---------------------------------------------------------------------------
// Shared asset types (formerly in site-assets.ts)
// ---------------------------------------------------------------------------

export interface ReferencedAsset {
  assetId: string;
  expectedKind: MediaKind;
  role: 'asset' | 'poster';
  path: string;
  mediaElementId: string;
}

export interface AssetKindRow {
  id: string;
  kind: MediaKind;
}

export interface AssetReferenceError extends ReferencedAsset {
  reason: 'missing' | 'kind-mismatch';
  actualKind?: MediaKind;
}

// ---------------------------------------------------------------------------
// Walker helpers (formerly in site-assets.ts)
// ---------------------------------------------------------------------------

/**
 * Walk a snapshot's (or editable site's) pages and return every assetId AND
 * posterAssetId referenced by a media element. Used by:
 *   - publish guard: reject if any referenced id is missing from `owner_asset`.
 *   - public `/assets/:assetId` route: 404 if the request is for an id not
 *     in the current snapshot's reachable set.
 *
 * Returns a fresh array so callers can mutate it without affecting the source
 * pages.
 */
export function collectReferencedAssets(pages: CanvasPage[]): ReferencedAsset[] {
  const out: ReferencedAsset[] = [];
  for (const [pageIdx, page] of pages.entries()) {
    for (const [sectionIdx, section] of page.sections.entries()) {
      for (const [elementIdx, element] of section.elements.entries()) {
        if (element.type !== 'media') continue;
        if (typeof element.assetId === 'string' && element.assetId.length > 0) {
          out.push({
            assetId: element.assetId,
            expectedKind: element.mediaKind,
            role: 'asset',
            path: `pages[${String(pageIdx)}].sections[${String(sectionIdx)}].elements[${String(elementIdx)}].assetId`,
            mediaElementId: element.id,
          });
        }
        if (typeof element.posterAssetId === 'string' && element.posterAssetId.length > 0) {
          out.push({
            assetId: element.posterAssetId,
            expectedKind: 'image',
            role: 'poster',
            path: `pages[${String(pageIdx)}].sections[${String(sectionIdx)}].elements[${String(elementIdx)}].posterAssetId`,
            mediaElementId: element.id,
          });
        }
      }
    }
  }
  return out;
}

export function collectReferencedAssetIds(pages: CanvasPage[]): Set<string> {
  return new Set(collectReferencedAssets(pages).map((ref) => ref.assetId));
}

export function findAssetReferenceErrors(
  pages: CanvasPage[],
  assets: AssetKindRow[],
): AssetReferenceError[] {
  const kindsById = new Map(assets.map((asset) => [asset.id, asset.kind]));
  const errors: AssetReferenceError[] = [];
  for (const reference of collectReferencedAssets(pages)) {
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

// ---------------------------------------------------------------------------
// Owner-specific types and helpers
// ---------------------------------------------------------------------------

export interface OwnerAssetBlob {
  kind: MediaKind;
  mediaType: string;
  bytesBase64: string;
  alt: string;
}

/**
 * Parse a base64 data URL into an OwnerAssetBlob. Fails loudly on any
 * unsupported media type or malformed data URL.
 */
export function dataUrlToOwnerAsset(input: string, alt: string): OwnerAssetBlob {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match) throw new Error('asset data must be a base64 data URL');
  const mediaType = match[1] ?? '';
  const bytesBase64 = match[2] ?? '';
  if (mediaType.startsWith('image/')) return { kind: 'image', mediaType, bytesBase64, alt };
  if (mediaType.startsWith('video/')) return { kind: 'video', mediaType, bytesBase64, alt };
  throw new Error(`unsupported asset media type: ${mediaType}`);
}

/** Read a single Owner Asset by id and customer. Returns null if not found. */
export async function readOwnerAsset(
  database: Db,
  customerId: string,
  assetId: string,
): Promise<{ mediaType: string; bytesBase64: string; kind: MediaKind } | null> {
  const rows = await database
    .select({
      mediaType: ownerAsset.mediaType,
      bytesBase64: ownerAsset.bytesBase64,
      kind: ownerAsset.kind,
    })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, assetId), eq(ownerAsset.customerId, customerId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Build a binary Response for asset bytes. Caches aggressively. */
export function assetResponse(mediaType: string, bytesBase64: string): Response {
  const bytes = Uint8Array.from(atob(bytesBase64), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

// ---------------------------------------------------------------------------
// Replicate / Flux-schnell helpers
// ---------------------------------------------------------------------------

export const MAX_ASSET_DATA_URL_BYTES = 1_500_000;

export const FLUX_ASPECT_PRESETS = [
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '21:9', value: 21 / 9 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '9:16', value: 9 / 16 },
  { label: '9:21', value: 9 / 21 },
] as const;

export function snapToFluxAspectRatio(boxW: number, boxH: number): string {
  const target = boxW / boxH;
  let bestLabel: string = FLUX_ASPECT_PRESETS[0].label;
  let bestDiff = Math.abs(Math.log(FLUX_ASPECT_PRESETS[0].value / target));
  for (const preset of FLUX_ASPECT_PRESETS) {
    const diff = Math.abs(Math.log(preset.value / target));
    if (diff < bestDiff) {
      bestLabel = preset.label;
      bestDiff = diff;
    }
  }
  return bestLabel;
}

interface ReplicatePrediction {
  id: string;
  status: string;
  output: unknown;
  error: unknown;
  logs: unknown;
}

// Owner-driven image generation via Replicate's flux-schnell. Synchronous
// wait (Replicate's `Prefer: wait`, max 60s) — flux-schnell typically returns
// in ~2-5s. Output is returned as base64 bytes to the caller; no row is
// inserted — persistence is the caller's responsibility.
//
// No fallback path: if Replicate fails, the prediction does not succeed, or
// the output is unrecognised, we throw with full context.
export interface AssetUsageElement {
  siteId: string;
  siteName: string;
  publishedAddress: string | null; // subdomain when site is published, null otherwise
  elementId: string;
  source: 'editable' | 'published';
}

/**
 * Find every editable state and every published snapshot owned by this customer
 * that references the given asset id. Used by the delete-confirm modal.
 *
 * Returns one entry per (siteId, elementId, source) tuple so the UI can render
 * a precise impact list. An asset referenced by both the editable state and
 * the published snapshot of the same site produces two entries.
 */
export async function findAssetUsage(
  database: Db,
  customerId: string,
  assetId: string,
): Promise<AssetUsageElement[]> {
  const sites = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      editableState: site.editableState,
      publishedSnapshot: site.publishedSnapshot,
      publishedVersion: site.publishedVersion,
    })
    .from(site)
    .where(eq(site.customerId, customerId));

  const out: AssetUsageElement[] = [];
  const seen = new Set<string>();
  function pushUnique(entry: AssetUsageElement) {
    const key = entry.siteId + '|' + entry.elementId + '|' + entry.source;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  }

  for (const s of sites) {
    for (const ref of collectReferencedAssets(s.editableState.pages)) {
      if (ref.assetId !== assetId) continue;
      pushUnique({
        siteId: s.id,
        siteName: s.name,
        publishedAddress: s.publishedVersion > 0 ? s.subdomain : null,
        elementId: ref.mediaElementId,
        source: 'editable',
      });
    }
    if (s.publishedSnapshot) {
      for (const ref of collectReferencedAssets(s.publishedSnapshot.pages)) {
        if (ref.assetId !== assetId) continue;
        pushUnique({
          siteId: s.id,
          siteName: s.name,
          publishedAddress: s.publishedVersion > 0 ? s.subdomain : null,
          elementId: ref.mediaElementId,
          source: 'published',
        });
      }
    }
  }
  return out;
}

/**
 * Return a NEW editable state with every reference to assetId (both assetId
 * and posterAssetId on media elements) replaced with empty string. Used by the
 * delete-cascade flow in Task 14 to leave broken slots visible to the owner
 * rather than dangling references.
 */
export function clearAssetReferences(
  state: CanvasSiteState,
  assetId: string,
): CanvasSiteState {
  return {
    ...state,
    pages: state.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        elements: section.elements.map((element) => {
          if (element.type !== 'media') return element;
          const cleared = { ...element };
          if (element.assetId === assetId) cleared.assetId = '';
          if (element.posterAssetId === assetId) cleared.posterAssetId = '';
          return cleared;
        }),
      })),
    })),
  };
}

export async function generateImageViaReplicate(
  token: string,
  prompt: string,
  aspectRatio: string,
): Promise<{ bytesBase64: string; mediaType: string }> {
  const replicateResponse = await fetch(
    'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio } }),
    },
  );
  if (!replicateResponse.ok) {
    const text = await replicateResponse.text();
    throw new Error(
      `replicate prediction request failed: status=${String(replicateResponse.status)} body=${text}`,
    );
  }
  const prediction: ReplicatePrediction = await replicateResponse.json();
  if (prediction.status !== 'succeeded') {
    throw new Error(
      `replicate prediction not succeeded: status=${prediction.status} id=${prediction.id} error=${JSON.stringify(prediction.error)} logs=${JSON.stringify(prediction.logs)}`,
    );
  }
  const output = prediction.output;
  const outputUrl =
    typeof output === 'string'
      ? output
      : Array.isArray(output) && typeof output[0] === 'string'
        ? output[0]
        : null;
  if (!outputUrl) {
    throw new Error(`replicate prediction output unrecognised: ${JSON.stringify(output)}`);
  }
  const imageResponse = await fetch(outputUrl);
  if (!imageResponse.ok) {
    throw new Error(
      `replicate output fetch failed: status=${String(imageResponse.status)} url=${outputUrl}`,
    );
  }
  const mediaType = imageResponse.headers.get('content-type') ?? 'image/webp';
  if (!mediaType.startsWith('image/')) {
    throw new Error(`replicate output media type not an image: ${mediaType}`);
  }
  const buffer = new Uint8Array(await imageResponse.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i] as number);
  }
  const bytesBase64 = btoa(binary);
  return { bytesBase64, mediaType };
}
