// src/editor-client/body-builders-basic.ts
//
// ADR 0058 Phase 2q.d — body builders for the five primitive element
// types: text, media, action, shape, container. Extracted from
// canvas-client.ts:2820-2995. The inline IIFE twin remains the production
// source-of-truth until ADR 0015 Phase 3 atomic cutover.
//
// resolveActionHref is duplicated as a local helper rather than imported
// from src/canvas/action-href.ts because the editor preview tolerates
// legacy string-typed hrefs (migrateState may not have run yet on a
// session whose first render fires before the migrate pass completes).
// The canonical resolveActionHref does not have the legacy-string branch.
//
// The five builders here never call back into the higher-level orchestrator
// (buildElementBody / buildElementNode), so they sit in the dependency
// tree below those modules without cycles. Tabs and Collection call
// buildElementNode for their children — those live in body-builders-data.ts
// and reach buildElementNode through ctx.

import type {
  ActionElement,
  ContainerElement,
  MediaElement,
  ShapeElement,
  TextElement,
} from '../canvas/schema.js';
import type { ActionHref } from '../canvas/elements/action.js';
import { renderInlineRun } from '../canvas/elements/render-utils.js';
import { renderIconSvg, isIconName } from '../canvas/icons.js';
import { renderFreeformShapeInnerSvg } from '../canvas/shape-freeform.js';

import type { EditorContext, StateContext } from './editor-context.js';
import { isAllowedHref } from './href-utils.js';

// ADR 0064 — resolveActionHrefLocal only reads `ctx.state` to walk the
// pages array for `{ type: 'page' }` href shapes. StateContext is the
// canonical alias that owns `state`; the broader findElement/currentPage
// helpers ride along but are unused here.
export type ResolveActionHrefContext = StateContext;

// ADR 0064 — text body builder forwards each InlineRun through
// `ctx.buildRunNode` to render marks (bold/italic/inline-link). No
// canonical alias owns buildRunNode yet, so the inline `Pick` declares
// the single-verb surface honestly.
export type BuildTextBodyContext = Pick<EditorContext, 'buildRunNode'>;

// ADR 0064 — media body builder composes the owner-gated preview URL
// from `ctx.siteBase`. Single field, no canonical alias yet, so an inline
// `Pick` keeps the surface honest at this call site.
export type BuildMediaBodyContext = Pick<EditorContext, 'siteBase'>;

// ADR 0064 — action body builder forwards to `resolveActionHrefLocal`
// (which rides `StateContext`) and reacts to alt+click by swapping the
// active artboard and panning the camera. The two verbs sit outside the
// canonical aliases; the inline `Pick` intersects them with the alias the
// href resolver needs.
export type BuildActionBodyContext = ResolveActionHrefContext &
  Pick<EditorContext, 'setActivePage' | 'panToPage'>;

// ADR 0064 — shape body builder only reads `ctx.ICON_SVG_MAP` for the
// 'icon' variant. Single-field surface, no canonical alias yet, so the
// inline `Pick` declares it directly.
export type BuildShapeBodyContext = Pick<EditorContext, 'ICON_SVG_MAP'>;

// ADR 0064 — container body builder ignores ctx entirely; the parameter
// only exists to keep the builder dispatcher's call signature uniform
// across all primitive types. An empty `Pick` honestly says "this builder
// touches no editor surface."
export type BuildContainerBodyContext = Pick<EditorContext, never>;

// Client-side mirror of resolveActionHref in src/canvas/action-href.ts.
// String-typed hrefs are tolerated because migrateState may not have run yet
// on a session whose first render fires before the migrate pass completes.
function resolveActionHrefLocal(
  ctx: ResolveActionHrefContext,
  href: ActionHref | string | undefined,
): string {
  if (href && typeof href === 'object' && href.type === 'external') {
    if (typeof href.url !== 'string' || href.url.length === 0) {
      throw new Error('resolveActionHref: external href missing url');
    }
    return href.url;
  }
  if (href && typeof href === 'object' && href.type === 'page') {
    const state = ctx.state;
    if (!state) throw new Error('resolveActionHref: no state');
    for (let pi = 0; pi < state.pages.length; pi++) {
      const page = state.pages[pi];
      if (page && page.id === href.pageId) {
        const base = '/' + page.slug;
        return href.anchor ? base + '#' + href.anchor : base;
      }
    }
    throw new Error('resolveActionHref: missing page id ' + JSON.stringify(href.pageId));
  }
  if (typeof href === 'string') return href;
  throw new Error('resolveActionHref: unknown href shape');
}

export function buildTextBodyImpl(ctx: BuildTextBodyContext, element: TextElement): HTMLElement {
  const tag = element.role === 'heading' ? 'h1' : element.role === 'body' ? 'p' : 'span';
  const node = document.createElement(tag);
  node.className = 'opencanvas-text';
  node.setAttribute('data-role', element.role);
  node.style.fontSize = element.fontSize + 'px';
  node.style.fontWeight = String(element.fontWeight);
  node.style.textAlign = element.align;
  node.style.margin = '0';
  // pinnedStyle["font-family"] must land on the inner text node, not just
  // the wrapper. Every style kit emits a rule like
  // `[data-style-kit="X"] [data-element-type="text"][data-role="Y"] .opencanvas-text
  //   { font-family: var(--opencanvas-kit-font-...) }`
  // which gives .opencanvas-text its own font-family declaration. That
  // breaks inheritance from the wrapper's inline font-family, so the
  // picker would write the value but the visible text would still use the
  // kit default. An inline style here outranks the kit selector.
  const pinnedFontFamily = element.pinnedStyle?.['font-family'];
  if (typeof pinnedFontFamily === 'string' && pinnedFontFamily.length > 0) {
    node.style.fontFamily = pinnedFontFamily;
  }
  const content = Array.isArray(element.content) ? element.content : [];
  for (let i = 0; i < content.length; i++) {
    const run = content[i];
    if (run !== undefined) node.appendChild(ctx.buildRunNode(run));
  }
  return node;
}

// Build the editor-mode preview for a media element. The src points at the
// owner-gated preview route (/api/canvas/sites/:siteId/assets/:assetId),
// NOT the public /assets/:assetId path — visitors only see published assets,
// but the Owner can preview anything they have uploaded BEFORE publish.
//
// The placeholder assetId "__placeholder__" (added when the Owner inserts a
// new media element via the section toolbar) is rendered as a non-resolving
// hint until the Owner uploads. We keep the box visible so the Owner can
// drag/resize it before uploading.
export function buildMediaBodyImpl(ctx: BuildMediaBodyContext, element: MediaElement): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-media';
  node.setAttribute('data-opencanvas-media-kind', element.mediaKind);
  const assetId = typeof element.assetId === 'string' ? element.assetId : '';
  if (assetId.length === 0 || assetId === '__placeholder__') {
    node.textContent =
      element.mediaKind === 'image' ? '[image — upload to preview]' : '[video — upload to preview]';
    return node;
  }
  const previewUrl = ctx.siteBase + '/assets/' + encodeURIComponent(assetId);
  if (element.mediaKind === 'image') {
    const img = document.createElement('img');
    img.setAttribute('src', previewUrl);
    const altText = typeof element.alt === 'string' ? element.alt : '';
    img.setAttribute('alt', altText);
    // Mirror the public renderer's a11y rule: empty alt means decorative,
    // which signals screen readers to skip the image. Without this the
    // editor preview reports differently from the published page.
    if (altText.length === 0) img.setAttribute('aria-hidden', 'true');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = element.fit === 'contain' ? 'contain' : 'cover';
    img.style.display = 'block';
    node.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.setAttribute('src', previewUrl);
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = element.fit === 'contain' ? 'contain' : 'cover';
    video.style.display = 'block';
    const playback = element.playback || {};
    // Same enforcement as the public renderer + validator: autoplay forces
    // muted. We set both attributes via setAttribute so the browser's
    // autoplay policy treats the video as autoplay-eligible.
    if (playback.autoplay) {
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.muted = true;
    } else if (playback.muted) {
      video.setAttribute('muted', '');
      video.muted = true;
    }
    if (playback.loop) video.setAttribute('loop', '');
    if (playback.controls) video.setAttribute('controls', '');
    node.appendChild(video);
  }
  return node;
}

export function buildActionBodyImpl(ctx: BuildActionBodyContext, element: ActionElement): HTMLElement {
  // ADR 0051 dec 3 — ActionElement is a one-of: { href } OR { behavior }.
  // The behavior arm (currently copy-to-clipboard) has no href at all, so
  // calling resolveActionHref(element.href) on it throws "unknown href
  // shape" and crashes site load. Mirror the server-side branching from
  // src/canvas/elements/action.ts:renderAction so the editor handles both
  // arms cleanly.
  let node: HTMLElement;
  if (element.behavior !== undefined) {
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.className = 'opencanvas-action';
    button.setAttribute('data-variant', element.variant);
    if (element.behavior.type === 'copy' && typeof element.behavior.value === 'string') {
      button.setAttribute('data-opencanvas-copy', element.behavior.value);
    }
    node = button;
  } else {
    const anchor = document.createElement('a');
    anchor.className = 'opencanvas-action';
    anchor.setAttribute('data-variant', element.variant);
    anchor.setAttribute('href', resolveActionHrefLocal(ctx, element.href));
    // Plain click selects the action element on canvas (default selection
    // flow). Alt-click navigates instead — internal page hrefs swap the
    // active artboard, external hrefs open in a new tab.
    anchor.addEventListener('click', function (ev: MouseEvent) {
      ev.preventDefault();
      if (!ev.altKey) return;
      ev.stopPropagation();
      if (element.href && element.href.type === 'page') {
        ctx.setActivePage(element.href.pageId);
        // Alt+click on a page-href action is explicit navigation —
        // pan the camera so the target page lands in view.
        // setActivePage is camera-pure; explicit nav opts in.
        ctx.panToPage(element.href.pageId);
        return;
      }
      if (element.href && element.href.type === 'external') {
        if (isAllowedHref(element.href.url)) {
          window.open(element.href.url, '_blank', 'noopener,noreferrer');
        }
      }
    });
    node = anchor;
  }
  // Mirror src/canvas/elements/action.ts:renderAction so the editor
  // preview matches the deployed render byte-for-byte: optional icon SVG
  // first, then each label InlineRun rendered with its full mark set
  // (bold/italic/inline link/etc.). Setting innerHTML on the wrapper is
  // safe because both helpers escape every owner-controlled string at the
  // boundary (renderInlineRun via escapeHtml/escapeAttr; renderIconSvg
  // emits a fixed inline registry). The previous `textContent = labelText`
  // dropped both the icon AND every mark — see ADR 0051 dec 1+2.
  const iconHtml =
    element.iconKind !== undefined && isIconName(element.iconKind)
      ? renderIconSvg(element.iconKind)
      : '';
  // Mirror renderAction's icon-only contract: when every label run has
  // empty text, skip the label container so the editor preview matches the
  // deployed page (no stray `<span></span>` eating the flex gap).
  const labelPlain = element.label.map((run) => run.text).join('');
  const labelHtml = labelPlain.length === 0 ? '' : element.label.map(renderInlineRun).join('');
  node.innerHTML = iconHtml + labelHtml;
  return node;
}

export function buildShapeBodyImpl(ctx: BuildShapeBodyContext, element: ShapeElement): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-shape';
  node.setAttribute('data-variant', element.variant);
  if (
    element.variant === 'freeform' &&
    typeof element.path === 'string' &&
    element.path.length > 0
  ) {
    const render = element.freeformRender ?? 'fill';
    node.setAttribute('data-freeform-render', render);
    node.innerHTML = renderFreeformShapeInnerSvg(element.path, render);
    return node;
  }
  // ADR 0051 dec 2 — variant 'icon' fills the box with an inline SVG glyph
  // (ICON_SVG_MAP is keyed by IconName; renderIconSvg in src/canvas/icons.ts
  // is the server-side renderer that produced the same markup at build
  // time). iconKind is validated against ICON_NAMES at /apply; during
  // editing it can transiently miss the map, in which case we leave the
  // empty-div fallback so the box is still selectable.
  if (
    element.variant === 'icon' &&
    typeof element.iconKind === 'string' &&
    ctx.ICON_SVG_MAP[element.iconKind]
  ) {
    node.setAttribute('data-icon-kind', element.iconKind);
    const svg = ctx.ICON_SVG_MAP[element.iconKind];
    if (svg !== undefined) node.innerHTML = svg;
  }
  return node;
}

export function buildContainerBodyImpl(
  _ctx: BuildContainerBodyContext,
  element: ContainerElement,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-surface';
  node.setAttribute('data-variant', element.variant);
  return node;
}
