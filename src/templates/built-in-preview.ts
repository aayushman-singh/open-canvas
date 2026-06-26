import { renderCanvasSnapshot } from '../canvas/render.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import type { EditableSite, PublishedSnapshot } from '../canvas/schema.js';
import { injectInteractiveRuntime } from '../interactive/inject.js';
import { resolveStyleKitWithCustom } from '../themes/custom-resolve.js';
import { buildStyleKitCss } from '../canvas/style-kits.js';
import { instantiateTemplate } from './registry.js';

const builtInTemplatePreviewPublishedAt = '2026-05-22T00:00:00.000Z';

function snapshotFromState(state: EditableSite): PublishedSnapshot {
  return {
    ...state,
    version: 1,
    publishedAt: builtInTemplatePreviewPublishedAt,
  };
}

function renderPreviewBodyHtmlFromState(
  state: EditableSite,
  options: { turnstileSiteKey: string; assetBasePath: string },
): string {
  const snapshot = snapshotFromState(state);
  return injectInteractiveRuntime(
    renderCanvasSnapshot(snapshot, options.assetBasePath, '__template-preview__', {
      turnstileSiteKey: options.turnstileSiteKey,
    }),
    snapshot,
  );
}

/** Body HTML for built-in template picker iframes — full snapshot + interactive runtime. */
export function renderBuiltInTemplatePreviewBodyHtml(
  templateId: string,
  options: { turnstileSiteKey: string; assetBasePath?: string },
): string {
  const state = instantiateTemplate(templateId);
  return renderPreviewBodyHtmlFromState(state, {
    turnstileSiteKey: options.turnstileSiteKey,
    assetBasePath: options.assetBasePath ?? `/dashboard/templates/${templateId}/assets`,
  });
}

/**
 * Body HTML + custom-kit CSS for a built-in seed preview. DB-free: renders
 * straight from the code-defined composition (Option B made the picker read
 * published templates from the DB, so seed previews never resolve overrides).
 */
export function renderBuiltInTemplatePreview(
  templateId: string,
  options: { turnstileSiteKey: string; assetBasePath?: string },
): { html: string; customKitCss: string } {
  const assetBasePath = options.assetBasePath ?? `/dashboard/templates/${templateId}/assets`;
  const state = instantiateTemplate(templateId);
  const html = renderPreviewBodyHtmlFromState(state, {
    turnstileSiteKey: options.turnstileSiteKey,
    assetBasePath,
  });
  const customKitCss =
    state.styleKit === 'custom' ? `\n${buildStyleKitCss('custom', resolveStyleKitWithCustom(state))}` : '';
  return { html, customKitCss };
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
