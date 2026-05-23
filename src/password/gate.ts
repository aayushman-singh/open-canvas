// src/password/gate.ts
//
// Renders the minimal "enter password" HTML page served by `requireUnlock`
// when a Visitor hits a password-protected site without a valid unlock
// cookie. The page is intentionally plain — no JS framework, no external
// fonts, no client-side scripting. A single `<form method="post">` posts the
// password to `/__rev01/unlock`; the unlock handler verifies, sets the
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
// Styling: a single `<style>` block scoped to the page. We do NOT try to
// resolve the site's Style Kit here because that would require a DB lookup
// on every gate render and leak the site's brand color before unlock — the
// gate is intentionally neutral so visitors can't enumerate which sites
// belong to which Owner just by looking at the gate.
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

const GATE_STYLES = `
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
}
body {
  display: grid;
  place-items: center;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0b0f1a;
  color: #f1f5f9;
  padding: 32px 16px;
}
.card {
  width: min(420px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: #111827;
  padding: 32px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
}
.card h1 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.card .sub {
  margin: 0 0 24px;
  color: #94a3b8;
  font-size: 14px;
  line-height: 1.55;
}
.card label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #cbd5e1;
}
.card input[type="password"] {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: #0b1220;
  color: #f1f5f9;
  font-size: 15px;
}
.card input[type="password"]:focus {
  outline: none;
  border-color: #7dd3fc;
  box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.2);
}
.card button {
  margin-top: 16px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  border-radius: 8px;
  background: #7dd3fc;
  color: #05111a;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.card button:hover { background: #93dcfd; }
.card .err {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.32);
  color: #fca5a5;
  font-size: 13px;
}
.card .rate {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(250, 204, 21, 0.1);
  border: 1px solid rgba(250, 204, 21, 0.32);
  color: #fde047;
  font-size: 13px;
}
`;

/**
 * Render the gate HTML. Returns a complete `<!doctype html>` document body
 * the middleware writes verbatim to the response.
 */
export function renderGateHtml(options: GateOptions): string {
  const safeRedirect = sanitiseRedirect(options.redirect);
  const errorBlock = options.showError
    ? `<p class="err">That password was incorrect. Try again.</p>`
    : '';
  const rateBlock = options.showRateLimit
    ? `<p class="rate">Too many attempts. Please wait a minute and try again.</p>`
    : '';
  const heading = escapeText(options.siteName.length > 0 ? options.siteName : 'This site');
  const safeRedirectAttr = escapeAttr(safeRedirect);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${heading} — password required</title>
    <style>${GATE_STYLES}</style>
  </head>
  <body>
    <main class="card">
      <h1>${heading}</h1>
      <p class="sub">This site is password protected. Enter the password to continue.</p>
      ${rateBlock}
      ${errorBlock}
      <form method="post" action="/__rev01/unlock">
        <label for="rev01-pw">Password</label>
        <input id="rev01-pw" type="password" name="password" autocomplete="current-password" autofocus required />
        <input type="hidden" name="redirect" value="${safeRedirectAttr}" />
        <button type="submit">Continue</button>
      </form>
    </main>
  </body>
</html>
`;
}

// Exported for the unit smoke that exercises the sanitiser without going
// through the full render pipeline.
export { sanitiseRedirect };
