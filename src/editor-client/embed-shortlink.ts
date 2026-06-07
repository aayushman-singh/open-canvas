// src/editor-client/embed-shortlink.ts
//
// Editor-side counterpart to POST /api/embed/expand-shortlink. When an owner
// pastes a `https://maps.app.goo.gl/...` or `https://goo.gl/...` URL into an
// embed element's URL field, those short links redirect to the full Google
// Maps app page which sets X-Frame-Options: SAMEORIGIN and refuses to be
// framed - the iframe ends up blank. We optimistically save the typed URL,
// then ask the server to follow the redirect chain and rewrite the saved
// value to the canonical embeddable URL.
//
// Restored from the pre-ADR-0058 IIFE; see canvas-client.ts at commit
// 1236e28^ lines 1151-1186 for the original implementation.

import type { EmbedElement } from '../canvas/elements/embed.js';
import { isShortLinkUrl } from '../embed/expand-short-link.js';
import type {
  PersistContext,
  RenderContext,
  StatusEmitterContext,
} from './editor-context.js';

// ADR 0064 — short-link expansion touches three named clusters: persist
// (authFetch + apiBase to call the expand-shortlink endpoint, scheduleSave
// to debounce the URL rewrite), render (rebuildElement to refresh the
// iframe), and status (setStatus to surface in-flight / success / error).
export type EmbedShortlinkContext = PersistContext & RenderContext & StatusEmitterContext;

export async function maybeExpandEmbedShortLink(
  ctx: EmbedShortlinkContext,
  element: EmbedElement,
  input: HTMLInputElement,
): Promise<void> {
  const url = element.url;
  if (typeof url !== 'string' || !isShortLinkUrl(url)) return;
  ctx.setStatus('Expanding short link...');
  try {
    const res = await ctx.authFetch(ctx.apiBase + '/embed/expand-shortlink', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: true; finalUrl: string; hops: number }
      | { ok: false; error: string }
      | null;
    if (!res.ok || !body || body.ok !== true || typeof body.finalUrl !== 'string') {
      const detail = body && body.ok === false && typeof body.error === 'string' ? body.error : 'unknown';
      ctx.setStatus(
        'Could not expand short link (' + detail + ') - keeping original URL',
        'error',
      );
      return;
    }
    if (body.finalUrl === url) {
      ctx.setStatus('Short link was already its own destination', 'ok');
      return;
    }
    element.url = body.finalUrl;
    input.value = body.finalUrl;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
    ctx.setStatus('Expanded short link', 'ok');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.setStatus('Short link expansion failed: ' + msg, 'error');
  }
}
