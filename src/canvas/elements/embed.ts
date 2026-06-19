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
//   - `referrerpolicy="strict-origin-when-cross-origin"` so the visitor's
//     full Published-Site URL never leaks into platform analytics — only
//     the scheme+host is sent. YouTube and most providers refuse to play
//     when no Referer is sent at all (player error 153, "Video player
//     configuration error"), so a strict-origin compromise unblocks the
//     player while still hiding the page path / query.
//   - `loading="lazy"` defers off-screen embeds — the editor's snapshot can
//     contain dozens of YouTube cards without each one fetching player JS
//     on first paint.
//
// Failure mode:
//   - Invalid URL → renders a labelled `<div class="opencanvas-embed-invalid">`
//     placeholder. No iframe is emitted, no CSP token is contributed; the
//     element wrapper still sits in the layout so the page geometry doesn't
//     collapse. This is the "fail loudly, but inside the viewport" choice:
//     a missing iframe in the DOM would be a silent skip.

import { escapeAttr } from './render-utils.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import type { BaseElement } from '../schema.js';
import { resolveEmbed } from '../../embed/oembed-resolve.js';

export const EMBED_DRILL_IN_REDUCED_MOTION_MODES = ['instant', 'allow'] as const;
export type EmbedDrillInReducedMotionMode =
  (typeof EMBED_DRILL_IN_REDUCED_MOTION_MODES)[number];

export interface EmbedElement extends BaseElement {
  type: 'embed';
  url: string;
  title?: string;
  /** width / height. Defaults to 16/9 when undefined. */
  aspectRatio?: number;
  /** Opens this embed URL in a schema-owned fullscreen iframe overlay. */
  drillInEnabled?: boolean;
  /** Reduced-motion policy for the drill-in overlay open/close shell. */
  drillInReducedMotion?: EmbedDrillInReducedMotionMode;
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
    return `<div class="opencanvas-embed-invalid" data-opencanvas-embed-status="invalid" role="img" aria-label="Invalid embed URL"></div>`;
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
  const drillIn = drillInAttrs(el, resolved.embedUrl, titleAttr);

  return (
    `<div class="opencanvas-embed" data-opencanvas-embed-provider="${escapeAttr(resolved.providerName)}"${aspectAttr}${drillIn.rootAttrs}>` +
    `<iframe ` +
    `src="${src}" ` +
    `width="100%" height="100%" ` +
    `sandbox="${EMBED_IFRAME_SANDBOX}" ` +
    `referrerpolicy="strict-origin-when-cross-origin" ` +
    `loading="lazy" ` +
    `title="${titleAttr}" ` +
    `allowfullscreen` +
    `></iframe>` +
    drillIn.triggerHtml +
    `</div>`
  );
}

function drillInAttrs(
  el: EmbedElement,
  resolvedSrc: string,
  title: string,
): { rootAttrs: string; triggerHtml: string } {
  if (el.drillInEnabled !== true) return { rootAttrs: '', triggerHtml: '' };
  const reducedMotion = el.drillInReducedMotion ?? 'instant';
  if (!(EMBED_DRILL_IN_REDUCED_MOTION_MODES as readonly string[]).includes(reducedMotion)) {
    throw new Error(
      `Embed element ${el.id}: drillInReducedMotion has malformed value ${JSON.stringify(
        reducedMotion,
      )}; expected one of ${EMBED_DRILL_IN_REDUCED_MOTION_MODES.join(' | ')}.`,
    );
  }
  const titleAttr = escapeAttr(title);
  const rootAttrs =
    ` data-opencanvas-embed-drill-in="true"` +
    ` data-opencanvas-embed-drill-in-src="${escapeAttr(resolvedSrc)}"` +
    ` data-opencanvas-embed-drill-in-title="${titleAttr}"` +
    ` data-opencanvas-embed-drill-in-reduced-motion="${escapeAttr(reducedMotion)}"` +
    ` role="button" tabindex="0" aria-label="Open ${titleAttr} fullscreen"`;
  const triggerHtml =
    `<button type="button" class="opencanvas-embed-drill-in-trigger" ` +
    `data-opencanvas-embed-drill-in-trigger aria-label="Open ${titleAttr} fullscreen">` +
    `Open fullscreen</button>`;
  return { rootAttrs, triggerHtml };
}

export const EMBED_RECIPE_ID = 'embed-card' as const;

export const embedInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'text', label: 'URL', path: 'url', placeholder: 'https://youtube.com/...' },
    { kind: 'text', label: 'Title', path: 'title', placeholder: 'Title (optional)' },
    { kind: 'checkbox', label: 'Drill-in overlay', path: 'drillInEnabled' },
    {
      kind: 'select',
      label: 'Drill-in reduced motion',
      path: 'drillInReducedMotion',
      options: EMBED_DRILL_IN_REDUCED_MOTION_MODES,
      defaultValue: 'instant',
    },
    {
      kind: 'select-mapped',
      label: 'Aspect ratio',
      path: 'aspectRatio',
      options: [
        { label: '16:9', value: 16 / 9 },
        { label: '4:3', value: 4 / 3 },
        { label: '1:1', value: 1 },
        { label: '21:9', value: 21 / 9 },
      ],
      defaultValue: DEFAULT_EMBED_ASPECT_RATIO,
      tolerance: 0.01,
    },
  ],
};

export const embedSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'embed',
      sidebarLabel: 'Embed',
      sidebarTip: 'Embed external content (YouTube, maps, etc.)',
      factoryName: 'embed',
    },
  ],
};

export const embedAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    url: {
      type: 'string',
      description: 'Embed URL (YouTube, Vimeo, etc). Embed elements only.',
    },
    title: {
      type: 'string',
      description: 'Embed title. Embed elements only.',
    },
    aspectRatio: {
      type: 'number',
      description: 'Embed aspect ratio (default 16/9). Embed elements only.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.url !== undefined) {
      if (typeof args.url !== 'string') throw new Error('url must be a string');
      patch.url = args.url;
    }
    if (args.title !== undefined) {
      if (typeof args.title !== 'string') throw new Error('title must be a string');
      patch.title = args.title;
    }
    if (args.aspectRatio !== undefined) {
      if (typeof args.aspectRatio !== 'number' || !Number.isFinite(args.aspectRatio)) {
        throw new Error('aspectRatio must be a number');
      }
      patch.aspectRatio = args.aspectRatio;
    }
    return patch;
  },
};
