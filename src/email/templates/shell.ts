// src/email/templates/shell.ts
//
// Shared brand-shell for every outbound HTML email. Carries the Open Canvas
// palette from src/ui/theme.css (paper/ink/red) and the OC mark served from
// `${appOrigin}/brand-mark.png` (rasterised via resvg in landing/index.tsx)
// so every transactional email lands in the inbox visually identical to the
// product surface — including in Outlook and older Gmail clients that strip
// inline SVG.
//
// Tokens are duplicated as literals here (not var(--red) etc.) because email
// clients do not load external stylesheets and most strip <style> blocks too.
// If theme.css palette shifts, update both places.

const PAPER = '#FBFAF8';
const SURFACE = '#FFFFFF';
const INK = '#1A1917';
const INK_2 = '#5B564E';
const INK_3 = '#948D82';
const RED = '#E84D4A';
const LINE = '#ECE7DF';

const FONT_STACK = '"Hanken Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface BrandShellOptions {
  /** Page-level heading rendered at the top of the body card. */
  heading: string;
  /** Pre-rendered HTML for the body region. Caller is responsible for escaping. */
  bodyHtml: string;
  /**
   * Absolute origin of the app (e.g. `https://opencanvas.aayushman.dev`).
   * Used to build the `<img>` URL for the brand mark + the copyright link
   * in the footer. Resolve via `appOrigin(env)` from `src/host-config.ts`.
   */
  appOrigin: string;
  /** Optional pill CTA rendered after `bodyHtml`. Both label and href must be set. */
  cta?: { label: string; href: string };
  /** Optional muted footnote rendered after the CTA. */
  footnoteHtml?: string;
}

const COPYRIGHT_YEAR = 2026;

export function brandShell(options: BrandShellOptions): string {
  const { heading, bodyHtml, appOrigin, cta, footnoteHtml } = options;

  const ctaHtml = cta
    ? `<a href="${escapeHtml(cta.href)}"` +
      ` style="display:inline-block;padding:12px 28px;background:${RED};color:${PAPER};` +
      `font-size:14px;font-weight:600;text-decoration:none;border-radius:999px;` +
      `box-shadow:0 8px 22px -8px rgba(232,77,74,.5);">` +
      `${escapeHtml(cta.label)}</a>`
    : '';

  const footnoteBlock = footnoteHtml
    ? `<p style="margin:24px 0 0;font-size:12px;color:${INK_3};line-height:1.5;">` +
      `${footnoteHtml}</p>`
    : '';

  const brandMarkUrl = `${appOrigin}/brand-mark.png`;
  const siteUrl = `${appOrigin}/`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${FONT_STACK};color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:${SURFACE};border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
        <tr><td style="background:${PAPER};padding:20px 32px;border-bottom:1px solid ${LINE};">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:10px;line-height:0;"><img src="${escapeHtml(brandMarkUrl)}" width="28" height="28" alt="Open Canvas" style="display:block;border:0;outline:none;text-decoration:none;" /></td>
            <td style="vertical-align:middle;font-size:16px;font-weight:600;color:${INK};letter-spacing:-0.01em;">Open Canvas</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:${INK};letter-spacing:-0.01em;">${escapeHtml(heading)}</h1>
          <div style="font-size:14px;color:${INK_2};line-height:1.6;">${bodyHtml}</div>
          ${ctaHtml ? `<div style="margin-top:24px;">${ctaHtml}</div>` : ''}
          ${footnoteBlock}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:${INK_3};font-family:${FONT_STACK};">
        &copy; ${String(COPYRIGHT_YEAR)} <a href="${escapeHtml(siteUrl)}" style="color:${INK_3};text-decoration:none;">Open Canvas</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}
