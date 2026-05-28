// src/version/preview-render.ts
//
// Server-side render of a snapshot for the read-only preview view —
// Wave 1 #3.
//
// Per the plan's "Open questions" resolution: the preview path hydrates
// the public renderer directly from the decoded JSON (no Y.Doc bridge in
// the preview hot path). The Y.Doc bridge is only used on the restore
// path where the resulting `EditableSite` is what gets persisted.
//
// The decoded `EditableSite` is wrapped as a synthetic
// `PublishedSnapshot` so the existing `renderCanvasSnapshot` can serve as
// the renderer. We assign `version: 0` and the snapshot's `capturedAt` as
// `publishedAt` — the preview view is informational, not a real publish.

import { eq } from 'drizzle-orm';
import * as Y from 'yjs';

import { renderCanvasSnapshot } from '../canvas/render.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { decodeYDoc } from '../canvas/yjs-projection.js';
import type { Db } from '../db/client.js';
import { siteSnapshot } from '../db/schema.js';

export interface PreviewRenderResult {
  /** HTML for the snapshot's pages, ready to slot into a sandbox iframe. */
  html: string;
  /** When the snapshot was captured (used as `publishedAt` for display). */
  capturedAt: Date;
  /** Reason the snapshot was captured. */
  reason: 'publish' | 'manual';
  /** Owner-supplied label (manual) or null (publish). */
  label: string | null;
  /** Publish version (publish) or null (manual). */
  publishedVersion: number | null;
}

export class PreviewRenderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'PreviewRenderError';
  }
}

/**
 * Decode a snapshot row's bytes and render its HTML.
 *
 * The `assetBasePath` arg matches `renderCanvasSnapshot`'s shape: typically
 * `/assets` so the preview hits the same Owner Asset read path the
 * published site does. We don't auto-default the path — the route layer
 * passes it explicitly so a future custom-domain or CDN front never
 * accidentally falls through to a hard-coded default.
 */
export async function renderSnapshotPreview(
  siteId: string,
  snapshotId: string,
  db: Db,
  assetBasePath: string,
  turnstileSiteKey: string,
): Promise<PreviewRenderResult> {
  const rows = await db
    .select({
      id: siteSnapshot.id,
      siteId: siteSnapshot.siteId,
      yjsSnapshotBytes: siteSnapshot.yjsSnapshotBytes,
      capturedAt: siteSnapshot.capturedAt,
      reason: siteSnapshot.reason,
      label: siteSnapshot.label,
      publishedVersion: siteSnapshot.publishedVersion,
    })
    .from(siteSnapshot)
    .where(eq(siteSnapshot.id, snapshotId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new PreviewRenderError(404, `snapshot ${snapshotId} not found`);
  }
  if (row.siteId !== siteId) {
    // Same boundary as restore: pinned via the route's `:siteId` param.
    throw new PreviewRenderError(404, `snapshot ${snapshotId} does not belong to site ${siteId}`);
  }

  const replayDoc = new Y.Doc();
  Y.applyUpdate(replayDoc, row.yjsSnapshotBytes);
  const state = decodeYDoc(replayDoc);

  // Wrap as a synthetic PublishedSnapshot for the renderer. The renderer
  // does not care that this is a preview — its contract is
  // (PublishedSnapshot, assetBasePath, siteId?) → HTML — and the preview
  // wants the exact same HTML the visitor sees, just rendered against
  // historical state.
  const publishedView: PublishedSnapshot = {
    version: row.publishedVersion ?? 0,
    publishedAt: row.capturedAt.toISOString(),
    styleKit: state.styleKit,
    pages: state.pages,
    ...(state.header !== undefined ? { header: state.header } : {}),
    ...(state.footer !== undefined ? { footer: state.footer } : {}),
    ...(state.customStyleKit !== undefined ? { customStyleKit: state.customStyleKit } : {}),
    ...(state.defaultLocale !== undefined ? { defaultLocale: state.defaultLocale } : {}),
    ...(state.siteNoIndex !== undefined ? { siteNoIndex: state.siteNoIndex } : {}),
    ...(state.darkModeEnabled !== undefined ? { darkModeEnabled: state.darkModeEnabled } : {}),
  };
  const html = renderCanvasSnapshot(publishedView, assetBasePath, siteId, { turnstileSiteKey });

  return {
    html,
    capturedAt: row.capturedAt,
    reason: row.reason,
    label: row.label,
    publishedVersion: row.publishedVersion,
  };
}
