// src/editor-client/page-inspector.ts
//
// ADR 0058 Phase 2h.3.b — page inspector renderer + animation replay.
// canvas-client.ts:6085-6512 carries the inline twin; retires on
// Phase 3 cutover. Behavioural parity is pinned by
// src/editor/inspector-smoke.ts against the production inline path
// (no DOM in bare Bun, so this module ships no sibling smoke).
//
// Four functions live here:
//
//   - replayAnimations(ctx, scope) — element-id OR "page" replays the
//     CSS keyframes on either a single element or every motion-tagged
//     element under the active artboard. The editor doesn't ship the
//     IntersectionObserver the public renderer uses for "on-scroll", so
//     replay treats both motion paths the same: read the preset, drop
//     the attribute, force a layout read, re-set the attribute.
//
//   - pageHasMotion(ctx) — true when the active page has a page-level
//     entranceAnimation OR any element on it carries a motion preset.
//     Used to disable the "Replay all animations" button when there's
//     nothing to replay.
//
//   - renderPageInspector(ctx) — right-hand inspector pane when no
//     section/element is selected. Renders page title, custom-404
//     toggle, motion fields, section gap, max-width, page background,
//     and the SEO link.
//
//   - applyPageStyles(ctx, page) — live-apply page-level visual
//     properties on the artboard (entrance motion, page background,
//     section gap, max-width). Called from the field change handlers
//     so individual edits update the live artboard without a full
//     renderAll().

import type { EditorContext } from './editor-context.js';
import type {
  CanvasPage,
  CollectionPageKind,
  MotionPreset,
  ScrollTriggerMode,
} from '../canvas/schema.js';
import { COLLECTION_PAGE_KINDS, MOTION_PRESETS, SCROLL_TRIGGER_MODES } from '../canvas/schema.js';
import { selectInput } from './dom-builders.js';
import { buildColorRow } from './inspector-leaf-builders.js';
import { cssEscape } from './css-escape.js';

// ADR 0060 Pass 2 — placeholder fields the entry-preview substitutor knows
// about. Same set as the publish-time materializer (collection-materializer.ts)
// so the editor preview matches what the published page will render. `tag`
// resolves to the entry's first tag.
export interface TemplatePreviewEntry {
  id?: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  publishedDate: string;
  author: string;
  category: string;
  tags: string[];
  status?: string;
}

const PLACEHOLDER_ORIGINAL_ATTR = 'data-opencanvas-placeholder-original';

const TEMPLATE_PREVIEW_FIELDS: ReadonlyArray<
  'title' | 'excerpt' | 'body' | 'publishedDate' | 'author' | 'category' | 'tag' | 'slug'
> = ['title', 'excerpt', 'body', 'publishedDate', 'author', 'category', 'tag', 'slug'];

function templatePreviewValue(
  entry: TemplatePreviewEntry,
  field: 'title' | 'excerpt' | 'body' | 'publishedDate' | 'author' | 'category' | 'tag' | 'slug',
): string {
  switch (field) {
    case 'title':
      return entry.title;
    case 'excerpt':
      return entry.excerpt;
    case 'body':
      return entry.body;
    case 'publishedDate':
      return entry.publishedDate;
    case 'author':
      return entry.author;
    case 'category':
      return entry.category;
    case 'tag':
      return entry.tags[0] ?? '';
    case 'slug':
      return entry.slug;
  }
}

/** Pure string substitution — replaces every `{{field}}` token with the entry
 *  value. Unknown tokens are left intact so unrelated mustache-shaped copy
 *  survives. Exported so the smoke can exercise it without a DOM. Mirrors the
 *  publish-time substituter in `collection-materializer.ts` so the editor
 *  preview matches what publish will render. */
export function substituteTemplatePlaceholderString(
  input: string,
  entry: TemplatePreviewEntry,
): string {
  let out = input;
  for (const field of TEMPLATE_PREVIEW_FIELDS) {
    const token = '{{' + field + '}}';
    if (out.includes(token)) {
      out = out.split(token).join(templatePreviewValue(entry, field));
    }
  }
  return out;
}

export function templatePreviewCacheKey(pageId: string, collectionSlug: string): string {
  return pageId + '::' + collectionSlug;
}

export function filterPublishedTemplatePreviewEntries(
  entries: TemplatePreviewEntry[],
): TemplatePreviewEntry[] {
  return entries.filter((entry) => entry.status === 'published');
}

export function isTemplatePreviewFetchCurrent(
  page: Pick<CanvasPage, 'id' | 'collectionSlug'> | null,
  fetchPageId: string,
  fetchCollectionSlug: string,
): boolean {
  return page !== null && page.id === fetchPageId && page.collectionSlug === fetchCollectionSlug;
}

export function shouldRevertTemplatePreviewOnRender(
  activePageId: string | null,
  _page: Pick<CanvasPage, 'id' | 'pageKind'>,
): boolean {
  return activePageId !== null;
}

function directTextNodeValues(element: Element): string[] {
  const values: string[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i]!;
    if (child.nodeType === /* Node.TEXT_NODE */ 3) {
      values.push(child.nodeValue ?? '');
    }
  }
  return values;
}

function snapshotDirectTextNodes(element: Element): string {
  return JSON.stringify({ textNodes: directTextNodeValues(element) });
}

function parseTextNodeSnapshot(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    const textNodes = (parsed as { textNodes?: unknown }).textNodes;
    if (!Array.isArray(textNodes)) return null;
    if (!textNodes.every((node) => typeof node === 'string')) return null;
    return textNodes;
  } catch {
    return null;
  }
}

function restoreDirectTextNodes(element: HTMLElement, original: string): void {
  const snapshot = parseTextNodeSnapshot(original);
  if (snapshot !== null) {
    let textIdx = 0;
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes[i]!;
      if (child.nodeType !== /* Node.TEXT_NODE */ 3) continue;
      const next = snapshot[textIdx];
      if (next !== undefined) {
        child.nodeValue = next;
      }
      textIdx++;
    }
    return;
  }
  for (let j = 0; j < element.childNodes.length; j++) {
    const child = element.childNodes[j]!;
    if (child.nodeType === /* Node.TEXT_NODE */ 3) {
      child.nodeValue = original;
      break;
    }
  }
}

/** Walk every text-bearing node under `scope` and substitute `{{field}}`
 *  placeholders for the entry's values. Each touched node stashes its
 *  pre-substitution text under `data-opencanvas-placeholder-original` on the
 *  closest containing element so `revertTemplatePreviewInDom` can restore it.
 *
 *  This is VISUAL ONLY — it never mutates state. ADR 0060 §3 says the editor
 *  edits pages, not entries; the preview lets the Owner see what publish will
 *  produce without dirtying the document. */
export function substituteTemplatePreviewInDom(scope: Element, entry: TemplatePreviewEntry): void {
  // Collect text nodes first so the walker doesn't see substituted nodes again.
  const doc = scope.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(scope, /* NodeFilter.SHOW_TEXT */ 0x04, null);
  const textNodes: Text[] = [];
  let current: Node | null = walker.nextNode();
  while (current !== null) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const original = textNode.nodeValue;
    if (original === null) continue;
    const replaced = substituteTemplatePlaceholderString(original, entry);
    if (replaced === original) continue;
    // Stash original on the parent element (text nodes don't carry attributes).
    const parent = textNode.parentElement;
    if (parent !== null && !parent.hasAttribute(PLACEHOLDER_ORIGINAL_ATTR)) {
      parent.setAttribute(PLACEHOLDER_ORIGINAL_ATTR, snapshotDirectTextNodes(parent));
    }
    textNode.nodeValue = replaced;
  }
}

/** Revert every `data-opencanvas-placeholder-original` substitution under
 *  `scope` back to its pre-preview text. Pairs with
 *  `substituteTemplatePreviewInDom`. */
export function revertTemplatePreviewInDom(scope: Element): void {
  const dirty = scope.querySelectorAll('[' + PLACEHOLDER_ORIGINAL_ATTR + ']');
  for (let i = 0; i < dirty.length; i++) {
    const el = dirty[i] as HTMLElement;
    const original = el.getAttribute(PLACEHOLDER_ORIGINAL_ATTR);
    if (original === null) continue;
    restoreDirectTextNodes(el, original);
    el.removeAttribute(PLACEHOLDER_ORIGINAL_ATTR);
  }
}

// Module-private state — tracks the page id whose artboard currently carries
// an active preview, so a page switch (or a render that clears pageKind) can
// revert in-place before the new inspector takes over.
let activePreviewPageId: string | null = null;
// Cache of published preview entries by page id + collection slug so changing
// a template from one collection to another cannot reuse the old options.
const entriesCache = new Map<string, TemplatePreviewEntry[]>();

export function replayAnimations(ctx: EditorContext, scope: string): void {
  // scope: "page" replays all, or an element id replays just that one.
  // Two motion paths exist server-side (src/canvas/render.ts):
  //   1. on-load: the element gets data-motion-preset right away and the
  //      style-kit's @keyframes fires once on mount.
  //   2. on-scroll: the page renders with data-entrance-animation +
  //      data-scroll-trigger="on-scroll" and the public renderer's
  //      IntersectionObserver promotes the attribute when the element
  //      intersects the viewport.
  // The editor doesn't ship that observer so on-scroll items would never
  // animate without help. Replay treats both paths the same: read either
  // attribute, then drive data-motion-preset to trigger the keyframes.
  const page = ctx.currentPage();
  if (!page) return;
  if (!ctx.root) return;
  let targets: ArrayLike<Element>;
  if (scope === 'page') {
    const artboard = ctx.root.querySelector(
      '[data-page-id="' + cssEscape(ctx.activePageId || page.id) + '"]',
    );
    if (!artboard) return;
    targets = artboard.querySelectorAll('[data-motion-preset], [data-entrance-animation]');
  } else {
    const el = ctx.root.querySelector('[data-opencanvas-element="' + cssEscape(scope) + '"]');
    if (!el) {
      targets = [];
    } else {
      targets = [el];
    }
  }
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i] as HTMLElement;
    const preset =
      t.getAttribute('data-motion-preset') || t.getAttribute('data-entrance-animation');
    if (!preset || preset === 'none') continue;
    t.removeAttribute('data-motion-preset');
    // Force layout so the browser restarts the CSS animation. Reading
    // offsetWidth is the load-bearing op (any layout read works); the
    // void operator discards the value to keep linters quiet about a
    // useless expression. Without this read the browser may batch the
    // attribute remove + set into a single style change and skip the
    // animation entirely.
    void t.offsetWidth;
    t.setAttribute('data-motion-preset', preset);
  }
}

export function pageHasMotion(ctx: EditorContext): boolean {
  const page = ctx.currentPage();
  if (!page) return false;
  if (page.entranceAnimation && page.entranceAnimation !== 'none') return true;
  for (let i = 0; i < page.sections.length; i++) {
    const sec = page.sections[i]!;
    for (let j = 0; j < sec.elements.length; j++) {
      if (sec.elements[j]!.motion) return true;
    }
  }
  return false;
}

// -- Page inspector (right panel when nothing selected) -----------------
export function renderPageInspector(ctx: EditorContext): void {
  if (!ctx.inspector) return;
  const pageLookup = ctx.currentPage();
  if (!pageLookup) {
    revertActivePreview(ctx);
    // ADR 0060 Pass 3 follow-up #7 — remove the banner so it doesn't linger
    // when state clears (boot abort, fatal load failure). syncTemplateBanner
    // reads ctx.currentPage() and tears down when null.
    syncTemplateBanner(ctx);
    ctx.inspector.hidden = true;
    ctx.inspector.replaceChildren();
    ctx.inspectorRenderSubject = null;
    return;
  }
  // Local non-null alias so callback closures keep the narrowed type
  // without re-asserting on every read.
  const page = pageLookup;
  // ADR 0060 Pass 2 — preview is a visual overlay on the artboard DOM. Any
  // inspector re-render rebuilds the controls from state, so clear the overlay
  // first instead of letting the artboard and dropdown drift apart.
  if (shouldRevertTemplatePreviewOnRender(activePreviewPageId, page)) {
    revertActivePreview(ctx);
  }
  ctx.preserveInspectorScrollFor('page:' + page.id);
  ctx.revokePendingPreviews();
  ctx.inspector.replaceChildren();
  ctx.inspector.hidden = false;

  const heading = document.createElement('h3');
  heading.textContent = 'Page';
  ctx.inspector.appendChild(heading);
  // Editable page title. The artboard label on the canvas mirrors this
  // value (built off page.title in renderAll), so a single edit here
  // updates the on-canvas label too. We commit on blur AND on Enter so
  // a quick rename doesn't require tab-out, but withhold autosaves until
  // commit so an in-flight edit can't ship a half-typed title to peers.
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'meta meta-editable';
  titleInput.value = page.title || page.slug;
  titleInput.placeholder = page.slug;
  titleInput.setAttribute('aria-label', 'Page title');
  function commitTitle(): void {
    const next = titleInput.value.trim();
    const current = page.title || '';
    if (next === current) return;
    if (next.length === 0) {
      // Treat clearing the field as "revert to slug" — the artboard
      // label falls back to slug anyway. Capture for undo so this
      // counts as one operation in history.
      page.title = page.slug;
    } else {
      page.title = next;
    }
    ctx.captureForUndo();
    ctx.renderAll();
    ctx.updatePageSidebar();
    ctx.scheduleSave();
    ctx.setStatus('Page renamed', 'ok');
  }
  titleInput.addEventListener('blur', commitTitle);
  titleInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      titleInput.blur();
    } else if (ev.key === 'Escape') {
      titleInput.value = page.title || page.slug;
      titleInput.blur();
    }
  });
  ctx.inspector.appendChild(titleInput);

  // -- Custom 404 toggle ------------------------------------------------
  // ADR 0029: the slug '_404' IS the custom-404 mechanism; this toggle
  // is the view onto that fact (no parallel boolean field). Toggle-on
  // sets page.slug = '_404'. If another page is already '_404' it is
  // auto-demoted in the same write — the cardinality invariant (at
  // most one page per site has slug '_404', enforced at
  // src/canvas/validate.ts:1110) is never transiently violated.
  // Always-confirm policy (user-chosen) shows a modal on toggle-on
  // when a demotion is needed AND on toggle-off (significant change
  // either way).
  const group404 = document.createElement('div');
  group404.className = 'opencanvas-page-inspector-group';
  const h404 = document.createElement('h4');
  h404.textContent = 'Custom 404 page';
  group404.appendChild(h404);
  const toggle404Row = document.createElement('label');
  toggle404Row.style.display = 'flex';
  toggle404Row.style.alignItems = 'center';
  toggle404Row.style.gap = '8px';
  toggle404Row.style.cursor = 'pointer';
  const toggle404Input = document.createElement('input');
  toggle404Input.type = 'checkbox';
  toggle404Input.checked = page.slug === '_404';
  const toggle404Text = document.createElement('span');
  toggle404Text.textContent = 'Use this page as the custom 404';
  toggle404Row.appendChild(toggle404Input);
  toggle404Row.appendChild(toggle404Text);
  function nextFreeSlugFor(targetPage: CanvasPage): string {
    let base = (targetPage.title || 'page')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (base.length === 0 || base === '_404' || base === '404') base = 'page';
    let slug = base;
    let counter = 2;
    while (
      ctx.state!.pages.some(function (p) {
        return p.id !== targetPage.id && p.slug === slug;
      })
    ) {
      slug = base + '-' + counter;
      counter++;
    }
    return slug;
  }
  toggle404Input.addEventListener('change', function () {
    if (toggle404Input.checked) {
      let existing404: CanvasPage | null = null;
      for (let i = 0; i < ctx.state!.pages.length; i++) {
        if (ctx.state!.pages[i]!.id !== page.id && ctx.state!.pages[i]!.slug === '_404') {
          existing404 = ctx.state!.pages[i]!;
          break;
        }
      }
      if (existing404) {
        const demotedSlug = nextFreeSlugFor(existing404);
        const existing404Ref = existing404;
        void ctx
          .openConfirmModal({
            title: 'Demote current 404 page',
            message:
              'Page "' +
              (existing404Ref.title || existing404Ref.slug) +
              '" is currently your custom 404. Toggling on for this page will demote it to a regular page at slug /' +
              demotedSlug +
              '. Continue?',
            confirmLabel: 'Yes, demote and switch',
          })
          .then(function (confirmed) {
            if (!confirmed) {
              toggle404Input.checked = false;
              return;
            }
            existing404Ref.slug = demotedSlug;
            page.slug = '_404';
            ctx.captureForUndo();
            ctx.renderAll();
            ctx.updatePageSidebar();
            renderPageInspector(ctx);
            ctx.scheduleSave();
            ctx.setStatus('Custom 404 page set', 'ok');
          });
      } else {
        page.slug = '_404';
        ctx.captureForUndo();
        ctx.renderAll();
        ctx.updatePageSidebar();
        renderPageInspector(ctx);
        ctx.scheduleSave();
        ctx.setStatus('Custom 404 page set', 'ok');
      }
    } else {
      void ctx
        .openConfirmModal({
          title: 'Remove custom 404 status',
          message:
            'This page will no longer be your custom 404. Visitors hitting unknown URLs will see the default 404 page.',
          confirmLabel: 'Remove',
        })
        .then(function (confirmed) {
          if (!confirmed) {
            toggle404Input.checked = true;
            return;
          }
          page.slug = nextFreeSlugFor(page);
          ctx.captureForUndo();
          ctx.renderAll();
          ctx.updatePageSidebar();
          renderPageInspector(ctx);
          ctx.scheduleSave();
          ctx.setStatus('Custom 404 status removed; slug set to /' + page.slug, 'ok');
        });
    }
  });
  group404.appendChild(toggle404Row);
  ctx.inspector.appendChild(group404);

  // -- Entrance animation -----------------------------------------------
  const group1 = document.createElement('div');
  group1.className = 'opencanvas-page-inspector-group';
  const h4a = document.createElement('h4');
  h4a.textContent = 'Entrance animation';
  group1.appendChild(h4a);

  const entranceSel = selectInput(MOTION_PRESETS, page.entranceAnimation || 'none');
  entranceSel.addEventListener('change', function () {
    if (entranceSel.value === 'none') {
      delete page.entranceAnimation;
    } else {
      page.entranceAnimation = entranceSel.value as MotionPreset;
      if (!page.scrollTriggerMode) page.scrollTriggerMode = 'on-load';
    }
    applyPageStyles(ctx, page);
    ctx.renderInspector();
    ctx.scheduleSave();
  });
  group1.appendChild(entranceSel);
  ctx.inspector.appendChild(group1);

  // -- Scroll trigger mode ----------------------------------------------
  const group2 = document.createElement('div');
  group2.className = 'opencanvas-page-inspector-group';
  const h4b = document.createElement('h4');
  h4b.textContent = 'Animation trigger';
  group2.appendChild(h4b);

  const triggerSel = selectInput(SCROLL_TRIGGER_MODES, page.scrollTriggerMode || 'on-load');
  triggerSel.addEventListener('change', function () {
    page.scrollTriggerMode = triggerSel.value as ScrollTriggerMode;
    applyPageStyles(ctx, page);
    ctx.scheduleSave();
  });
  group2.appendChild(triggerSel);
  ctx.inspector.appendChild(group2);

  // -- Default motion preset --------------------------------------------
  const group3 = document.createElement('div');
  group3.className = 'opencanvas-page-inspector-group';
  const h4c = document.createElement('h4');
  h4c.textContent = 'Default motion for new elements';
  group3.appendChild(h4c);

  const defaultSel = selectInput(MOTION_PRESETS, page.defaultMotionPreset || 'none');
  defaultSel.addEventListener('change', function () {
    if (defaultSel.value === 'none') {
      delete page.defaultMotionPreset;
    } else {
      page.defaultMotionPreset = defaultSel.value as MotionPreset;
    }
    ctx.scheduleSave();
  });
  group3.appendChild(defaultSel);
  ctx.inspector.appendChild(group3);

  // -- Divider ----------------------------------------------------------
  const divider1 = document.createElement('div');
  divider1.className = 'opencanvas-page-inspector-divider';
  ctx.inspector.appendChild(divider1);

  // -- Play / replay animations -----------------------------------------
  const group4 = document.createElement('div');
  group4.className = 'opencanvas-page-inspector-group';
  const h4d = document.createElement('h4');
  h4d.textContent = 'Preview';
  group4.appendChild(h4d);

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'opencanvas-replay-btn';
  const playIcon = document.createElement('span');
  playIcon.className = 'play-icon';
  playBtn.appendChild(playIcon);
  const playLabel = document.createElement('span');
  playLabel.textContent = 'Replay all animations';
  playBtn.appendChild(playLabel);
  if (!pageHasMotion(ctx)) playBtn.disabled = true;
  playBtn.addEventListener('click', function () {
    replayAnimations(ctx, 'page');
  });
  group4.appendChild(playBtn);
  ctx.inspector.appendChild(group4);

  // -- Divider ----------------------------------------------------------
  const divider2 = document.createElement('div');
  divider2.className = 'opencanvas-page-inspector-divider';
  ctx.inspector.appendChild(divider2);

  // -- Page background --------------------------------------------------
  // Uses the same swatch + hex pattern as the element-style background.
  // Page bg is hex-only as of ADR 0028; values that aren't #rgb or
  // #rrggbb are not representable here (the previous text input
  // accepted 'transparent' / named colors / gradients, but the demo
  // case is swatch-picked hex and that's what the picker exposes).
  const group5 = document.createElement('div');
  group5.className = 'opencanvas-page-inspector-group';
  const h4e = document.createElement('h4');
  h4e.textContent = 'Page background';
  group5.appendChild(h4e);

  const pageBgRow = buildColorRow({
    getValue: function () {
      return page.pageBackground;
    },
    setValue: function (v) {
      page.pageBackground = v;
    },
    clearValue: function () {
      delete page.pageBackground;
    },
    onChange: function () {
      applyPageStyles(ctx, page);
      ctx.scheduleSave();
    },
    enabledTitle: 'Override theme background',
    swatchDefault: '#ffffff',
    resetLabel: 'Follow theme',
  });
  group5.appendChild(pageBgRow);
  ctx.inspector.appendChild(group5);

  // -- Section gap ------------------------------------------------------
  const group6 = document.createElement('div');
  group6.className = 'opencanvas-page-inspector-group';
  const h4f = document.createElement('h4');
  h4f.textContent = 'Section gap';
  group6.appendChild(h4f);

  const gapInput = document.createElement('input');
  gapInput.type = 'number';
  gapInput.min = '0';
  gapInput.max = '120';
  gapInput.placeholder = '0';
  gapInput.value = page.sectionGap != null ? String(page.sectionGap) : '';
  gapInput.addEventListener('change', function () {
    if (gapInput.value.trim().length === 0) {
      delete page.sectionGap;
    } else {
      const n = Number(gapInput.value);
      if (!Number.isFinite(n) || n < 0 || n > 120) {
        ctx.setStatus('Section gap must be 0-120px', 'error');
        return;
      }
      page.sectionGap = n;
    }
    applyPageStyles(ctx, page);
    ctx.scheduleSave();
  });
  group6.appendChild(gapInput);
  ctx.inspector.appendChild(group6);

  // -- Page max-width ---------------------------------------------------
  const group7 = document.createElement('div');
  group7.className = 'opencanvas-page-inspector-group';
  const h4g = document.createElement('h4');
  h4g.textContent = 'Content max-width';
  group7.appendChild(h4g);

  const maxWInput = document.createElement('input');
  maxWInput.type = 'number';
  maxWInput.min = '600';
  maxWInput.max = '2400';
  maxWInput.placeholder = '1440';
  maxWInput.value = page.maxWidth != null ? String(page.maxWidth) : '';
  maxWInput.addEventListener('change', function () {
    if (maxWInput.value.trim().length === 0) {
      delete page.maxWidth;
    } else {
      const n = Number(maxWInput.value);
      if (!Number.isFinite(n) || n < 600 || n > 2400) {
        ctx.setStatus('Content max-width must be 600-2400px', 'error');
        return;
      }
      page.maxWidth = n;
    }
    applyPageStyles(ctx, page);
    ctx.scheduleSave();
  });
  group7.appendChild(maxWInput);
  ctx.inspector.appendChild(group7);

  // -- Divider ----------------------------------------------------------
  const divider3 = document.createElement('div');
  divider3.className = 'opencanvas-page-inspector-divider';
  ctx.inspector.appendChild(divider3);

  // -- SEO & metadata link ---------------------------------------------
  // Opens the dashboard SEO panel for this page in a new tab so the user
  // doesn't lose their editor scroll position.
  const seoGroup = document.createElement('div');
  seoGroup.className = 'opencanvas-page-inspector-group';
  const seoLabel = document.createElement('h4');
  seoLabel.textContent = 'SEO & metadata';
  seoGroup.appendChild(seoLabel);
  const seoLink = document.createElement('a');
  seoLink.href =
    '/dashboard/sites/' +
    encodeURIComponent(ctx.siteId) +
    '/pages/' +
    encodeURIComponent(page.id) +
    '/seo';
  seoLink.target = '_blank';
  seoLink.rel = 'noopener';
  seoLink.className = 'opencanvas-page-inspector-link';
  seoLink.textContent = 'Open SEO panel →';
  seoLink.title = 'Edit title, description, share-card image and search settings';
  seoGroup.appendChild(seoLink);
  ctx.inspector.appendChild(seoGroup);

  // -- ADR 0060 Pass 2: Page kind + template controls -------------------
  renderTemplateControls(ctx, page);

  // ADR 0060 Pass 3 follow-up #7 — canvas-top banner that mirrors the
  // template-context cue so the Owner doesn't lose the signal when the
  // right sidebar is closed. Run last so any mutation above (kind picker
  // defaulting collectionSlug to 'blog' on first set) is reflected in the
  // banner label on the same render pass.
  syncTemplateBanner(ctx);
}

// ---------------------------------------------------------------------------
// ADR 0060 Pass 2 — template controls (page-kind picker + template panel).
// ---------------------------------------------------------------------------

/** Page-kind selector dropdown values. The schema accepts only
 *  COLLECTION_PAGE_KINDS or undefined; the UI exposes 'standard' as the
 *  delete-the-field sentinel so the user has a single dropdown rather than a
 *  pair of checkbox + select. */
const PAGE_KIND_UI_VALUES = ['standard', ...COLLECTION_PAGE_KINDS] as const;

function pageKindLabel(value: string): string {
  if (value === 'standard') return 'Standard';
  if (value === 'collection-index') return 'Collection index';
  if (value === 'collection-item-template') return 'Collection item template';
  return value;
}

function templateBadgeText(page: CanvasPage): string {
  if (page.pageKind === 'collection-index') return 'Index for: ' + (page.collectionSlug ?? '');
  if (page.pageKind === 'collection-item-template')
    return 'Template for: ' + (page.collectionSlug ?? '');
  return '';
}

/** Revert any active artboard preview back to the placeholder text. Resets
 *  module state so the next preview cycle starts clean. */
function revertActivePreview(ctx: EditorContext): void {
  if (activePreviewPageId === null) return;
  if (ctx.root !== null) {
    const artboard = ctx.root.querySelector(
      '[data-page-id="' + cssEscape(activePreviewPageId) + '"]',
    );
    if (artboard !== null) {
      revertTemplatePreviewInDom(artboard);
    }
  }
  activePreviewPageId = null;
}

/** Render the page-kind picker + (when a kind is set) the template-context
 *  panel: badge with entry counts, placeholder chips, preview-as-entry. */
function renderTemplateControls(ctx: EditorContext, page: CanvasPage): void {
  if (!ctx.inspector) return;

  // Divider above the section so the picker visually separates from SEO.
  const dividerTop = document.createElement('div');
  dividerTop.className = 'opencanvas-page-inspector-divider';
  ctx.inspector.appendChild(dividerTop);

  // -- Page kind selector --------------------------------------------------
  const groupKind = document.createElement('div');
  groupKind.className = 'opencanvas-page-inspector-group';
  const hKind = document.createElement('h4');
  hKind.textContent = 'Page kind';
  groupKind.appendChild(hKind);

  const kindSelect = document.createElement('select');
  for (const value of PAGE_KIND_UI_VALUES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = pageKindLabel(value);
    if ((page.pageKind ?? 'standard') === value) opt.selected = true;
    kindSelect.appendChild(opt);
  }
  groupKind.appendChild(kindSelect);
  ctx.inspector.appendChild(groupKind);

  // -- Collection slug input (shown only when a kind is set) ---------------
  const groupSlug = document.createElement('div');
  groupSlug.className = 'opencanvas-page-inspector-group';
  const hSlug = document.createElement('h4');
  hSlug.textContent = 'Collection';
  groupSlug.appendChild(hSlug);
  const slugInput = document.createElement('input');
  slugInput.type = 'text';
  slugInput.placeholder = 'blog';
  slugInput.value = page.collectionSlug ?? '';
  slugInput.setAttribute('aria-label', 'Collection slug');
  groupSlug.appendChild(slugInput);
  if (page.pageKind === undefined) {
    groupSlug.style.display = 'none';
  }
  ctx.inspector.appendChild(groupSlug);

  kindSelect.addEventListener('change', function () {
    const next = kindSelect.value;
    ctx.captureForUndo();
    if (next === 'standard') {
      delete page.pageKind;
      delete page.collectionSlug;
      // Drop any active preview — the page is no longer a template surface.
      revertActivePreview(ctx);
    } else {
      page.pageKind = next as CollectionPageKind;
      // Default the slug to whatever exists, falling back to 'blog' so
      // validate.ts doesn't reject the save (collectionSlug is required when
      // pageKind is set).
      if (page.collectionSlug === undefined || page.collectionSlug.length === 0) {
        page.collectionSlug = 'blog';
      }
    }
    ctx.scheduleSave();
    renderPageInspector(ctx);
  });

  slugInput.addEventListener('change', function () {
    const next = slugInput.value.trim();
    if (next.length === 0) {
      // Empty slug + set pageKind would fail validation; refuse the edit.
      ctx.setStatus('Collection slug cannot be empty while page kind is set', 'error');
      slugInput.value = page.collectionSlug ?? '';
      return;
    }
    if (next === page.collectionSlug) return;
    ctx.captureForUndo();
    page.collectionSlug = next;
    ctx.scheduleSave();
    renderPageInspector(ctx);
  });

  // -- Template-context panel (visible only when pageKind is set) ---------
  if (page.pageKind === undefined) return;

  const collectionSlug = page.collectionSlug ?? '';
  const cacheKey = templatePreviewCacheKey(page.id, collectionSlug);

  // B1. Badge + entry counts ----------------------------------------------
  //
  // ADR 0063 dec 10 — the "Manage entries →" affordance previously sat here
  // as an anchor inside this group (alongside the badge + counts). The link
  // followed the *binding*, and after ADR 0063 dec 1 the binding lives on
  // the Collection element, not the page — so the affordance moved to the
  // Collection element inspector (`renderCollectionInspector` in
  // element-inspector.ts). The badge + entry-count line stay because they
  // serve the `collection-item-template` page workflow (Owner needs to know
  // the active source/counts while editing the per-entry template).
  //
  // syncTemplateBanner + templateBannerManageHref + templateBannerLabelText
  // are deliberately untouched: the canvas-top banner still appears for
  // `collection-item-template` pages and keeps its own "Manage entries →"
  // link inside the banner DOM. The Owner has two surfaces for "manage":
  // (1) the floating banner above the artboard while editing a template
  // page, and (2) the element inspector when a Collection element is
  // selected. Both end at the same dashboard URL.
  const groupBadge = document.createElement('div');
  groupBadge.className = 'opencanvas-page-inspector-group';
  const hBadge = document.createElement('h4');
  hBadge.textContent = templateBadgeText(page);
  groupBadge.appendChild(hBadge);

  const countsLine = document.createElement('div');
  countsLine.style.cssText = 'font-size:12px; color:var(--opencanvas-fg-mute, #888);';
  countsLine.textContent = '— published · — drafts';
  groupBadge.appendChild(countsLine);
  ctx.inspector.appendChild(groupBadge);

  // B2. Placeholder chips --------------------------------------------------
  const groupChips = document.createElement('div');
  groupChips.className = 'opencanvas-page-inspector-group';
  const hChips = document.createElement('h4');
  hChips.textContent = 'Insert placeholder';
  groupChips.appendChild(hChips);

  const chipRow = document.createElement('div');
  chipRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; align-items:center;';
  const PLACEHOLDER_TOKENS: ReadonlyArray<string> = [
    '{{title}}',
    '{{excerpt}}',
    '{{body}}',
    '{{publishedDate}}',
    '{{author}}',
    '{{category}}',
    '{{tag}}',
    '{{slug}}',
  ];
  for (const token of PLACEHOLDER_TOKENS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = token;
    chip.style.cssText =
      'font-family:var(--mono, monospace); font-size:12px; padding:3px 8px; ' +
      'border:1px solid var(--opencanvas-hairline, var(--line, #2a2a2a)); ' +
      'border-radius:14px; background:transparent; color:inherit; cursor:pointer;';
    chip.addEventListener('mouseenter', function () {
      chip.style.background = 'var(--opencanvas-bg-hover, rgba(255,255,255,0.06))';
    });
    chip.addEventListener('mouseleave', function () {
      chip.style.background = 'transparent';
    });
    chip.addEventListener('click', function () {
      insertOrCopyPlaceholder(ctx, token);
    });
    chipRow.appendChild(chip);
  }
  groupChips.appendChild(chipRow);

  const chipHelp = document.createElement('div');
  chipHelp.style.cssText = 'font-size:11px; color:var(--opencanvas-fg-mute, #888); margin-top:4px;';
  chipHelp.textContent =
    'Click to insert at cursor or copy. The publish step replaces these with the entry’s content.';
  groupChips.appendChild(chipHelp);
  ctx.inspector.appendChild(groupChips);

  // B3. Preview-as-entry dropdown -----------------------------------------
  const groupPreview = document.createElement('div');
  groupPreview.className = 'opencanvas-page-inspector-group';
  const hPreview = document.createElement('h4');
  hPreview.textContent = 'Preview with';
  groupPreview.appendChild(hPreview);

  const previewSelect = document.createElement('select');
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '— Show placeholders —';
  placeholderOpt.selected = true;
  previewSelect.appendChild(placeholderOpt);
  groupPreview.appendChild(previewSelect);
  ctx.inspector.appendChild(groupPreview);

  previewSelect.addEventListener('change', function () {
    const next = previewSelect.value;
    // Always revert first so a switch from entry A → entry B starts from the
    // raw placeholders rather than substituting on already-substituted text.
    revertActivePreview(ctx);
    if (next.length === 0) return;
    const cached = entriesCache.get(cacheKey);
    if (cached === undefined) return;
    const entry = cached.find(function (e) {
      return e.id === next;
    });
    if (entry === undefined) return;
    if (ctx.root === null) return;
    const artboard = ctx.root.querySelector('[data-page-id="' + cssEscape(page.id) + '"]');
    if (artboard === null) return;
    substituteTemplatePreviewInDom(artboard, entry);
    activePreviewPageId = page.id;
  });

  // Fire the fetch — auth-gated via cookie. The currentPageId capture lets the
  // resolver ignore a response that arrives after the user navigated away.
  const fetchPageId = page.id;
  const fetchCollectionSlug = collectionSlug;
  const url =
    ctx.apiBase +
    '/sites/' +
    encodeURIComponent(ctx.siteId) +
    '/entries?collection=' +
    encodeURIComponent(collectionSlug);
  void ctx.authFetch(url)
    .then(function (res) {
      if (!res.ok) {
        throw new Error('GET ' + url + ' returned ' + String(res.status) + ' ' + res.statusText);
      }
      return res.json() as Promise<{ entries: TemplatePreviewEntry[] }>;
    })
    .then(function (body) {
      // Stale guard — if the page changed while the fetch was in flight, drop
      // the result rather than mutating an inspector for a different page.
      const stillCurrent = ctx.currentPage();
      if (!isTemplatePreviewFetchCurrent(stillCurrent, fetchPageId, fetchCollectionSlug)) return;
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const publishedEntries = filterPublishedTemplatePreviewEntries(entries);
      entriesCache.set(cacheKey, publishedEntries);
      let published = 0;
      let drafts = 0;
      for (const entry of entries) {
        if (entry.status === 'published') published++;
        else if (entry.status === 'draft') drafts++;
      }
      countsLine.textContent = String(published) + ' published · ' + String(drafts) + ' drafts';
      // Repopulate the preview dropdown. Clear all but the placeholder opt.
      while (previewSelect.children.length > 1) {
        previewSelect.removeChild(previewSelect.children[previewSelect.children.length - 1]!);
      }
      for (const entry of publishedEntries) {
        if (entry.id === undefined) continue;
        const opt = document.createElement('option');
        opt.value = entry.id;
        opt.textContent = entry.title.length > 0 ? entry.title : entry.slug;
        previewSelect.appendChild(opt);
      }
    })
    .catch(function (err: unknown) {
      const stillCurrent = ctx.currentPage();
      if (!isTemplatePreviewFetchCurrent(stillCurrent, fetchPageId, fetchCollectionSlug)) return;
      // ADR-aligned loud-failure path: surface the breakage and log details.
      // The inspector keeps rendering — only the count line and preview list
      // remain in their loading state, which is the smallest visible change.
      countsLine.textContent = '(failed to load)';

      console.error(
        '[page-inspector] failed to load entries for',
        fetchPageId,
        fetchCollectionSlug,
        err,
      );
    });
}

/** Insert `{{field}}` at the cursor when an editable contenteditable in the
 *  active artboard owns focus; otherwise copy to clipboard and surface a
 *  status line. Falls back to clipboard when execCommand isn't supported
 *  (older browsers don't all wire up `insertText`). */
function insertOrCopyPlaceholder(ctx: EditorContext, token: string): void {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (
    active !== null &&
    active instanceof HTMLElement &&
    active.isContentEditable &&
    ctx.root !== null &&
    ctx.root.contains(active)
  ) {
    const ok = document.execCommand('insertText', false, token);
    if (ok) {
      ctx.setStatus('Inserted ' + token, 'ok');
      return;
    }
  }
  // Clipboard fallback. `navigator.clipboard` is async but we don't need to
  // surface a "failed to copy" path beyond the status line — the user can
  // retry. Loud-failure rule still applies: log the error so it's debuggable.
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard
      .writeText(token)
      .then(function () {
        ctx.setStatus('Copied ' + token + ' to clipboard', 'ok');
      })
      .catch(function (err: unknown) {
        ctx.setStatus('Could not copy ' + token, 'error');

        console.error('[page-inspector] clipboard write failed for', token, err);
      });
    return;
  }
  ctx.setStatus('Could not copy ' + token, 'error');
}

// ---------------------------------------------------------------------------
// ADR 0060 Pass 3 follow-up #7 — canvas-top template banner.
//
// A small floating strip above the artboard surface that surfaces the
// template-context cue (the same one the right inspector shows as a badge).
// Sidebar can be closed, the badge can be off-screen — this banner keeps the
// "you are editing a TEMPLATE, not a regular page" signal visible.
//
// DOM: single <div id="opencanvas-template-banner"> mounted as a child of
// ctx.viewport (NOT ctx.root, which renderAll wipes via replaceChildren).
// Position: absolute, top of viewport. Survives renderAll, and the banner
// id makes the sync idempotent (existing element is reused, never stacked).
//
// Lifecycle:
//   - syncTemplateBanner runs on every renderPageInspector tick.
//   - Active page with pageKind set + non-dismissed → banner is created
//     or updated in-place.
//   - Active page with no pageKind → banner is removed.
//   - Dismissed pages set a localStorage flag scoped per page id so the
//     same template page doesn't keep re-showing; switching to a different
//     template page reappears because the flag is keyed on that page's id.
// ---------------------------------------------------------------------------

const TEMPLATE_BANNER_ID = 'opencanvas-template-banner';
const TEMPLATE_BANNER_DISMISS_PREFIX = 'cms-template-banner-dismissed-';

function templateBannerDismissKey(pageId: string): string {
  return TEMPLATE_BANNER_DISMISS_PREFIX + pageId;
}

function isTemplateBannerDismissed(pageId: string): boolean {
  // localStorage may be unavailable (server-side render path, blocked third-
  // party storage, private window). Loud-failure rule: log + treat as "not
  // dismissed" so the cue surfaces; we don't want a quota error to silently
  // hide an Owner-facing affordance.
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(templateBannerDismissKey(pageId)) === '1';
  } catch (err) {
    console.error('[page-inspector] localStorage read failed for template banner', pageId, err);
    return false;
  }
}

function markTemplateBannerDismissed(pageId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(templateBannerDismissKey(pageId), '1');
  } catch (err) {
    console.error('[page-inspector] localStorage write failed for template banner', pageId, err);
  }
}

/** Pure: the banner label for a template page. Exported so the smoke can
 *  pin both index and item-template phrasings without spinning up a DOM. */
export function templateBannerLabelText(page: Pick<CanvasPage, 'pageKind' | 'collectionSlug'>): string {
  const slug = page.collectionSlug ?? '';
  if (page.pageKind === 'collection-index') return 'Index for ' + slug;
  if (page.pageKind === 'collection-item-template') return 'Template for ' + slug;
  return '';
}

/** Pure: the URL the "Manage entries" link points at. Exported so the smoke
 *  can pin the path shape without parsing DOM. */
export function templateBannerManageHref(siteId: string, collectionSlug: string): string {
  return (
    '/dashboard/sites/' +
    encodeURIComponent(siteId) +
    '/entries?collection=' +
    encodeURIComponent(collectionSlug)
  );
}

function removeTemplateBanner(host: HTMLElement): void {
  // querySelector is on every Element; no instanceof guard needed since the
  // caller only passes ctx.viewport (an HTMLElement) or short-circuits.
  const existing = host.querySelector('#' + TEMPLATE_BANNER_ID);
  if (existing !== null && existing.parentNode !== null) {
    existing.parentNode.removeChild(existing);
  }
}

/** Idempotently create, update, or remove the canvas-top template banner
 *  based on the active page's pageKind / collectionSlug / dismissal state.
 *  Safe to call repeatedly — the banner DOM node is keyed by id and reused
 *  in place rather than stacked.
 *
 *  ADR 0060 Pass 3 follow-up #7. */
export function syncTemplateBanner(ctx: EditorContext): void {
  // Host is the viewport (parent of #canvas-root). renderAll wipes ctx.root's
  // children via replaceChildren, so a banner under ctx.root would vanish on
  // every full re-render. Living under ctx.viewport means the banner survives
  // canvas rerenders and only this function rewrites it.
  const host = ctx.viewport;
  if (host === null) return;

  const page = ctx.currentPage();

  // No page → no banner. Same exit path covers state===null at boot abort.
  if (page === null || page.pageKind === undefined) {
    removeTemplateBanner(host);
    return;
  }

  // Dismissed for this specific page id → no banner. The dismissal is
  // scoped to the page id so switching to a different template page shows
  // its banner without an explicit reset.
  if (isTemplateBannerDismissed(page.id)) {
    removeTemplateBanner(host);
    return;
  }

  const collectionSlug = page.collectionSlug ?? '';
  const labelText = templateBannerLabelText(page);
  const manageHref = templateBannerManageHref(ctx.siteId, collectionSlug);

  // Reuse an existing banner DOM node if present — prevents stacking when
  // renderPageInspector fires multiple times for the same page.
  let banner = host.querySelector<HTMLElement>('#' + TEMPLATE_BANNER_ID);
  let labelEl: HTMLSpanElement;
  let linkEl: HTMLAnchorElement;
  let dismissBtn: HTMLButtonElement;
  if (banner === null) {
    banner = document.createElement('div');
    banner.id = TEMPLATE_BANNER_ID;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    // Inline styles — banner ships independent of styles-build.ts (per scope
    // rules). CSS vars degrade to tasteful neutrals when the editor's design
    // tokens aren't loaded (e.g. error-page fallback host).
    banner.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'right:0',
      'height:28px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:12px',
      'padding:0 12px',
      'background:var(--surface, #ffffff)',
      'color:var(--ink-2, #555)',
      'border-bottom:1px solid var(--line, #e5e5e5)',
      'font-family:var(--sans, system-ui, sans-serif)',
      'font-size:12px',
      'z-index:140',
      'pointer-events:auto',
      'box-sizing:border-box',
    ].join(';');

    labelEl = document.createElement('span');
    labelEl.setAttribute('data-template-banner-label', '');
    banner.appendChild(labelEl);

    linkEl = document.createElement('a');
    linkEl.setAttribute('data-template-banner-link', '');
    linkEl.target = '_blank';
    linkEl.rel = 'noopener';
    linkEl.style.cssText = 'color:inherit;text-decoration:underline;';
    linkEl.textContent = 'Manage entries →';
    banner.appendChild(linkEl);

    dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('aria-label', 'Dismiss banner');
    dismissBtn.setAttribute('data-template-banner-dismiss', '');
    dismissBtn.textContent = '✕';
    dismissBtn.style.cssText = [
      'position:absolute',
      'right:8px',
      'top:50%',
      'transform:translateY(-50%)',
      'appearance:none',
      'background:transparent',
      'border:none',
      'color:inherit',
      'cursor:pointer',
      'font-size:14px',
      'line-height:1',
      'padding:2px 6px',
    ].join(';');
    // Closure captures `banner` (current node) and `ctx`. The handler
    // re-resolves the active page at click time — if the Owner switched
    // pages between mount and click, dismissal pins to whatever page is
    // currently showing the banner (which by construction is the page id
    // the label was rendered for, since switching pages re-runs sync).
    dismissBtn.addEventListener('click', function () {
      const current = ctx.currentPage();
      if (current === null) return;
      markTemplateBannerDismissed(current.id);
      if (ctx.viewport !== null) removeTemplateBanner(ctx.viewport);
    });
    banner.appendChild(dismissBtn);

    host.appendChild(banner);
  } else {
    // Re-resolve the in-place children we already know exist on the banner.
    // Querying by data-* attribute keeps the lookup robust to style edits.
    labelEl = banner.querySelector('[data-template-banner-label]') as HTMLSpanElement;
    linkEl = banner.querySelector('[data-template-banner-link]') as HTMLAnchorElement;
  }

  // Update mutable content. Setting textContent / href every tick is cheap
  // and lets a collectionSlug change reflect without re-mounting.
  labelEl.textContent = labelText;
  linkEl.href = manageHref;
}

// Live-apply page-level visual properties on the artboard.
export function applyPageStyles(ctx: EditorContext, page: CanvasPage): void {
  if (!ctx.root) return;
  const artboard = ctx.root.querySelector('[data-page-id="' + cssEscape(page.id) + '"]');
  if (!artboard) return;
  const article = artboard.querySelector<HTMLElement>('.opencanvas-page');
  if (article) {
    ctx.applyPageMotionAttributes(article, page);
    ctx.applyPageStyleProperties(article, page);
    const renderWidth = ctx.pageRenderWidth(page);
    const sections = article.querySelectorAll('[data-opencanvas-section]');
    for (let i = 0; i < sections.length; i++) {
      (sections[i] as HTMLElement).style.width = renderWidth + 'px';
    }
  }
}
