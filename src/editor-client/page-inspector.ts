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
import type { CanvasPage, MotionPreset, ScrollTriggerMode } from '../canvas/schema.js';
import { MOTION_PRESETS, SCROLL_TRIGGER_MODES } from '../canvas/schema.js';
import { selectInput } from './dom-builders.js';
import { buildColorRow } from './inspector-leaf-builders.js';
import { cssEscape } from './css-escape.js';

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
    const preset = t.getAttribute('data-motion-preset') || t.getAttribute('data-entrance-animation');
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
    ctx.inspector.hidden = true;
    ctx.inspector.replaceChildren();
    ctx.inspectorRenderSubject = null;
    return;
  }
  // Local non-null alias so callback closures keep the narrowed type
  // without re-asserting on every read.
  const page = pageLookup;
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
