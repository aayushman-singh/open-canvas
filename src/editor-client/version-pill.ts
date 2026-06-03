// src/editor-client/version-pill.ts
//
// ADR 0058 Phase 2q.j — version-badge social-preview popover.
// canvas-client.ts:13328-13335 (closeVersionPill),
// canvas-client.ts:13337-13343 (onVersionPillOutside),
// canvas-client.ts:13345-13350 (onVersionPillKey),
// canvas-client.ts:13352-13425 (openVersionPill),
// canvas-client.ts:13427-13432 (attachVersionBadge) carry the inline
// twins. All retire on ADR 0015 Phase 3 atomic cutover; until then,
// the inline IIFE is the production source-of-truth and this module
// is dead code.
//
// The version badge in the editor header doubles as a "show me what
// social embeds will see" affordance. Clicking opens this popover —
// the title + description + og:image + URL that src/seo/meta-emit.ts
// ships on the published HTML. The popover surfaces draft-vs-live
// state via a chip + the "View live site" link (live only).
//
// Five functions live here:
//
//   - closeVersionPillImpl(ctx) — remove the popover from the DOM,
//     drop aria-expanded, and detach the outside/escape listeners.
//     The listener references are stored on ctx (not module-level)
//     so add/remove pair the SAME function — the IIFE twin uses
//     top-level named declarations for this; on ctx we lazily create
//     the closures and pin them on the context.
//
//   - openVersionPillImpl(ctx) — build the popover (header with
//     "Social preview" + draft/live chip, optional og:image, title +
//     description + URL card, optional "View live site" link), mount
//     under document.body anchored to the version badge, and wire
//     the outside/escape close listeners. Re-entrant: a second click
//     while open closes the existing pill (badge becomes a toggle).
//
//   - attachVersionBadgeImpl(ctx) — wire the badge click to
//     openVersionPill. Click dispatches through ctx.openVersionPill so
//     post-cutover wrappers can intercept without re-binding.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';

export function closeVersionPillImpl(ctx: EditorContext): void {
  if (!ctx.versionPill) return;
  if (ctx.versionPill.parentNode) {
    ctx.versionPill.parentNode.removeChild(ctx.versionPill);
  }
  ctx.versionPill = null;
  if (ctx.versionBadge) ctx.versionBadge.setAttribute('aria-expanded', 'false');
  if (ctx.versionPillOutsideHandler) {
    document.removeEventListener('mousedown', ctx.versionPillOutsideHandler, true);
    ctx.versionPillOutsideHandler = null;
  }
  if (ctx.versionPillKeyHandler) {
    document.removeEventListener('keydown', ctx.versionPillKeyHandler, true);
    ctx.versionPillKeyHandler = null;
  }
}

export function openVersionPillImpl(ctx: EditorContext): void {
  if (ctx.versionPill) {
    closeVersionPillImpl(ctx);
    return;
  }
  if (!ctx.versionBadge) return;
  const parsedVersion = parseInt(
    ctx.versionBadge.getAttribute('data-version') || '0',
    10,
  );
  const version = Number.isFinite(parsedVersion) ? parsedVersion : 0;
  const page =
    ctx.state && Array.isArray(ctx.state.pages) && ctx.state.pages.length > 0
      ? ctx.state.pages[0]!
      : null;
  const addressEl = document.querySelector('.opencanvas-editor-header .address');
  const addressText =
    addressEl && addressEl.textContent ? addressEl.textContent.trim() : '';

  const pill = document.createElement('div');
  pill.className = 'opencanvas-version-pill';
  pill.setAttribute('role', 'dialog');
  pill.setAttribute('aria-label', 'Social preview');

  const head = document.createElement('div');
  head.className = 'opencanvas-version-pill-head';
  const title = document.createElement('span');
  title.className = 'opencanvas-version-pill-title';
  title.textContent = 'Social preview';
  const chip = document.createElement('span');
  chip.className =
    version > 0
      ? 'opencanvas-version-pill-chip live'
      : 'opencanvas-version-pill-chip draft';
  chip.textContent = version > 0 ? 'v' + version + ' live' : 'Draft';
  head.appendChild(title);
  head.appendChild(chip);
  pill.appendChild(head);

  if (page && page.ogImageAssetId) {
    const img = document.createElement('img');
    img.className = 'opencanvas-version-pill-image';
    img.alt = '';
    img.src = ctx.siteBase + '/assets/' + encodeURIComponent(page.ogImageAssetId);
    pill.appendChild(img);
  }

  const card = document.createElement('div');
  card.className = 'opencanvas-version-pill-card';
  const cardTitle = document.createElement('div');
  cardTitle.className = 'opencanvas-version-pill-card-title';
  cardTitle.textContent = page && page.title ? page.title : 'Untitled site';
  const cardDesc = document.createElement('div');
  cardDesc.className = 'opencanvas-version-pill-card-desc';
  cardDesc.textContent =
    page && page.description ? page.description : 'No meta description set.';
  const cardUrl = document.createElement('div');
  cardUrl.className = 'opencanvas-version-pill-card-url';
  cardUrl.textContent = addressText || 'Not published yet';
  card.appendChild(cardTitle);
  card.appendChild(cardDesc);
  card.appendChild(cardUrl);
  pill.appendChild(card);

  if (version > 0 && addressText) {
    const actions = document.createElement('div');
    actions.className = 'opencanvas-version-pill-actions';
    const view = document.createElement('a');
    view.className = 'opencanvas-version-pill-view';
    view.href = 'https://' + addressText;
    view.target = '_blank';
    view.rel = 'noopener';
    view.textContent = 'View live site';
    actions.appendChild(view);
    pill.appendChild(actions);
  }

  document.body.appendChild(pill);
  const rect = ctx.versionBadge.getBoundingClientRect();
  pill.style.position = 'fixed';
  pill.style.top = rect.bottom + 6 + 'px';
  const right = window.innerWidth - rect.right;
  pill.style.right = Math.max(8, right) + 'px';
  ctx.versionPill = pill;
  ctx.versionBadge.setAttribute('aria-expanded', 'true');

  // Listener identities pinned on ctx so close pairs the same fn refs.
  // The IIFE twin uses top-level named declarations; we create closures
  // here that close over ctx and pin them so close can find them.
  const outsideHandler = (ev: MouseEvent): void => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    if (ctx.versionPill && ctx.versionPill.contains(target)) return;
    if (target.closest('#canvas-version')) return;
    ctx.closeVersionPill();
  };
  const keyHandler = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ctx.closeVersionPill();
    }
  };
  ctx.versionPillOutsideHandler = outsideHandler;
  ctx.versionPillKeyHandler = keyHandler;
  document.addEventListener('mousedown', outsideHandler, true);
  document.addEventListener('keydown', keyHandler, true);
}

export function attachVersionBadgeImpl(ctx: EditorContext): void {
  if (!ctx.versionBadge) return;
  ctx.versionBadge.addEventListener('click', () => {
    ctx.openVersionPill();
  });
}
