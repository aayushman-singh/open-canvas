// src/themes/visitor-mode/toggle-element.ts
//
// Wave 3 #20 — The mode-toggle Element. Owners drop this as a Section Recipe
// or pin it near navigation; the public renderer prints it verbatim. The
// element is a real `<button>` with the accessibility scaffolding visitors
// expect:
//
//   - `aria-pressed` — reflects the current mode. The toggle script updates
//     it on every click so screen readers announce the change.
//   - `aria-label` — describes the action in human language because the
//     visible content is a glyph (sun / moon).
//   - `data-rev01-mode-toggle` — selector hook for the toggle script.
//
// The toggle script (also returned by this module) is small (~15 lines): it
// reads the current `data-mode` from `<html>`, flips it, writes the cookie,
// and updates `aria-pressed`. It is identical across sites — there is no
// per-request templating, so the result is module-level cached.
//
// Why a string, not JSX: this module is consumed by the public renderer's
// HTML emitter (Wave 0 boundary). The renderer stamps strings into the body
// HTML it returns; everything has to be a self-contained chunk. JSX through
// hono/html would work too, but a string keeps the path simple — the toggle
// has no dynamic content.

/**
 * The HTML for the mode-toggle button, including its inline script. Drop
 * this string into the body where the toggle should appear. The script is
 * inert until the visitor clicks; first-paint mode is already correct
 * thanks to `getModeSetterScript()` running earlier.
 *
 * The returned HTML uses a wrapper `<div data-rev01-mode-toggle-mount>` so
 * the toggle script can find the button even when multiple toggles exist on
 * one page (it queries all `[data-rev01-mode-toggle]` buttons and wires
 * each independently).
 */
export function renderModeToggleHtml(): string {
  // The button starts with `aria-pressed="false"` (light = unpressed). The
  // toggle script flips it on mount to match the actual stamped `data-mode`
  // (because the visitor may have arrived in dark mode via cookie /
  // prefers-color-scheme — the server doesn't know which, so we sync after
  // the early script ran).
  const button =
    `<button type="button" data-rev01-mode-toggle aria-pressed="false" aria-label="Toggle light and dark mode" class="rev01-mode-toggle">` +
    // Sun + moon glyphs as SVG so the toggle reads correctly regardless of
    // the kit's text colour (the SVGs use `currentColor`). The CSS in
    // `MODE_TOGGLE_STYLES` swaps which one is visible based on `aria-pressed`.
    `<svg class="rev01-mode-toggle__sun" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>` +
    `<svg class="rev01-mode-toggle__moon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>` +
    `</button>`;
  return `<div data-rev01-mode-toggle-mount>${button}<style>${MODE_TOGGLE_STYLES}</style><script>${MODE_TOGGLE_SCRIPT}</script></div>`;
}

/**
 * Standalone toggle SCRIPT — exported so a future caller (e.g. auto-injection
 * near nav, owned by Wave 4 #16) can wire it up to its own DOM without
 * needing the wrapper HTML.
 */
export const MODE_TOGGLE_SCRIPT: string = String.raw`
(function(){
  var COOKIE='__rev01_cs';
  function read(){return document.documentElement.getAttribute('data-mode')==='dark'?'dark':'light';}
  function write(mode){
    document.documentElement.setAttribute('data-mode',mode);
    document.cookie=COOKIE+'='+mode+'; path=/; max-age=31536000; SameSite=Lax';
  }
  function sync(btn){var m=read();btn.setAttribute('aria-pressed',m==='dark'?'true':'false');}
  function wire(btn){
    sync(btn);
    btn.addEventListener('click',function(){
      var next=read()==='dark'?'light':'dark';
      write(next);
      document.querySelectorAll('[data-rev01-mode-toggle]').forEach(sync);
    });
  }
  document.querySelectorAll('[data-rev01-mode-toggle]').forEach(wire);
})();
`;

/**
 * Tiny stylesheet for the toggle. Self-contained so the public stylesheet
 * does not have to know about it. The icon-swap is driven by `aria-pressed`
 * — same attribute the screen reader uses, so visual + aural state cannot
 * drift.
 */
export const MODE_TOGGLE_STYLES: string = `
.rev01-mode-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--rev01-kit-accent, currentColor);
  background: transparent;
  color: var(--rev01-kit-text, currentColor);
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease;
}
.rev01-mode-toggle:hover { background: var(--rev01-kit-accent, currentColor); color: var(--rev01-kit-accent-text, var(--rev01-kit-bg, #000)); }
.rev01-mode-toggle__sun, .rev01-mode-toggle__moon { display: none; }
.rev01-mode-toggle[aria-pressed="false"] .rev01-mode-toggle__sun { display: inline-block; }
.rev01-mode-toggle[aria-pressed="true"]  .rev01-mode-toggle__moon { display: inline-block; }
`;
