// src/editor-client/collection-preview.ts
//
// ADR 0063 dec 5 — editor-only placeholder cards for Collection elements.
//
// An empty Collection on the canvas is visually indistinguishable from
// "nothing was added" (the canonical renderer in src/canvas/elements/
// collection.ts emits only an empty `.opencanvas-collection` frame). The
// Owner needs some card-shaped DOM the moment they drop a Collection so
// they can recognise the layout and discover the inspector controls.
//
// Behaviour:
//   * For every `[data-element-type="collection"]` wrapper in the editor
//     DOM whose source binding is unset (no `collectionSlug`) OR whose
//     binding resolves to zero entries, mount three canned placeholder
//     cards + a banner explaining the placeholder status.
//   * For wrappers whose binding resolves to >=1 entry, ensure any
//     previously-mounted placeholder DOM is removed (so toggling a slug
//     in the inspector clears the placeholders even before Phase 2B's
//     materializer fills the frame with real cards).
//   * Editor-only: nothing in src/canvas/render.ts or src/interactive/
//     inject.ts (the publish renderer) calls into this module. Source
//     guard in collection-preview.smoke.ts asserts no canvas/publish file
//     imports collection-preview at build time.
//
// Failure path (loud, per CLAUDE.md no-fallback rule):
//   * If a Collection wrapper has no inner `.opencanvas-collection`
//     frame, we skip it with a console.warn — the wrapper shape drifted
//     and the Phase 2B materializer would also miss it.
//   * Phase 2B's materializer is expected to stamp
//     `data-collection-matched-count="N"` onto the frame when it has
//     real entries. Absence of that attribute means "no real cards" and
//     we render placeholders — the materializer is the sole writer; its
//     absence is the editor's signal that nothing real is mounted.

import type { EditorContext } from './editor-context.js';
import { cssEscape } from './css-escape.js';

/** Class on the editor-only chrome we mount. Used as the idempotency
 *  marker — re-running the augmenter strips any prior chrome first. */
const PREVIEW_ROOT_CLASS = 'opencanvas-collection-preview';

/** Data-attr the Phase 2B materializer writes onto the Collection frame
 *  when it has matched real entries. `data-collection-matched-count="N"`
 *  with N >= 1 means "real cards are mounted, hide placeholders." Any
 *  other value (absent, "0", non-numeric, negative) means "no real
 *  cards" and we render placeholders. */
const MATCHED_COUNT_ATTR = 'data-collection-matched-count';

interface PlaceholderCard {
  title: string;
  excerpt: string;
  /** CSS gradient used as the image stand-in. The ADR forbids a real
   *  asset (placeholders must never look real enough to be confused
   *  with an actual entry); a gradient is unambiguous editor chrome. */
  gradient: string;
}

const PLACEHOLDER_CARDS: readonly PlaceholderCard[] = [
  {
    title: 'Sample entry one',
    excerpt:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.',
    gradient: 'linear-gradient(135deg, #d8e6f5 0%, #a8c4e0 100%)',
  },
  {
    title: 'Sample entry two',
    excerpt:
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.',
    gradient: 'linear-gradient(135deg, #f0e0d6 0%, #d6b9a0 100%)',
  },
  {
    title: 'Sample entry three',
    excerpt:
      'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla.',
    gradient: 'linear-gradient(135deg, #e0e8d8 0%, #b8c8a8 100%)',
  },
];

/** Read the Collection frame's source binding to compose the banner
 *  line. The frame is the public-renderer output from renderCollection
 *  in src/canvas/elements/collection.ts; we read `data-collection-slug`
 *  rather than re-doing the lookup through ctx.findElement because the
 *  DOM is already authoritative at this point (renderAll just wrote it).
 *  Falls back to "unset" when the attribute is empty or absent. */
function sourceLabel(frame: Element | null): string {
  if (!frame) return 'unset';
  const slug = frame.getAttribute('data-collection-slug');
  if (slug === null || slug.length === 0) return 'unset';
  return slug;
}

/** Decide whether the Collection wrapper needs placeholder chrome.
 *  Returns true when either:
 *   * The collection-slug attribute on the inner frame is empty
 *     (unbound), OR
 *   * The matched-count attribute is absent / "0" / non-positive.
 *  Returns false when the materializer has stamped a positive matched
 *  count (Phase 2B writes this), meaning real cards are rendered inside
 *  the frame and placeholders must hide. */
function shouldRenderPlaceholders(wrapper: HTMLElement): boolean {
  const frame = wrapper.querySelector('.opencanvas-collection');
  if (!frame) {
    // The canonical renderer always emits the .opencanvas-collection
    // child. Absence means the wrapper isn't actually a Collection
    // (legacy DOM, drift) — don't render chrome onto it.
    return false;
  }
  const slug = frame.getAttribute('data-collection-slug');
  if (slug === null || slug.length === 0) return true;
  const countAttr = frame.getAttribute(MATCHED_COUNT_ATTR);
  if (countAttr === null) return true;
  const parsed = Number.parseInt(countAttr, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return true;
  return false;
}

/** Strip any prior preview chrome the augmenter mounted. Idempotent so
 *  re-running the augmenter after a re-render leaves exactly one preview
 *  block (or none) per wrapper. */
function stripPreviewChrome(wrapper: HTMLElement): void {
  const existing = wrapper.querySelectorAll(':scope > .' + PREVIEW_ROOT_CLASS);
  for (let i = 0; i < existing.length; i++) {
    const node = existing[i];
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }
}

/** Build the preview banner + placeholder card grid for one Collection
 *  wrapper. The DOM shape:
 *
 *    <div class="opencanvas-collection-preview" data-editor-only="true">
 *      <div class="opencanvas-collection-preview-banner">…</div>
 *      <div class="opencanvas-collection-preview-grid">
 *        <article class="opencanvas-collection-preview-card">…</article>
 *        × 3
 *      </div>
 *    </div>
 *
 *  `data-editor-only="true"` is a defensive marker so a future grep can
 *  catch any code that walks the canvas DOM and tries to serialise it.
 *  Inline styles only — no dependency on styles.css; the chrome must
 *  render even in smokes that don't load the stylesheet. */
function buildPreviewBlock(slugLabel: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = PREVIEW_ROOT_CLASS;
  root.setAttribute('data-editor-only', 'true');
  root.style.cssText = [
    'display: block',
    'pointer-events: none',
    'padding: 12px',
    'box-sizing: border-box',
  ].join('; ');

  const banner = document.createElement('div');
  banner.className = 'opencanvas-collection-preview-banner';
  banner.style.cssText = [
    'display: flex',
    'align-items: center',
    'gap: 8px',
    'padding: 10px 14px',
    'margin-bottom: 12px',
    'background: #fef9e7',
    'border: 1px dashed #e0b96b',
    'border-radius: 6px',
    'color: #6b4f1b',
    'font-family: system-ui, -apple-system, sans-serif',
    'font-size: 13px',
    'line-height: 1.4',
  ].join('; ');

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'i';
  icon.style.display = 'inline-flex';
  icon.style.alignItems = 'center';
  icon.style.justifyContent = 'center';
  icon.style.width = '18px';
  icon.style.height = '18px';
  icon.style.borderRadius = '50%';
  icon.style.background = '#e0b96b';
  icon.style.color = '#fff';
  icon.style.fontStyle = 'italic';
  icon.style.fontWeight = '700';
  icon.style.fontSize = '12px';
  icon.style.lineHeight = '1';
  banner.appendChild(icon);

  const bannerText = document.createElement('span');
  bannerText.textContent =
    'Placeholder cards — add entries to see real content. Source: ' + slugLabel + '.';
  banner.appendChild(bannerText);

  root.appendChild(banner);

  const grid = document.createElement('div');
  grid.className = 'opencanvas-collection-preview-grid';
  grid.style.cssText = [
    'display: grid',
    'grid-template-columns: repeat(3, minmax(0, 1fr))',
    'gap: 12px',
  ].join('; ');

  for (let i = 0; i < PLACEHOLDER_CARDS.length; i++) {
    const card = PLACEHOLDER_CARDS[i]!;
    const cardNode = document.createElement('article');
    cardNode.className = 'opencanvas-collection-preview-card';
    cardNode.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'background: #ffffff',
      'border: 1px solid #e6e6e6',
      'border-radius: 8px',
      'overflow: hidden',
      'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04)',
    ].join('; ');

    const image = document.createElement('div');
    image.className = 'opencanvas-collection-preview-card-image';
    image.setAttribute('aria-hidden', 'true');
    image.style.cssText = ['background: ' + card.gradient, 'height: 120px', 'width: 100%'].join(
      '; ',
    );
    cardNode.appendChild(image);

    const body = document.createElement('div');
    body.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'gap: 6px',
      'padding: 12px',
    ].join('; ');

    const title = document.createElement('h4');
    title.className = 'opencanvas-collection-preview-card-title';
    title.textContent = card.title;
    title.style.cssText = [
      'margin: 0',
      'font-family: system-ui, -apple-system, sans-serif',
      'font-size: 14px',
      'font-weight: 600',
      'color: #1f2937',
    ].join('; ');
    body.appendChild(title);

    const excerpt = document.createElement('p');
    excerpt.className = 'opencanvas-collection-preview-card-excerpt';
    excerpt.textContent = card.excerpt;
    excerpt.style.cssText = [
      'margin: 0',
      'font-family: system-ui, -apple-system, sans-serif',
      'font-size: 12px',
      'line-height: 1.4',
      'color: #6b7280',
    ].join('; ');
    body.appendChild(excerpt);

    cardNode.appendChild(body);
    grid.appendChild(cardNode);
  }

  root.appendChild(grid);
  return root;
}

/** Mount or clear placeholder chrome on a single Collection wrapper. */
function augmentOneCollection(wrapper: HTMLElement): void {
  // Always strip first — idempotent re-run after rebuildElement /
  // renderAll. Without the strip, a slug toggle from unset to set would
  // leave the stale placeholder block in place because the inner frame
  // re-renders independently of the wrapper-level chrome.
  stripPreviewChrome(wrapper);

  if (!shouldRenderPlaceholders(wrapper)) return;

  const frame = wrapper.querySelector('.opencanvas-collection');
  if (!frame) {
    // Should have been caught by shouldRenderPlaceholders. Defensive
    // re-check — the canonical renderer always emits this child; if it
    // didn't, something upstream changed the contract.
    console.warn(
      '[collection-preview] no .opencanvas-collection child found inside wrapper',
      wrapper.getAttribute('data-opencanvas-element'),
    );
    return;
  }

  const slugLabel = sourceLabel(frame);
  const previewBlock = buildPreviewBlock(slugLabel);
  // Append inside the wrapper, after the inner .opencanvas-collection
  // frame, so the placeholder grid stacks below the (empty) frame the
  // canonical renderer emits. The wrapper has the user's box dimensions
  // applied by setBoxStyle; the inner frame is a `display: block` zero-
  // height stand-in until the materializer fills it. Appending the
  // preview block to the wrapper (not the frame) keeps it independent of
  // any inline styling the frame carries.
  wrapper.appendChild(previewBlock);
}

/** Walk every Collection wrapper in the editor DOM and mount/clear
 *  placeholder chrome on each. Called from render.ts after a full
 *  renderAll, and from element-menu.ts after a single-element rebuild.
 *
 *  The walk keys on `data-element-type="collection"` (set by
 *  buildElementNodeImpl) rather than scanning ctx.state — the DOM is the
 *  source of truth at this point and the attribute is stable across the
 *  IIFE / module-cutover boundary. */
export function augmentCollectionPreviewsImpl(ctx: EditorContext): void {
  if (!ctx.root) return;
  const wrappers = ctx.root.querySelectorAll('[data-element-type="collection"]');
  for (let i = 0; i < wrappers.length; i++) {
    const wrapper = wrappers[i];
    if (wrapper instanceof HTMLElement) {
      augmentOneCollection(wrapper);
    }
  }
}

/** Mount or clear placeholder chrome for one specific Collection by id.
 *  Called from rebuildElementImpl after a Collection's wrapper is
 *  replaced (inspector binding change, etc.) so the placeholder state
 *  catches up without waiting for a full renderAll. */
export function augmentCollectionPreviewForElementImpl(
  ctx: EditorContext,
  elementId: string,
): void {
  if (!ctx.root) return;
  // Site-pinned sections can repeat the same element id across artboards
  // (header/footer). Collections shouldn't normally live there but
  // querySelectorAll is the safe shape — mirrors selectElement's loop.
  const wrappers = ctx.root.querySelectorAll(
    '[data-opencanvas-element="' + cssEscape(elementId) + '"][data-element-type="collection"]',
  );
  for (let i = 0; i < wrappers.length; i++) {
    const wrapper = wrappers[i];
    if (wrapper instanceof HTMLElement) {
      augmentOneCollection(wrapper);
    }
  }
}
