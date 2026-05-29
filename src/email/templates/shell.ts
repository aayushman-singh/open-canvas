// src/email/templates/shell.ts
//
// Shared brand-shell for every outbound HTML email. Carries the Open Canvas
// palette from src/ui/theme.css (paper/ink/red) and the OC mark from
// src/landing/index.tsx's FAVICON_SVG so every transactional email lands in
// the inbox visually identical to the product surface.
//
// Inline SVG renders in Apple Mail and modern Gmail web/mobile. Outlook
// desktop strips the SVG; the wordmark next to it carries the brand alone in
// that fallback case. No image hosting required.
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

const OC_MARK_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">',
  `<rect x="14" y="9" width="40" height="46" stroke="${INK}" stroke-width="2.8" fill="none"/>`,
  `<circle cx="34" cy="32" r="11" stroke="${INK}" stroke-width="7" fill="none"/>`,
  `<rect x="40" y="19" width="21" height="3.6" rx="1.8" fill="${RED}"/>`,
  `<rect x="6" y="43" width="21" height="3.6" rx="1.8" fill="${RED}"/>`,
  '</svg>',
].join('');

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
  /** Optional pill CTA rendered after `bodyHtml`. Both label and href must be set. */
  cta?: { label: string; href: string };
  /** Optional muted footnote rendered after the CTA. */
  footnoteHtml?: string;
}

export function brandShell(options: BrandShellOptions): string {
  const { heading, bodyHtml, cta, footnoteHtml } = options;

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

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${FONT_STACK};color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:${SURFACE};border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
        <tr><td style="background:${PAPER};padding:20px 32px;border-bottom:1px solid ${LINE};">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:10px;line-height:0;">${OC_MARK_SVG}</td>
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
        Sent by Open Canvas
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}
