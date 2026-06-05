// src/ui/theme.ts
//
// Open Canvas token layer, exported as a CSS string for inlining into the
// per-route <style> blocks the chrome uses (landing/styles.ts,
// editor/canvas-styles.ts, routes/dashboard/shell.tsx).
//
// `themeCss` is the byte-identical twin of `src/ui/theme.css` — the .css
// file is the canonical artifact for design review; this .ts re-exports
// the same content because the rev01 build inlines CSS via template
// strings (Wrangler/esbuild, no css-loader). If you edit one, edit both.
//
// `themeFontHeadHtml` is the Google Fonts <link> trio the Open Canvas
// type stack (Bricolage Grotesque / Hanken Grotesk / Spline Sans Mono)
// requires. Inject it into every page <head> via raw().

import type { Context } from 'hono';

export type Theme = 'light' | 'dark';

// Anchored regex: matches the `oc-theme=light|dark` cookie pair only when it
// sits at the start of the header or immediately after a `; ` separator. The
// captured value is restricted to the literal alternation `light|dark` so
// arbitrary cookie content (including encoded payloads, semicolons, or
// header-injection attempts) cannot escape the alternation — anything else
// returns undefined. The cookie writer (themeToggleScript) emits exactly
// these two values, so this is the complete legal alphabet.
const THEME_COOKIE_RE = /(?:^|;\s*)oc-theme=(light|dark)(?:;|$)/;

/**
 * Read the `oc-theme` cookie set by `themeToggleScript`. Returns the
 * stamped theme when present, undefined when the visitor has not toggled
 * yet (light is the implicit default — chrome surfaces should omit
 * `data-theme` in that case so the boot script remains a no-op).
 *
 * SSR routes call this before rendering `<html>` so the data-theme
 * attribute lands in the server response and no flash appears before JS.
 */
export function readThemeCookie(c: Context): Theme | undefined {
  const raw = c.req.header('cookie');
  if (!raw) return undefined;
  const match = THEME_COOKIE_RE.exec(raw);
  return match ? (match[1] as Theme) : undefined;
}

export const themeCss = `/* ============================================================
   Open Canvas — theme.css
   DROP-IN token layer for the rev01 codebase.
   See src/ui/theme.css for the canonical source of these tokens.
   ============================================================ */

:root {
  /* neutrals (warm, low-chroma) */
  --paper:#FBFAF8; --surface:#FFFFFF; --surface-2:#F4F1EC; --surface-3:#ECE8E1;
  --ink:#1A1917; --ink-2:#5B564E; --ink-3:#948D82;
  --line:#ECE7DF; --line-2:#DCD6CB;

  /* brand red */
  --red:#E84D4A; --red-strong:#D33C39; --red-ink:#C5332F;
  --red-soft:#FBEDEC; --red-tint:#FCF4F3; --red-line:#F4CFCD;

  /* feedback */
  --ok:#2E9E6B; --ok-soft:#E6F5EE; --warn:#D98A1F; --warn-soft:#FBF1DE;

  /* shape */
  --r-xs:8px; --r-sm:12px; --r:16px; --r-lg:22px; --r-xl:28px; --r-pill:999px;

  /* shadows (warm-neutral) */
  --shadow-sm:0 1px 2px rgba(40,34,26,.05),0 2px 6px rgba(40,34,26,.04);
  --shadow:0 2px 6px rgba(40,34,26,.06),0 12px 28px -10px rgba(40,34,26,.14);
  --shadow-lg:0 4px 12px rgba(40,34,26,.07),0 28px 60px -18px rgba(40,34,26,.22);
  --shadow-red:0 8px 22px -8px rgba(232,77,74,.5);

  /* type */
  --display:"Bricolage Grotesque","Hanken Grotesk",system-ui,sans-serif;
  --sans:"Hanken Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"Spline Sans Mono",ui-monospace,SFMono-Regular,monospace;
  --ring:0 0 0 4px rgba(232,77,74,.22);
}

[data-theme="dark"] {
  --paper:#16140F; --surface:#201D17; --surface-2:#2A261F; --surface-3:#353027;
  --ink:#F6F2E9; --ink-2:#B7AFA1; --ink-3:#837B6D;
  --line:rgba(255,255,255,.10); --line-2:rgba(255,255,255,.17);
  --red:#FF6257; --red-strong:#FF7468; --red-ink:#FF8378;
  --red-soft:rgba(255,98,87,.15); --red-tint:rgba(255,98,87,.08); --red-line:rgba(255,98,87,.32);
  --ok-soft:rgba(46,158,107,.18); --warn-soft:rgba(217,138,31,.18);
  --shadow-sm:0 1px 2px rgba(0,0,0,.4);
  --shadow:0 2px 8px rgba(0,0,0,.4),0 16px 36px -14px rgba(0,0,0,.6);
  --shadow-lg:0 4px 14px rgba(0,0,0,.45),0 32px 70px -20px rgba(0,0,0,.7);
  --shadow-red:0 8px 24px -8px rgba(255,98,87,.5);
  --ring:0 0 0 4px rgba(255,98,87,.28);
}

/* ---- ALIAS: dashboard shell.tsx + landing mapped names ---- */
:root {
  --bg:var(--paper); --panel:var(--surface); --panel-strong:var(--surface-2);
  --text:var(--ink); --muted:var(--ink-2); --faint:var(--ink-3);
  --accent:var(--red); --radius:var(--r);
}

/* ---- ALIAS: landing/styles.ts + templates.styles.ts ---- */
:root {
  --bg-deep:var(--paper); --bg-panel:var(--surface); --bg-panel-strong:var(--surface-2);
  --bg-titlebar:var(--surface-2);
  --fg:var(--ink); --fg-mute:var(--ink-2); --fg-faint:var(--ink-3);
  --accent-soft:var(--red-soft); --accent-glow:var(--red-soft);
  --hairline:var(--line); --hairline-strong:var(--line-2);
  --grid:var(--line);
  --font-sans:var(--sans); --font-mono:var(--mono);
}

/* ---- ALIAS: editor canvas-styles.ts (--opencanvas-*) ---- */
:root {
  --opencanvas-bg:var(--paper); --opencanvas-bg-panel:var(--surface);
  --opencanvas-bg-panel-strong:var(--surface-2); --opencanvas-bg-titlebar:var(--surface-2);
  --opencanvas-fg:var(--ink); --opencanvas-fg-mute:var(--ink-2); --opencanvas-fg-faint:var(--ink-3);
  --opencanvas-accent:var(--red); --opencanvas-accent-soft:var(--red-soft);
  --opencanvas-warn:var(--warn); --opencanvas-ok:var(--ok); --opencanvas-danger:var(--red);
  --opencanvas-hairline:var(--line); --opencanvas-hairline-strong:var(--line-2);
  --opencanvas-radius:var(--r);
  --opencanvas-font-sans:var(--sans); --opencanvas-font-mono:var(--mono);
}
`;

// Open Canvas component primitives (buttons, chips, cards, fields, switch,
// utilities, sub-page sidebar/topbar shell). Byte-identical twin of
// src/ui/components.css — the .css file is the canonical artifact for
// design review; this string is what the Wrangler/esbuild template-literal
// pipeline actually inlines into each chrome host's <style>. Edit one,
// edit both.
//
// Inject AFTER themeCss (so tokens are defined before the rules read them)
// and BEFORE per-page CSS (so route-specific overrides retain higher
// specificity). Visitor sites (canvas/public-styles.ts) never consume
// this — published output is unaffected.
export const componentsCss = `/* ============================================================
   Open Canvas — components.css
   See src/ui/components.css for the canonical source.
   ============================================================ */

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  font-family: var(--sans);
  background: var(--paper);
  color: var(--ink);
  font-size: 16px;
  line-height: 1.6;
  font-weight: 420;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  transition: background-color .35s ease, color .35s ease;
}

h1, h2, h3, h4, h5 {
  font-family: var(--display);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  margin: 0;
  color: var(--ink);
}

p { margin: 0; }

a { color: inherit; text-decoration: none; }

::selection { background: var(--red); color: #fff; }

/* ---------- brand lockup ---------- */
.oc-logo { display: inline-flex; align-items: center; gap: 11px; }
.oc-logo svg { display: block; flex-shrink: 0; }
.oc-logo .oc-word {
  font-family: var(--display);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 17px;
  color: var(--ink);
  line-height: 1;
}

/* ---------- the signature marker bar ---------- */
.marker {
  position: relative;
  display: inline-block;
  color: var(--ink);
  padding: 0 2px 0.06em;
  background-image: linear-gradient(var(--red), var(--red));
  background-repeat: no-repeat;
  background-position: 50% 100%;
  background-size: 100% 0.13em;
}

.eyebrow {
  font-family: var(--sans);
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--red-ink);
  display: inline-block;
  white-space: nowrap;
  padding-left: 31px;
  background-image: linear-gradient(var(--red), var(--red));
  background-repeat: no-repeat;
  background-size: 22px 3px;
  background-position: 0 0.62em;
}

/* ---------- buttons ---------- */
.btn {
  font-family: var(--sans);
  font-weight: 650;
  font-size: 14.5px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--r-pill);
  border: 1.5px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: transform .12s ease, box-shadow .18s ease, background-color .18s ease, border-color .18s ease, color .18s ease;
  -webkit-user-select: none; user-select: none;
}
.btn:active { transform: translateY(1px); }
.btn svg { display: block; }

.btn-primary {
  background: var(--red);
  color: #fff;
  box-shadow: var(--shadow-red);
}
.btn-primary:hover { background: var(--red-strong); transform: translateY(-1px); }

.btn-ink {
  background: var(--ink);
  color: var(--paper);
}
.btn-ink:hover { transform: translateY(-1px); box-shadow: var(--shadow); }

.btn-outline {
  background: var(--surface);
  color: var(--ink);
  border-color: var(--line-2);
}
.btn-outline:hover { border-color: var(--ink); }

.btn-ghost {
  background: transparent;
  color: var(--ink-2);
}
.btn-ghost:hover { background: var(--surface-2); color: var(--ink); }

.btn-sm { padding: 8px 14px; font-size: 13px; }
.btn-lg { padding: 15px 26px; font-size: 16px; }

/* ---------- chips / pills ---------- */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  padding: 5px 12px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  border: 1px solid var(--line);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.chip-red { background: var(--red-soft); border-color: var(--red-line); color: var(--red-ink); }
.chip-ok { background: var(--ok-soft); border-color: transparent; color: var(--ok); }
.chip .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

.chip-url {
  font-family: var(--mono);
  font-weight: 500;
  letter-spacing: -0.01em;
}

/* ---------- cards / surfaces ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
}

/* ---------- inputs ---------- */
.field {
  font-family: var(--sans);
  font-size: 14.5px;
  color: var(--ink);
  background: var(--surface);
  border: 1.5px solid var(--line-2);
  border-radius: var(--r-sm);
  padding: 11px 14px;
  width: 100%;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.field::placeholder { color: var(--ink-3); }
.field:focus { outline: none; border-color: var(--red); box-shadow: var(--ring); }

label.lbl {
  display: block;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-2);
  margin-bottom: 7px;
}

/* ---------- toggle switch ---------- */
.switch { position: relative; display: inline-block; width: 46px; height: 27px; flex-shrink: 0; }
.switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.switch .track { position: absolute; inset: 0; background: var(--surface-3); border-radius: var(--r-pill); transition: background .18s ease; cursor: pointer; }
.switch .track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 21px; height: 21px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-sm); transition: transform .18s ease; }
.switch input:checked + .track { background: var(--red); }
.switch input:checked + .track::after { transform: translateX(19px); }

/* ---------- toggle (light/dark) ---------- */
.theme-toggle {
  width: 40px; height: 40px;
  border-radius: var(--r-pill);
  border: 1.5px solid var(--line-2);
  background: var(--surface);
  color: var(--ink);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: border-color .15s, background .15s, transform .12s;
}
.theme-toggle:hover { border-color: var(--ink); }
.theme-toggle:active { transform: scale(0.94); }
.theme-toggle .moon { display: none; }
[data-theme="dark"] .theme-toggle .sun { display: none; }
[data-theme="dark"] .theme-toggle .moon { display: block; }
.nav .theme-toggle { width: 32px; height: 32px; }
.nav .theme-toggle svg { width: 16px; height: 16px; }

/* ---------- canvas-frame decoration (brand motif) ---------- */
.canvas-frame { position: relative; }
.canvas-frame::after {
  content: "";
  position: absolute;
  inset: -10px;
  border: 1.5px solid var(--ink);
  border-radius: 2px;
  pointer-events: none;
  opacity: 0.16;
}

/* utility */
.muted { color: var(--ink-2); }
.faint { color: var(--ink-3); }
.mono { font-family: var(--mono); }
.center { text-align: center; }
.stack { display: flex; flex-direction: column; }
.row { display: flex; align-items: center; }
.wrap { width: min(1200px, calc(100vw - 48px)); margin: 0 auto; }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}

/* ===== site sub-page shell (sidebar + topbar) ===== */
.app { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
.side { border-right: 1px solid var(--line); padding: 16px 14px; display: flex; flex-direction: column; gap: 3px; position: sticky; top: 0; height: 100vh; background: var(--surface); }
.side .back { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ink-3); padding: 6px 8px 14px; }
.side .back:hover { color: var(--ink); }
.side .site-id { display: flex; align-items: center; gap: 10px; padding: 6px 8px 14px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
.side .site-id .ic { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg,#E9837A,#C5332F); flex-shrink: 0; }
.side .site-id b { font-size: 14.5px; font-family: var(--display); }
.side .site-id small { display: block; font-size: 11px; color: var(--ink-3); }
.side a.nav { display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: 11px; font-size: 14px; font-weight: 550; color: var(--ink-2); transition: background .14s, color .14s; }
.side a.nav svg { width: 17px; height: 17px; flex-shrink: 0; }
.side a.nav:hover { background: var(--surface-2); color: var(--ink); }
.side a.nav.active { background: var(--red-soft); color: var(--red-ink); font-weight: 650; }
.side .spacer { flex: 1; }
.main { min-width: 0; }
.topbar { height: 64px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 14px; padding: 0 28px; position: sticky; top: 0; background: color-mix(in srgb, var(--paper) 90%, transparent); backdrop-filter: blur(10px); z-index: 30; }
.topbar .crumb { font-size: 14px; color: var(--ink-2); }
.topbar .crumb b { color: var(--ink); }
.topbar .sp { flex: 1; }
.content { padding: 34px 28px 70px; max-width: 860px; }
.content > h1 { font-size: 32px; letter-spacing: -.03em; }
.content > .sub { color: var(--ink-2); margin: 6px 0 28px; }
@media (max-width: 720px) { .app { grid-template-columns: 1fr; } .side { display: none; } }
`;

// Google Fonts <link> trio for the Open Canvas type stack.
// Injected via raw() into every page <head> so the chrome surfaces
// Bricolage Grotesque (display), Hanken Grotesk (body), and Spline Sans
// Mono (code / address chip). Visitor sites are unaffected — their
// fonts come from src/canvas/style-kits.ts.
export const themeFontHeadHtml = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400;450;500;600;700;800&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet">`;

// Pre-paint theme-restore script. Reads localStorage('oc-theme') and the
// `oc-theme` cookie (set on first toggle so SSR routes can stamp the
// attribute server-side later) and stamps `data-theme` on <html> BEFORE
// the body paints — avoids the dark/light flash on load. Inline this in
// <head> via `<script>{raw(themeBootScript)}</script>` on every chrome
// surface (dashboard shell, editor route, future landing/sub-pages) so
// theme persistence is single-sourced.
export const themeBootScript = `(function(){try{
  var t=localStorage.getItem('oc-theme');
  if(!t){var m=document.cookie.match(/(?:^|; )oc-theme=([^;]+)/);if(m)t=decodeURIComponent(m[1]);}
  if(t)document.documentElement.setAttribute('data-theme',t);
}catch(e){}})();`;

// Theme toggle: flips data-theme on <html>, persists to localStorage AND
// writes `oc-theme` cookie (path=/; SameSite=Lax; one year). Cookie lets
// SSR pages render the right palette without waiting for JS. Mount the
// `<button id="themeToggle">` somewhere in the chrome, then inject this
// script via `<script>{raw(themeToggleScript)}</script>` at body end on
// every chrome surface.
export const themeToggleScript = `(function(){
  var btn=document.getElementById('themeToggle');
  if(!btn)return;
  btn.addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',cur);
    try{localStorage.setItem('oc-theme',cur);}catch(e){}
    try{document.cookie='oc-theme='+cur+'; path=/; max-age=31536000; samesite=lax';}catch(e){}
  });
})();`;
