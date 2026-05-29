// src/canvas/elements/embed.ts
//
// EmbedElement interface + render fn. Wave 2 (#8) owner file.
//
// Visitor-facing contract: an Owner pastes a URL into an Embed element. The
// published renderer drops a sandboxed iframe pointing at the resolved
// provider iframe URL (YouTube, Vimeo, Loom, Figma, Spotify, SoundCloud,
// CodePen, Twitter/X) or — when the URL doesn't match any known provider —
// a generic iframe at the raw URL.
//
// Safety:
//   - `sandbox="allow-scripts allow-same-origin allow-popups allow-forms"`
//     is the broadest sandbox that still lets third-party players render
//     interactively; the snapshot's CSP `frame-src` allowlist (built by
//     `src/embed/csp.ts`) is the real isolation, not the sandbox alone.
//   - `referrerpolicy="no-referrer"` so the visitor's Published-Site URL
//     never leaks into platform analytics dashboards.
//   - `loading="lazy"` defers off-screen embeds — the editor's snapshot can
//     contain dozens of YouTube cards without each one fetching player JS
//     on first paint.
//
// Failure mode:
//   - Invalid URL → renders a labelled `<div class="rev01-embed-invalid">`
//     placeholder. No iframe is emitted, no CSP token is contributed; the
//     element wrapper still sits in the layout so the page geometry doesn't
//     collapse. This is the "fail loudly, but inside the viewport" choice:
//     a missing iframe in the DOM would be a silent skip.

import { escapeAttr } from './render-utils.js';
import type { BaseElement } from '../schema.js';
import { resolveEmbed } from '../../embed/oembed-resolve.js';

export interface EmbedElement extends BaseElement {
  type: 'embed';
  url: string;
  title?: string;
  /** width / height. Defaults to 16/9 when undefined. */
  aspectRatio?: number;
}

export interface EmbedRenderCtx {
  styleKit: string;
}

/**
 * The sandbox token set the brief specifies. Defined once so the smoke can
 * import the exact string and assert presence verbatim — drift between this
 * constant and the assertion would otherwise be a silent regression.
 */
export const EMBED_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-forms';

/**
 * Default aspect ratio when the element does not specify one. 16/9 matches
 * every major video provider's player default.
 */
export const DEFAULT_EMBED_ASPECT_RATIO = 16 / 9;

export function renderEmbed(el: EmbedElement, ctx: EmbedRenderCtx): string {
  // ctx.styleKit is part of the shared render context shape; this element
  // doesn't read kit tokens because the iframe content is third-party. We
  // explicitly void it so the unused-parameter lint stays quiet and the
  // signature stays uniform with the other element renderers.
  void ctx;
  const resolved = resolveEmbed(el.url);

  if (resolved.providerName === 'invalid') {
    // No iframe. We still emit a tiny placeholder so the editor preview can
    // distinguish "embed with broken URL" from "no embed configured."
    return `<div class="rev01-embed-invalid" data-rev01-embed-status="invalid" role="img" aria-label="Invalid embed URL"></div>`;
  }

  const titleAttr =
    typeof el.title === 'string' && el.title.length > 0 ? escapeAttr(el.title) : 'Embedded content';
  // The aspectRatio is honoured by the wrapper's CSS sizing (width/height
  // already comes from `box`); we expose it as a data-attribute so the
  // editor's preview surface can read it without re-parsing the element.
  // The renderer never writes inline CSS that depends on it — the iframe
  // fills its wrapper at 100% × 100%, and the wrapper's height/width are
  // set by the element box.
  const aspectAttr =
    typeof el.aspectRatio === 'number' && Number.isFinite(el.aspectRatio) && el.aspectRatio > 0
      ? ` data-aspect-ratio="${escapeAttr(String(el.aspectRatio))}"`
      : ` data-aspect-ratio="${escapeAttr(String(DEFAULT_EMBED_ASPECT_RATIO))}"`;

  // The iframe src is the resolver's `embedUrl`. For known providers the
  // resolver already URL-encoded any user-supplied components; for the
  // generic-iframe path the resolver returns the raw URL — that's expected,
  // because the URL has already gone through WHATWG URL parsing inside
  // `parseEmbedUrl`. We escapeAttr it on the way out as defence-in-depth.
  const src = escapeAttr(resolved.embedUrl);

  return (
    `<div class="rev01-embed" data-rev01-embed-provider="${escapeAttr(resolved.providerName)}"${aspectAttr}>` +
    `<iframe ` +
    `src="${src}" ` +
    `width="100%" height="100%" ` +
    `sandbox="${EMBED_IFRAME_SANDBOX}" ` +
    `referrerpolicy="no-referrer" ` +
    `loading="lazy" ` +
    `title="${titleAttr}" ` +
    `allowfullscreen` +
    `></iframe>` +
    `</div>`
  );
}

export const EMBED_RECIPE_ID = 'embed-card' as const;
