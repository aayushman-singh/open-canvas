// src/editor-client/hydrate-interactives.ts
//
// TS-native counterpart to the visitor IIFE runtime. The visitor receives
// an inline <script> built from `RUNTIME_ENTRY_SRC + CAROUSEL_RUNTIME_SRC +
// ACCORDION_RUNTIME_SRC + POPUP_RUNTIME_SRC` (see
// `src/interactive/build.ts`). The editor — whose DOM is constructed by
// `body-builders-data.ts` rather than a pre-rendered snapshot — calls
// `hydrateInteractives()` to mount the SAME behaviour on its live DOM.
// The functions below mirror the runtime fragments line-by-line.
//
// Why this lives here and not under `src/interactive/`: the visitor-side
// modules in `src/interactive/` ship as JS source strings (vanilla ES5,
// no DOM types pulled in) so the root tsconfig's worker-typed compile
// stays tight. This module reaches for the DOM directly, which only the
// `editor-client` tsconfig allows (`lib: ["DOM", ...]`).
//
// Editor-vs-visitor contract differences:
//   - The editor calls this AFTER every renderAll so newly-mounted
//     carousels / accordions get listeners.
//   - The editor passes `{ skipPopups: true }` so a delay-popup or
//     exit-intent popup never fires while the Owner is editing — popups
//     are visitor-only chrome.
//   - Every event handler calls stopPropagation so the editor's drag/select
//     root listener on `ctx.root` does NOT receive the click. The visitor
//     runtime doesn't need this (no competing root listener) but the same
//     handler runs against both, so the visitor pays one cheap no-op.
//   - Idempotent — re-running against an already-hydrated wrapper short-
//     circuits via the `data-opencanvas-hydrated="true"` flag, matching the
//     visitor runtime's contract.

export interface HydrateOptions {
  /** When true, popup sections (`[data-opencanvas-popup="true"]`) are
   *  skipped. The editor passes `true` so an Owner editing a popup-
   *  triggered section doesn't get the popup chrome (overlay + close
   *  button) hijacking the canvas. Defaults to false (full visitor parity). */
  skipPopups?: boolean;
}

/**
 * Walk `root` (any element subtree, typically the editor's canvas-root)
 * and hydrate every `[data-opencanvas-interactive]` element that is not
 * already hydrated.
 *
 * Mirrors the visitor runtime's `hydrateAll()` dispatch in
 * `./runtime.ts` — same data-attribute contract, same idempotence guard.
 */
export function hydrateInteractives(
  root: ParentNode,
  options: HydrateOptions = {},
): void {
  const wrappers = root.querySelectorAll('[data-opencanvas-interactive]');
  for (let i = 0; i < wrappers.length; i++) {
    const wrapper = wrappers[i];
    if (!(wrapper instanceof HTMLElement)) continue;
    if (wrapper.getAttribute('data-opencanvas-hydrated') === 'true') continue;
    wrapper.setAttribute('data-opencanvas-hydrated', 'true');
    const kind = wrapper.getAttribute('data-opencanvas-interactive');
    if (kind === 'carousel') {
      hydrateCarousel(wrapper);
    } else if (kind === 'accordion') {
      hydrateAccordion(wrapper);
    } else {
      // Unknown interactive kind. Per the no-fallback rule, log loudly so
      // a future interactive added without a TS hydrator surfaces here
      // instead of silently no-oping in the editor.
       
      console.error(
        '[hydrateInteractives] unknown interactive kind "' +
          String(kind) +
          '" on element ' +
          (wrapper.id || '<no id>') +
          '; add a hydrator to src/interactive/hydrate.ts',
      );
    }
  }
  if (!options.skipPopups) {
    hydratePopups(root);
  }
}

// ---------------------------------------------------------------------------
// Carousel — mirrors CAROUSEL_RUNTIME_SRC in `./carousel.ts`. Same selector
// shape, same index clamp, same dot aria-selected mirroring. Adds
// stopPropagation so the editor's root drag/select handler does NOT also
// fire when the Owner clicks an arrow / dot. The visitor runtime omits
// stopPropagation; the editor's drag-resize wiring separately bails on
// pointerdown when the target is inside an arrow / dot (see
// `src/editor-client/drag-resize.ts`).
// ---------------------------------------------------------------------------

function hydrateCarousel(root: HTMLElement): void {
  const countAttr = root.getAttribute('data-opencanvas-slide-count');
  const count = countAttr ? parseInt(countAttr, 10) : 0;
  if (!(count > 0)) {
    // Empty carousel — nothing to hydrate. Mirror visitor runtime: a zero-
    // slide carousel renders only the chrome and the wrapper.
    return;
  }
  function readIndex(): number {
    const raw = root.getAttribute('data-opencanvas-slide-index');
    let n = raw ? parseInt(raw, 10) : 0;
    if (isNaN(n) || n < 0) n = 0;
    if (n > count - 1) n = count - 1;
    return n;
  }
  function setIndex(next: number): void {
    let n = next;
    if (n < 0) n = 0;
    if (n > count - 1) n = count - 1;
    root.setAttribute('data-opencanvas-slide-index', String(n));
    const dots = root.querySelectorAll('[data-opencanvas-carousel-dot]');
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (!dot) continue;
      const dotIdx = parseInt(dot.getAttribute('data-opencanvas-carousel-dot') || '0', 10);
      dot.setAttribute('aria-selected', dotIdx === n ? 'true' : 'false');
    }
  }
  // Each event handler stops propagation so the editor's root mousedown +
  // click listeners don't ALSO process the same event (drag-start or
  // element-deselect). Mousedown blockers run before drag-resize's root
  // mousedown handler thanks to bubble-order.
  function block(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const prev = root.querySelector('[data-opencanvas-carousel-prev]');
  if (prev) {
    prev.addEventListener('mousedown', block);
    prev.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setIndex(readIndex() - 1);
    });
  }
  const next = root.querySelector('[data-opencanvas-carousel-next]');
  if (next) {
    next.addEventListener('mousedown', block);
    next.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setIndex(readIndex() + 1);
    });
  }
  const dots = root.querySelectorAll('[data-opencanvas-carousel-dot]');
  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i];
    if (!dot) continue;
    ((capturedDot: Element): void => {
      capturedDot.addEventListener('mousedown', block);
      capturedDot.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const target = parseInt(
          capturedDot.getAttribute('data-opencanvas-carousel-dot') || '0',
          10,
        );
        setIndex(target);
      });
    })(dot);
  }
}

// ---------------------------------------------------------------------------
// Accordion — mirrors ACCORDION_RUNTIME_SRC in `./accordion.ts`. Multi-open
// vs single-open semantics, aria-expanded mirroring, hidden attr toggle on
// the body region. Same Enter / Space keyboard contract.
// ---------------------------------------------------------------------------

function hydrateAccordion(root: HTMLElement): void {
  const multi = root.getAttribute('data-opencanvas-allow-multi-open') === 'true';
  function setItemOpen(item: Element, open: boolean): void {
    if (open) {
      item.setAttribute('data-opencanvas-acc-open', 'true');
    } else {
      item.removeAttribute('data-opencanvas-acc-open');
    }
    const toggles = item.querySelectorAll('[data-opencanvas-acc-toggle]');
    for (let i = 0; i < toggles.length; i++) {
      const t = toggles[i];
      if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    const bodies = item.querySelectorAll('[data-opencanvas-acc-body]');
    for (let j = 0; j < bodies.length; j++) {
      const b = bodies[j];
      if (!b) continue;
      if (open) {
        b.removeAttribute('hidden');
      } else {
        b.setAttribute('hidden', '');
      }
    }
  }
  function toggleItem(item: Element): void {
    const currentlyOpen = item.getAttribute('data-opencanvas-acc-open') === 'true';
    const willOpen = !currentlyOpen;
    if (willOpen && !multi) {
      const siblings = root.querySelectorAll('[data-opencanvas-acc-item]');
      for (let i = 0; i < siblings.length; i++) {
        const sib = siblings[i];
        if (sib && sib !== item) setItemOpen(sib, false);
      }
    }
    setItemOpen(item, willOpen);
  }
  const toggles = root.querySelectorAll('[data-opencanvas-acc-toggle]');
  for (let k = 0; k < toggles.length; k++) {
    const toggle = toggles[k];
    if (!toggle) continue;
    ((capturedToggle: Element): void => {
      const item = capturedToggle.closest('[data-opencanvas-acc-item]');
      if (!item) return;
      capturedToggle.addEventListener('mousedown', function (ev: Event) {
        // Block the editor's root mousedown from starting a drag on the
        // accordion wrapper.
        ev.stopPropagation();
      });
      capturedToggle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleItem(item);
      });
      capturedToggle.addEventListener('keydown', function (event: Event) {
        const ke = event as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ' || ke.key === 'Spacebar') {
          event.preventDefault();
          event.stopPropagation();
          toggleItem(item);
        }
      });
    })(toggle);
  }
}

// ---------------------------------------------------------------------------
// Popup — mirrors POPUP_RUNTIME_SRC in `./popup.ts`. Visitor-only. The
// editor calls `hydrateInteractives(root, { skipPopups: true })` so this
// code path never runs in edit mode. Kept here so a future "Preview" mode
// can opt in.
// ---------------------------------------------------------------------------

function hydratePopups(root: ParentNode): void {
  const els = root.querySelectorAll('[data-opencanvas-popup="true"]');
  for (let i = 0; i < els.length; i++) {
    const sec = els[i];
    if (!(sec instanceof HTMLElement)) continue;
    if (sec.getAttribute('data-opencanvas-popup-hydrated') === 'true') continue;
    sec.setAttribute('data-opencanvas-popup-hydrated', 'true');
    ((capturedSec: HTMLElement): void => {
      const id = capturedSec.getAttribute('data-opencanvas-section');
      const type = capturedSec.getAttribute('data-opencanvas-trigger-type');
      const val = parseInt(capturedSec.getAttribute('data-opencanvas-trigger-value') || '0', 10);
      const key = 'opencanvas-popup-dismissed-' + String(id);
      try {
        if (window.localStorage.getItem(key)) return;
      } catch {
        // localStorage may throw in privacy mode; fail loudly via console
        // but still allow the popup to show — the dismissal is best-effort.
         
        console.error('[hydratePopups] localStorage.getItem failed for key=' + key);
      }
      const originalStyle = capturedSec.getAttribute('style');
      let fired = false;
      function show(): void {
        if (fired) return;
        fired = true;
        const bg = document.createElement('div');
        bg.style.cssText =
          'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5)';
        const btn = document.createElement('button');
        btn.setAttribute('aria-label', 'Close popup');
        btn.style.cssText =
          'position:fixed;top:16px;right:16px;z-index:100000;background:none;border:none;color:#fff;font-size:24px;cursor:pointer';
        btn.textContent = 'x';
        capturedSec.style.display = 'block';
        capturedSec.style.position = 'fixed';
        capturedSec.style.top = '50%';
        capturedSec.style.left = '50%';
        capturedSec.style.transform = 'translate(-50%,-50%)';
        capturedSec.style.zIndex = '99999';
        capturedSec.style.maxWidth = '90vw';
        capturedSec.style.maxHeight = '90vh';
        capturedSec.style.overflow = 'auto';
        document.body.appendChild(bg);
        document.body.appendChild(btn);
        function close(): void {
          try {
            window.localStorage.setItem(key, '1');
          } catch {
            // see localStorage.getItem comment above
          }
          if (originalStyle === null) {
            capturedSec.removeAttribute('style');
          } else {
            capturedSec.setAttribute('style', originalStyle);
          }
          if (bg.parentNode) bg.parentNode.removeChild(bg);
          if (btn.parentNode) btn.parentNode.removeChild(btn);
        }
        btn.addEventListener('click', close);
        bg.addEventListener('click', close);
      }
      if (type === 'exit-intent') {
        document.documentElement.addEventListener('mouseleave', function (e: MouseEvent) {
          if (e.clientY <= 0) show();
        });
      } else if (type === 'delay') {
        setTimeout(show, val || 3000);
      } else if (type === 'scroll') {
        const thr = val || 50;
        window.addEventListener('scroll', function () {
          if (document.documentElement.scrollHeight <= window.innerHeight) return;
          const pct =
            (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
          if (pct >= thr) show();
        });
      }
    })(sec);
  }
}
