// src/password/gate.ts
//
// Renders the minimal "enter password" HTML page served by `requireUnlock`
// when a Visitor hits a password-protected site without a valid unlock
// cookie. The page is intentionally plain — no JS framework, no external
// fonts, no client-side scripting. A single `<form method="post">` posts the
// password to `/__opencanvas/unlock`; the unlock handler verifies, sets the
// cookie, and 303-redirects back to the original path.
//
// Why no JS:
//   - Smallest possible attack surface. The gate sits in front of the
//     Published Snapshot and must never become a vector for a stolen-cookie
//     XSS or a phishing prompt.
//   - The Visitor's first interaction with the site is the gate, so we
//     can't assume any JS-side state. A vanilla form submit is the safest
//     contract — works with cookies disabled? No, but cookies are required
//     for the unlock to persist anyway. The flow degrades cleanly: post the
//     form, get the cookie, see the site.
//
// Open Canvas chrome (MIGRATION.md §5h): the styling uses the OC design
// tokens (--paper / --ink / --red / --red-soft) inlined directly so the
// gate stays a single self-contained HTML document — no external font
// fetches, no theme-toggle button, no imports from src/ui/theme.ts (which
// would drag componentsCss in unnecessarily). A 4-line pre-paint script
// stamps data-theme from localStorage to avoid the light/dark flash for
// returning visitors. That is the only JS on the page.
//
// We do NOT try to resolve the site's Style Kit here because that would
// require a DB lookup on every gate render and leak the site's brand
// color before unlock — the gate is intentionally neutral so visitors
// can't enumerate which sites belong to which Owner just by looking at
// the gate.
//
// Failed-attempt rendering: when the unlock route 303-redirects back to the
// gate after a wrong password, it sets `?retry=1` in the URL. The gate
// inspects the query string at the page level (rendered by the middleware,
// not by client JS) and renders an inline error block when present.

interface GateOptions {
  /**
   * The path the Visitor was trying to reach. Echoed into a hidden form
   * field so the unlock handler can redirect back after success.
   */
  redirect: string;
  /**
   * Canonical app origin (`https://<APP_DOMAIN>`) used by the "Powered by
   * Open Canvas" wordmark at the bottom of the gate. ADR 0013: drives the
   * brand link target from env so a fork wears its own apex without source
   * edits.
   */
  appOrigin: string;
  /**
   * Render the "wrong password" error block. Set by the middleware when the
   * incoming request has `?retry=1` in the query string (the unlock handler
   * 303-redirects to that on a failed attempt).
   */
  showError?: boolean;
  /**
   * Render the "too many attempts" rate-limit error block. Set by the
   * middleware when the incoming request has `?ratelimited=1`. Same path as
   * `showError` but a different copy line so the Visitor knows to wait.
   */
  showRateLimit?: boolean;
  /**
   * Site name to show in the heading. Pure presentation — the renderer
   * accepts any string; the middleware passes `site.name` verbatim.
   */
  siteName: string;
  /**
   * Persisted chrome theme from the `oc-theme` cookie, when present. SSR
   * stamp on `<html>` so a returning visitor's dark choice renders dark on
   * first paint even before the inline boot script runs. The middleware
   * parses the cookie header with an anchored regex restricted to the
   * `light|dark` alphabet — any other value arrives here as undefined.
   */
  theme?: 'light' | 'dark';
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

// Validate `redirect` before stuffing it into a hidden input. We accept ONLY
// same-origin absolute paths (start with `/`, no `//`, no `\`, no schema).
// An open-redirect via the gate is exactly the kind of issue the
// all-or-nothing failure policy demands we trip loudly, but since the gate
// is the public surface we can't throw — we sanitise to `/` instead. That's
// the safe default for any malformed input.
function sanitiseRedirect(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return '/';
  // Strict: must start with a single `/`, then no `/` or `\` immediately
  // after (to block protocol-relative URLs like `//evil.com`).
  if (raw[0] !== '/') return '/';
  if (raw.length >= 2 && (raw[1] === '/' || raw[1] === '\\')) return '/';
  // No control chars / no CR/LF (header-injection prevention even though we
  // only render into HTML, not Location — defence in depth).
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return '/';
  }
  return raw;
}

// Open Canvas tokens — paper / ink / red / shadow — inlined verbatim from
// src/ui/theme.ts. Duplication is intentional: importing themeCss would
// pull the full token layer (~3KB minified) plus the chrome aliases the
// gate never uses. The gate's surface area is tiny on purpose, so we copy
// the half-dozen variables it needs instead. If the canonical tokens drift
// from these values, update both — design review treats src/ui/theme.css
// as the source of truth.
const GATE_STYLES = `
:root {
  --paper:#FBFAF8; --surface:#FFFFFF; --surface-2:#F4F1EC;
  --ink:#1A1917; --ink-2:#5B564E; --ink-3:#948D82;
  --line:#ECE7DF; --line-2:#DCD6CB;
  --red:#E84D4A; --red-strong:#D33C39; --red-ink:#C5332F;
  --red-soft:#FBEDEC; --red-line:#F4CFCD;
  --r-sm:12px; --r-pill:999px;
  --shadow:0 2px 6px rgba(40,34,26,.06),0 12px 28px -10px rgba(40,34,26,.14);
  --shadow-red:0 8px 22px -8px rgba(232,77,74,.5);
  --ring:0 0 0 4px rgba(232,77,74,.22);
  --display:"Bricolage Grotesque","Hanken Grotesk",system-ui,sans-serif;
  --sans:"Hanken Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
}
[data-theme="dark"] {
  --paper:#16140F; --surface:#201D17; --surface-2:#2A261F;
  --ink:#F6F2E9; --ink-2:#B7AFA1; --ink-3:#837B6D;
  --line:rgba(255,255,255,.10); --line-2:rgba(255,255,255,.17);
  --red:#FF6257; --red-strong:#FF7468; --red-ink:#FF8378;
  --red-soft:rgba(255,98,87,.15); --red-line:rgba(255,98,87,.32);
  --shadow:0 2px 8px rgba(0,0,0,.4),0 16px 36px -14px rgba(0,0,0,.6);
  --shadow-red:0 8px 24px -8px rgba(255,98,87,.5);
  --ring:0 0 0 4px rgba(255,98,87,.28);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; min-height: 100%; }
body {
  font-family: var(--sans);
  background: var(--paper);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.scene { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; position: relative; }
.gate { width: 100%; max-width: 400px; text-align: center; }
.gate .lock { width: 64px; height: 64px; border-radius: 20px; background: var(--red-soft); color: var(--red-ink); display: flex; align-items: center; justify-content: center; margin: 0 auto 22px; }
.gate h1 { font-family: var(--display); font-weight: 700; font-size: 28px; letter-spacing: -.02em; margin: 0; color: var(--ink); }
.gate .sub { color: var(--ink-2); font-size: 15px; margin: 10px 0 26px; line-height: 1.5; }
.gate form { display: flex; flex-direction: column; gap: 12px; text-align: left; }
.gate label.lbl { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-2); margin-bottom: 4px; }
.gate .field {
  font-family: var(--sans); font-size: 14.5px; color: var(--ink);
  background: var(--surface); border: 1.5px solid var(--line-2);
  border-radius: var(--r-sm); padding: 11px 14px; width: 100%;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.gate .field::placeholder { color: var(--ink-3); }
.gate .field:focus { outline: none; border-color: var(--red); box-shadow: var(--ring); }
.gate .btn {
  font-family: var(--sans); font-weight: 650; font-size: 16px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 15px 26px; border-radius: var(--r-pill); border: 1.5px solid transparent;
  cursor: pointer; white-space: nowrap; width: 100%;
  background: var(--red); color: #fff; box-shadow: var(--shadow-red);
  transition: background-color .18s ease, transform .12s ease;
}
.gate .btn:hover { background: var(--red-strong); transform: translateY(-1px); }
.gate .btn:active { transform: translateY(1px); }
.gate .err {
  background: var(--red-soft); border: 1px solid var(--red-line);
  color: var(--red-ink); font-size: 13px; font-weight: 600;
  padding: 10px 14px; border-radius: 12px;
}
.gate .rate {
  background: var(--red-soft); border: 1px solid var(--red-line);
  color: var(--red-ink); font-size: 13px; font-weight: 600;
  padding: 10px 14px; border-radius: 12px;
}
.powered { position: absolute; bottom: 24px; left: 0; right: 0; display: flex; justify-content: center; }
.powered a { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-3); font-weight: 600; text-decoration: none; }
.powered a:hover { color: var(--ink-2); }
.oc-logo { display: inline-flex; align-items: center; gap: 8px; }
.oc-logo svg { display: block; flex-shrink: 0; }
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;

// Pre-paint theme-restore — the single piece of JS on the page. Stamps
// data-theme on <html> from localStorage('oc-theme') so a returning
// visitor's dark-mode choice doesn't flash light first. Mirrors the
// canonical themeBootScript in src/ui/theme.ts but is inlined here to
// keep gate.ts a self-contained dependency-free module.
const GATE_THEME_BOOT = `(function(){try{var t=localStorage.getItem('oc-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

// Inline lock-glyph SVG — matches the padlock in design-references/locked.html
// (rounded body + shackle stroke). currentColor inherits from `.gate .lock`
// so the icon themes for free between light and dark.
const LOCK_GLYPH_SVG =
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">` +
  `<rect x="4" y="10" width="16" height="11" rx="2.5"/>` +
  `<path d="M8 10V7a4 4 0 0 1 8 0v3"/>` +
  `</svg>`;

// Open Canvas brand mark for the "Powered by" footer. Mirrors OcLogo in
// src/ui/brand.tsx but inlined here so gate.ts has no JSX dependency and
// can stay a `.ts` module shipped from the password package.
const OC_LOGO_SVG =
  `<svg width="18" height="18" viewBox="0 0 64 64" fill="none" aria-hidden="true">` +
  `<rect x="14" y="9" width="40" height="46" stroke="currentColor" stroke-width="3"/>` +
  `<circle cx="34" cy="32" r="11" stroke="currentColor" stroke-width="8"/>` +
  `<rect x="40" y="19" width="21" height="4.5" rx="2" fill="var(--red)"/>` +
  `<rect x="6" y="43" width="21" height="4.5" rx="2" fill="var(--red)"/>` +
  `</svg>`;

/**
 * Render the gate HTML. Returns a complete `<!doctype html>` document body
 * the middleware writes verbatim to the response.
 */
export function renderGateHtml(options: GateOptions): string {
  const safeRedirect = sanitiseRedirect(options.redirect);
  const errorBlock = options.showError
    ? `<div class="err">That password was incorrect. Try again.</div>`
    : '';
  const rateBlock = options.showRateLimit
    ? `<div class="rate">Too many attempts. Please wait a minute and try again.</div>`
    : '';
  const heading = escapeText(options.siteName.length > 0 ? options.siteName : 'This site');
  const safeRedirectAttr = escapeAttr(safeRedirect);
  // theme is constrained to the 'light' | 'dark' enum by the caller; we
  // stamp only the 'dark' case so the light default keeps the attribute off
  // (matches the chrome surfaces). Defence in depth: even if a malformed
  // value somehow reached this layer, the literal comparison would drop it.
  const themeAttr = options.theme === 'dark' ? ' data-theme="dark"' : '';

  return `<!doctype html>
<html lang="en"${themeAttr}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${heading} — password required</title>
    <style>${GATE_STYLES}</style>
    <script>${GATE_THEME_BOOT}</script>
  </head>
  <body>
    <div class="scene">
      <main class="gate">
        <div class="lock">${LOCK_GLYPH_SVG}</div>
        <h1>${heading}</h1>
        <p class="sub">This site is password protected. Enter the password to continue.</p>
        <form method="post" action="/__opencanvas/unlock">
          ${rateBlock}
          ${errorBlock}
          <label class="lbl" for="opencanvas-pw">Password</label>
          <input class="field" id="opencanvas-pw" type="password" name="password" placeholder="Enter password" autocomplete="current-password" autofocus required />
          <input type="hidden" name="redirect" value="${safeRedirectAttr}" />
          <button class="btn" type="submit">Unlock site</button>
        </form>
      </main>
      <div class="powered"><a href="${options.appOrigin}" target="_blank" rel="noopener"><span class="oc-logo" style="color:var(--ink-3)">${OC_LOGO_SVG}</span>Powered by Open Canvas</a></div>
    </div>
  </body>
</html>
`;
}

// Exported for the unit smoke that exercises the sanitiser without going
// through the full render pipeline.
export { sanitiseRedirect };
