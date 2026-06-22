import { renderCanvasSnapshot } from '../canvas/render.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { injectInteractiveRuntime } from '../interactive/inject.js';
import { instantiateTemplate } from './registry.js';

const builtInTemplatePreviewPublishedAt = '2026-05-22T00:00:00.000Z';

/** Body HTML for built-in template picker iframes — full snapshot + interactive runtime. */
export function renderBuiltInTemplatePreviewBodyHtml(
  templateId: string,
  options: { turnstileSiteKey: string; assetBasePath?: string },
): string {
  // ADR 0061 Phase D — instantiate the composition to get an EditableSite
  // shape the snapshot renderer accepts. Each preview re-materialises, so
  // pool edits between deploys surface on the next preview render.
  const state = instantiateTemplate(templateId);
  const snapshot: PublishedSnapshot = {
    ...state,
    version: 1,
    publishedAt: builtInTemplatePreviewPublishedAt,
  };
  // Template previews have no backing site yet — forms inside a preview
  // cannot submit to a real /__opencanvas/forms/<siteId>/<formId> endpoint. Pass
  // an explicit synthetic id so the renderer's siteId check still passes and
  // any accidental form POST hits a 404 against the forms router instead of
  // a silent double-slash URL.
  return injectInteractiveRuntime(
    renderCanvasSnapshot(
      snapshot,
      options.assetBasePath ?? `/dashboard/templates/${templateId}/assets`,
      '__template-preview__',
      { turnstileSiteKey: options.turnstileSiteKey },
    ),
    snapshot,
  );
}

export async function renderBuiltInTemplatePreviewAssetResponse(
  assetId: string,
  r2: R2Bucket,
): Promise<Response | null> {
  const asset = getSeedAsset(assetId);
  if (!asset) return null;
  const object = await r2.get(asset.r2Key);
  if (!object) {
    throw new Error(
      `template preview asset ${assetId} references missing R2 object ${asset.r2Key}`,
    );
  }
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? asset.mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
