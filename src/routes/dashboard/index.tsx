import { Hono } from 'hono';
import { raw } from 'hono/html';
import { desc, eq, sum } from 'drizzle-orm';
import { billingPlanLabel, siteLimitForPlan, storageLimitForPlan } from '../../billing/plan-limits';
import { db } from '../../db/client';
import { site, ownerAsset } from '../../db/schema';
import { clerkAuth, resolveClerkKeys } from '../../auth/middleware';
import { clerkFrontendApiHost, requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { Button, Badge, Pill, readThemeCookie } from '../../ui';
import { renderCanvasSnapshot } from '../../canvas/render';
import { requireTurnstileSiteKey } from '../../canvas/elements/form';
import { canvasPublishedStyles } from '../../canvas/public-styles';
import type { PublishedSnapshot, EditableSite } from '../../canvas/schema';
import { appDomain, type HostConfigEnv } from '../../host-config';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_FRONTEND_API_URL?: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DATABASE_URL: string;
  TURNSTILE_SITE_KEY?: string;
};

export const dashboard = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

dashboard.use('*', clerkAuth());
dashboard.use('*', requireAuth());

dashboard.use('*', async (c, next) => {
  await next();
  const ct = c.res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) return;
  if (c.req.path.endsWith('/preview')) return;
  const { publishableKey } = resolveClerkKeys(c.env);
  // Host resolved server-side (see `clerkFrontendApiHost`) so the clerk-js
  // bundle URL doesn't depend on the publishable key's encoded host — which
  // can go stale when a Clerk instance is reconfigured (rebrand domain
  // change) without re-issuing keys.
  const clerkHost = clerkFrontendApiHost(publishableKey, c.env.CLERK_FRONTEND_API_URL);
  const clerkScript =
    `<script>(function(){` +
    `var pk="${publishableKey}";` +
    `var s=document.createElement("script");` +
    `s.src="https://${clerkHost}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js";` +
    `s.crossOrigin="anonymous";s.async=true;` +
    `s.setAttribute("data-clerk-publishable-key",pk);` +
    `s.onload=function(){if(window.Clerk)window.Clerk.load();};` +
    `document.head.appendChild(s);` +
    `})()</script>`;
  const body = await c.res.text();
  c.res = new Response(body.replace('</head>', clerkScript + '</head>'), c.res);
});

const THUMB_SCALE = 0.24;

function formatDate(d: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[d.getUTCMonth()]} ${String(d.getUTCDate())}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function buildThumbHtml(
  state: EditableSite,
  siteId: string,
  origin: string,
  turnstileSiteKey: string,
): string {
  const snapshot: PublishedSnapshot = {
    version: 0,
    publishedAt: new Date().toISOString(),
    styleKit: state.styleKit,
    pages: state.pages,
    ...(state.header ? { header: state.header } : {}),
    ...(state.footer ? { footer: state.footer } : {}),
    ...(state.customStyleKit ? { customStyleKit: state.customStyleKit } : {}),
  };
  const canvasHtml = renderCanvasSnapshot(
    snapshot,
    `/api/canvas/sites/${siteId}/assets`,
    siteId,
    { turnstileSiteKey },
  );
  return [
    '<!DOCTYPE html><html><head>',
    `<base href="${origin}/">`,
    '<style>',
    canvasPublishedStyles,
    '</style>',
    '</head><body style="margin:0;overflow:hidden;background:#0a0a0a">',
    canvasHtml,
    '</body></html>',
  ].join('');
}

// Per-page styles for the dashboard root. Restyled to Open Canvas tokens
// per MIGRATION.md §4 — stats cards become `.stat`, segmented filter
// `.seg`, site cards adopt warm-neutral surfaces + `--shadow-sm` instead
// of the previous dark literal palette. Sky-blue rgba(125,211,252) and
// black-on-black overlays are gone.
const cardStyles = `
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 26px;
    flex-wrap: wrap;
  }
  .page-head h1 {
    margin: 0;
    font-size: 34px;
    letter-spacing: -0.03em;
  }
  .page-head .hi {
    color: var(--ink-2);
    font-size: 15px;
    margin-top: 6px;
  }
  .page-head-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .import-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(26, 25, 23, 0.55);
    backdrop-filter: blur(4px);
    display: none;
    align-items: center;
    justify-content: center;
  }
  .import-modal-overlay[data-open="true"] { display: flex; }
  .import-modal {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r);
    width: min(480px, calc(100vw - 48px));
    padding: 28px;
    box-shadow: var(--shadow-lg);
  }
  .import-modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .import-modal h2 {
    margin: 0 0 4px;
    font-family: var(--display);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .import-close {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink-2);
    border-radius: var(--r-xs);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }
  .import-close:hover { background: var(--surface-3); color: var(--ink); }
  .import-modal .import-sub {
    margin: 0 0 20px;
    font-size: 13.5px;
    color: var(--ink-3);
  }
  .import-field { margin-bottom: 14px; }
  .import-field label {
    display: block;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ink-2);
    margin-bottom: 7px;
    letter-spacing: 0.02em;
  }
  .import-field input {
    width: 100%;
    padding: 11px 14px;
    border-radius: var(--r-sm);
    border: 1.5px solid var(--line-2);
    background: var(--surface);
    color: var(--ink);
    font-size: 14.5px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .import-field input:focus {
    border-color: var(--red);
    box-shadow: var(--ring);
  }
  .import-field .field-hint {
    font-size: 11.5px;
    color: var(--ink-3);
    margin-top: 5px;
  }
  .import-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 20px;
  }
  .import-error {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: var(--r-xs);
    background: var(--red-soft);
    border: 1px solid var(--red-line);
    color: var(--red-ink);
    font-size: 13px;
    display: none;
  }
  .import-progress {
    margin-top: 12px;
    font-size: 13px;
    color: var(--red-ink);
    display: none;
  }
  .dash-sub { color: var(--ink-3); font-size: 13px; margin: 0 0 24px; }

  /* segmented filter — All / Published / Drafts */
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 6px 0 16px;
  }
  .sec-head h2 {
    font-family: var(--display);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 0;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border-radius: var(--r-pill);
    border: 1px solid var(--line);
  }
  .seg button {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 14px;
    border-radius: var(--r-pill);
    border: none;
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }

  .site-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 18px;
    margin: 0 0 32px;
  }
  .site-card {
    position: relative;
    background: var(--surface);
    border-radius: var(--r-lg);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.16s, box-shadow 0.2s, border-color 0.2s;
  }
  .site-card:hover:not(.site-card--expanded) {
    border-color: var(--line-2);
    box-shadow: var(--shadow-lg);
    transform: translateY(-4px);
  }

  /* backdrop — fades in */
  .card-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: rgba(26, 25, 23, 0.55);
    backdrop-filter: blur(4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }
  .card-backdrop[data-open="true"] {
    opacity: 1;
    pointer-events: auto;
  }

  /* expanded — no transitions, instant snap, opacity-only fade */
  .site-card--expanded {
    position: fixed;
    z-index: 1000;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    cursor: default;
    border-color: var(--red);
    box-shadow: var(--shadow-lg);
    transition: none;
    animation: card-fade-in 0.12s ease-out;
  }
  @keyframes card-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .site-card--expanded .site-card-thumb { height: 260px; }
  .site-card--expanded .site-card-thumb iframe {
    transform: scale(0.39);
  }

  .site-card-thumb {
    position: relative;
    width: 100%;
    height: 200px;
    overflow: hidden;
    background: var(--surface-3);
    border-bottom: 1px solid var(--line);
  }
  .site-card-thumb iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 1440px;
    height: 900px;
    transform-origin: top left;
    transform: scale(${String(THUMB_SCALE)});
    border: none;
    pointer-events: none;
  }

  .site-card-body { padding: 16px 20px; }
  .site-card-body h3 {
    margin: 0 0 4px;
    font-family: var(--display);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .site-card-addr {
    display: inline-block;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink-2);
    text-decoration: none;
    margin-bottom: 10px;
  }
  .site-card-addr:hover { color: var(--red-ink); text-decoration: underline; }

  .site-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 14px;
  }
  .site-card-date {
    font-size: 12.5px;
    color: var(--ink-3);
  }

  /* --- card actions: Edit | Publish/Live | ... --- */
  .site-card-actions {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .site-card-actions a,
  .site-card-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 9px 14px;
    border-radius: var(--r-pill);
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 650;
    text-decoration: none;
    transition: background 0.14s, color 0.14s, border-color 0.14s, box-shadow 0.14s;
    cursor: pointer;
    border: 1.5px solid transparent;
  }
  .btn-edit {
    flex: 1;
    background: var(--red);
    color: #fff;
    box-shadow: var(--shadow-red);
  }
  .btn-edit:hover { background: var(--red-strong); }

  .btn-live {
    flex: 1;
    background: var(--ok-soft);
    color: var(--ok);
    border-color: transparent;
  }
  .btn-live:hover { filter: brightness(0.96); }
  .btn-live .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    margin-right: 6px;
  }

  .btn-publish {
    flex: 1;
    background: var(--warn-soft);
    color: var(--warn);
    border-color: transparent;
  }
  .btn-publish:hover { filter: brightness(0.96); }

  .btn-unpublish {
    flex: 1;
    background: var(--ok-soft);
    color: var(--ok);
    border-color: transparent;
  }
  .btn-unpublish:hover {
    background: var(--red-soft);
    color: var(--red-ink);
    border-color: var(--red-line);
  }
  .btn-unpublish .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    margin-right: 6px;
  }

  .btn-dots {
    width: 38px;
    min-width: 38px;
    background: var(--surface);
    color: var(--ink-2);
    border: 1.5px solid var(--line-2);
    font-size: 18px;
    letter-spacing: 1px;
    line-height: 1;
    padding: 0;
  }
  .btn-dots:hover { background: var(--surface-2); color: var(--ink); }
  .btn-dots[aria-expanded="true"] {
    background: var(--red-soft);
    color: var(--red-ink);
    border-color: var(--red-line);
  }

  /* --- expandable details panel --- */
  .site-card-details {
    display: none;
    border-top: 1px solid var(--line);
    background: var(--paper);
    padding: 14px 16px 16px;
  }
  .site-card-details[data-open="true"] { display: block; }
  .details-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 4px 10px;
  }
  .details-heading {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }
  .details-gear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-xs);
    color: var(--ink-2);
    text-decoration: none;
    transition: background 0.14s, color 0.14s;
  }
  .details-gear:hover {
    color: var(--red-ink);
    background: var(--red-soft);
  }
  .details-gear:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 1px;
  }
  .details-list { display: flex; flex-direction: column; }
  .detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 8px;
    border-radius: var(--r-xs);
    font-size: 13px;
    text-decoration: none;
    color: inherit;
  }
  .detail-row + .detail-row {
    border-top: 1px solid var(--line);
  }
  .detail-row--link {
    cursor: pointer;
    transition: background 0.14s;
  }
  .detail-row--link:hover { background: var(--surface-2); }
  .detail-row--link:hover .detail-label { color: var(--ink); }
  .detail-row--link:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: -2px;
  }
  .detail-label {
    color: var(--ink-2);
    flex: 1;
    transition: color 0.14s;
  }
  .detail-value { display: inline-flex; align-items: center; }
  .detail-chevron {
    color: var(--ink-3);
    font-size: 16px;
    line-height: 1;
    margin-left: 2px;
    opacity: 0;
    transition: opacity 0.14s, transform 0.14s;
  }
  .detail-row--link:hover .detail-chevron {
    opacity: 1;
    transform: translateX(2px);
  }
  .dash-sign-out {
    font-size: 13px;
    color: var(--ink-3);
  }
  .dash-sign-out:hover { color: var(--ink); }

  .site-card-thumb { container-type: inline-size; }
  @container (min-width: 1px) {
    .site-card-thumb iframe { transform: scale(calc(100cqi / 1440)); }
    .site-card--expanded .site-card-thumb iframe { transform: scale(calc(100cqi / 1440)); }
  }

  .import-arrow {
    text-align: center;
    color: var(--ink-3);
    font-size: 12px;
    padding: 4px 0;
    letter-spacing: 0.03em;
  }

  /* stat cards — match dashboard.html .stat */
  .dash-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 30px;
  }
  .dash-stat-card {
    padding: 18px 20px;
    border-radius: var(--r);
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-sm);
  }
  .dash-stat-card .stat-label {
    font-size: 13px;
    color: var(--ink-2);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .dash-stat-card .stat-value {
    font-family: var(--display);
    font-weight: 700;
    font-size: 32px;
    letter-spacing: -0.02em;
    color: var(--ink);
    line-height: 1;
    margin-top: 12px;
  }
  .dash-stat-card .stat-sub {
    font-size: 12.5px;
    color: var(--ink-3);
    margin-top: 4px;
  }
  .dash-stat-card .stat-value .accent { color: var(--red-ink); }

  .dash-welcome {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    padding: 32px;
    text-align: center;
    margin-bottom: 28px;
    box-shadow: var(--shadow-sm);
  }
  .dash-welcome h2 {
    margin: 0 0 8px;
    font-family: var(--display);
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .dash-welcome p {
    margin: 0 0 20px;
    font-size: 14.5px;
    color: var(--ink-2);
    max-width: 480px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.5;
  }
  .dash-welcome-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .dash-quick {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-bottom: 28px;
  }
  .dash-quick-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: 18px 20px;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.14s, transform 0.14s, box-shadow 0.14s;
    box-shadow: var(--shadow-sm);
  }
  .dash-quick-card:hover {
    border-color: var(--line-2);
    transform: translateY(-2px);
    box-shadow: var(--shadow);
  }
  .dash-quick-card .qicon {
    font-size: 20px;
    margin-bottom: 8px;
    display: block;
  }
  .dash-quick-card h3 {
    margin: 0 0 4px;
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .dash-quick-card p {
    margin: 0;
    font-size: 12.5px;
    color: var(--ink-3);
  }

  @media (max-width: 768px) {
    .dash-stats { grid-template-columns: repeat(2, 1fr); }
    .dash-quick { grid-template-columns: 1fr; }
  }
`;

const importScript = raw(`<script>
(function() {
  var overlay = document.getElementById('import-overlay');
  var openBtn = document.getElementById('import-btn');
  var cancelBtn = document.getElementById('import-cancel');
  var submitBtn = document.getElementById('import-submit');
  var urlInput = document.getElementById('import-url');
  var nameInput = document.getElementById('import-name');
  var subdomainInput = document.getElementById('import-subdomain');
  var errorEl = document.getElementById('import-error');
  var progressEl = document.getElementById('import-progress');

  function openModal() {
    overlay.setAttribute('data-open', 'true');
    urlInput.value = '';
    nameInput.value = '';
    subdomainInput.value = '';
    errorEl.style.display = 'none';
    progressEl.style.display = 'none';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Import';
    urlInput.focus();
  }

  function closeModal() {
    overlay.setAttribute('data-open', 'false');
  }

  var closeBtn = document.getElementById('import-close');

  if (openBtn.hasAttribute('disabled')) return;
  openBtn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  var overlayMouseDown = false;
  overlay.addEventListener('mousedown', function(e) {
    overlayMouseDown = e.target === overlay;
  });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay && overlayMouseDown) closeModal();
    overlayMouseDown = false;
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.getAttribute('data-open') === 'true') closeModal();
  });

  urlInput.addEventListener('blur', function() {
    if (!urlInput.value) return;
    try {
      var u = new URL(urlInput.value);
      if (!nameInput.value) {
        nameInput.value = u.hostname.replace(/^www\\./, '');
      }
      if (!subdomainInput.value) {
        subdomainInput.value = u.hostname
          .replace(/^www\\./, '')
          .replace(/\\.[^.]+$/, '')
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 63);
      }
    } catch(e) {}
  });

  submitBtn.addEventListener('click', function() {
    var url = urlInput.value.trim();
    var name = nameInput.value.trim();
    var subdomain = subdomainInput.value.trim().toLowerCase();

    if (!url || !name) {
      errorEl.textContent = 'URL and site name are required.';
      errorEl.style.display = 'block';
      return;
    }

    try { new URL(url); } catch(e) {
      errorEl.textContent = 'Please enter a valid URL.';
      errorEl.style.display = 'block';
      return;
    }

    errorEl.style.display = 'none';
    progressEl.style.display = 'block';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing...';

    fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url: url, siteName: name, subdomain: subdomain })
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(result) {
      if (!result.ok) {
        throw new Error(result.data.error || 'Import failed');
      }
      window.location.href = '/dashboard/sites/' + result.data.siteId + '/edit';
    })
    .catch(function(err) {
      progressEl.style.display = 'none';
      errorEl.textContent = err.message || 'Import failed. Please try again.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Import';
    });
  });
})();
</script>`);

const toggleScript = raw(`<script>
var backdrop = document.getElementById('card-backdrop');
var expandedCard = null;

function closeExpanded() {
  if (!expandedCard) return;
  expandedCard.classList.remove('site-card--expanded');
  var panel = expandedCard.querySelector('.site-card-details');
  if (panel) panel.setAttribute('data-open', 'false');
  var btn = expandedCard.querySelector('.btn-dots');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  backdrop.setAttribute('data-open', 'false');
  expandedCard = null;
}

function openExpanded(card) {
  if (expandedCard === card) { closeExpanded(); return; }
  if (expandedCard) closeExpanded();
  expandedCard = card;
  card.classList.add('site-card--expanded');
  var panel = card.querySelector('.site-card-details');
  if (panel) panel.setAttribute('data-open', 'true');
  var btn = card.querySelector('.btn-dots');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  backdrop.setAttribute('data-open', 'true');
}

backdrop.addEventListener('click', closeExpanded);

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeExpanded();
});

document.addEventListener('click', function(e) {
  if (e.target.closest('a, button, iframe')) return;
  var card = e.target.closest('.site-card');
  if (!card) return;
  if (card.classList.contains('site-card--expanded')) return;
  openExpanded(card);
});

// 3-dot button toggles details within expanded card
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.btn-dots');
  if (!btn) return;
  e.stopPropagation();
  var card = btn.closest('.site-card');
  if (!card) return;
  // If card not expanded, expand it
  if (!card.classList.contains('site-card--expanded')) {
    openExpanded(card);
    return;
  }
  // Otherwise toggle details panel
  var panel = card.querySelector('.site-card-details');
  if (!panel) return;
  var open = panel.getAttribute('data-open') === 'true';
  panel.setAttribute('data-open', open ? 'false' : 'true');
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');
});

// Unpublish (make draft) button
document.addEventListener('click', function(e) {
  var unpubBtn = e.target.closest('.btn-unpublish');
  if (!unpubBtn) return;
  e.preventDefault();
  e.stopPropagation();
  var siteId = unpubBtn.getAttribute('data-site-id');
  if (!siteId) return;
  unpubBtn.textContent = 'Unpublishing...';
  unpubBtn.style.pointerEvents = 'none';
  fetch('/api/publish/sites/' + siteId + '/unpublish', { method: 'POST' })
    .then(function(r) {
      return r.json().then(function(d) { return { ok: r.ok, data: d }; });
    })
    .then(function(result) {
      if (!result.ok) throw new Error(result.data.error || 'Unpublish failed');
      location.reload();
    })
    .catch(function(err) {
      unpubBtn.textContent = 'Failed';
      unpubBtn.style.pointerEvents = '';
      __rev01Modal.alert(err.message || 'Unpublish failed', 'Unpublish error');
    });
});

// Publish button
document.addEventListener('click', function(e) {
  var pubBtn = e.target.closest('.btn-publish');
  if (!pubBtn) return;
  e.preventDefault();
  e.stopPropagation();
  var siteId = pubBtn.getAttribute('data-site-id');
  if (!siteId) return;
  pubBtn.textContent = 'Publishing...';
  pubBtn.style.pointerEvents = 'none';
  fetch('/api/publish/sites/' + siteId, { method: 'POST' })
    .then(function(r) {
      return r.json().then(function(d) { return { ok: r.ok, data: d }; });
    })
    .then(function(result) {
      if (!result.ok) throw new Error(result.data.error || 'Publish failed');
      location.reload();
    })
    .catch(function(err) {
      pubBtn.textContent = 'Failed';
      pubBtn.title = err.message || 'Unknown error';
      pubBtn.style.pointerEvents = '';
      __rev01Modal.alert(err.message || 'Publish failed', 'Publish error');
    });
});
</script>`);

interface SiteCard {
  siteId: string;
  siteName: string;
  subdomain: string;
  styleKit: string;
  publishedVersion: number;
  updatedAt: Date;
  thumbHtml: string;
  passwordEnabled: boolean;
  visitorTheme: 'light' | 'dark' | 'toggleable';
  searchIndexing: boolean;
}

// Visible placeholder when a single site's editableState fails to render.
// This is an explicit alternative behaviour (loudly logged below) so one
// broken site does not 500 the whole dashboard — the owner can still see
// every other card, click Edit on the broken card, and fix the data.
const THUMB_FAILED_HTML =
  '<!DOCTYPE html><html><head><style>' +
  'body{margin:0;display:flex;align-items:center;justify-content:center;' +
  'height:100vh;background:#1a1116;color:#ffb5b5;' +
  'font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;' +
  'text-align:center;padding:16px;box-sizing:border-box}' +
  'strong{display:block;font-size:15px;margin-bottom:6px}' +
  'span{opacity:.7;font-size:12px}' +
  '</style></head><body><div>' +
  '<strong>Preview failed</strong>' +
  '<span>Open editor to inspect.</span>' +
  '</div></body></html>';

function buildCards(
  rows: Array<{
    id: string;
    name: string;
    subdomain: string;
    styleKit: string;
    publishedVersion: number;
    updatedAt: Date;
    editableState: EditableSite;
    passwordEnabled: boolean;
  }>,
  origin: string,
  turnstileSiteKey: string,
): SiteCard[] {
  return rows.map((row) => {
    const state = row.editableState;
    let thumbHtml: string;
    try {
      thumbHtml = buildThumbHtml(state, row.id, origin, turnstileSiteKey);
    } catch (error) {
      console.error(
        `dashboard: buildThumbHtml failed for siteId=${row.id} name=${JSON.stringify(row.name)} subdomain=${JSON.stringify(row.subdomain)}`,
        error,
      );
      thumbHtml = THUMB_FAILED_HTML;
    }
    return {
      siteId: row.id,
      siteName: row.name,
      subdomain: row.subdomain,
      styleKit: row.styleKit,
      publishedVersion: row.publishedVersion,
      updatedAt: row.updatedAt,
      thumbHtml,
      passwordEnabled: row.passwordEnabled,
      visitorTheme: state.visitorTheme ?? 'light',
      searchIndexing: !(state.siteNoIndex ?? false),
    };
  });
}

function DetailRow({ label, href, children }: { label: string; href?: string; children: unknown }) {
  const inner = (
    <>
      <span class="detail-label">{label}</span>
      <span class="detail-value">{children}</span>
    </>
  );
  // Previously these rows wrapped <td>s in an <a> inside a <tr>, which is
  // foster-parented out of the table by the HTML parser — the rendered DOM
  // had no anchor inside the row, so clicks did nothing. Flat <a> rows in a
  // flex layout make each row a real link.
  if (href) {
    return (
      <a class="detail-row detail-row--link" href={href}>
        {inner}
        <span class="detail-chevron" aria-hidden="true">
          ›
        </span>
      </a>
    );
  }
  return <div class="detail-row">{inner}</div>;
}

function DetailsPanel({ s }: { s: SiteCard }) {
  const editBase = `/dashboard/sites/${s.siteId}`;
  return (
    <div class="site-card-details" data-open="false">
      <div class="details-header">
        <p class="details-heading">Site details</p>
        <a
          class="details-gear"
          href={`${editBase}/settings`}
          aria-label="All site settings"
          title="All settings"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm7.43 3.5a7.6 7.6 0 0 0-.05-1l2.05-1.6-2-3.46-2.42.97a7.6 7.6 0 0 0-1.73-1l-.37-2.57h-4l-.37 2.57a7.6 7.6 0 0 0-1.73 1l-2.42-.97-2 3.46 2.05 1.6a7.6 7.6 0 0 0 0 2l-2.05 1.6 2 3.46 2.42-.97a7.6 7.6 0 0 0 1.73 1l.37 2.57h4l.37-2.57a7.6 7.6 0 0 0 1.73-1l2.42.97 2-3.46-2.05-1.6c.03-.33.05-.66.05-1z"
            />
          </svg>
        </a>
      </div>
      <div class="details-list">
        <DetailRow label="Hosting" href={`${editBase}/settings#hosting`}>
          <Pill variant="info">Starter</Pill>
        </DetailRow>
        <DetailRow label="CDN">
          <Pill variant="info">Cloudflare Edge</Pill>
        </DetailRow>
        <DetailRow label="Custom domain" href={`${editBase}/domains`}>
          <Pill variant="off">Not configured</Pill>
        </DetailRow>
        <DetailRow label="Password protection" href={`${editBase}/settings#password`}>
          <Pill variant={s.passwordEnabled ? 'on' : 'off'}>{s.passwordEnabled ? 'On' : 'Off'}</Pill>
        </DetailRow>
        <DetailRow label="Search indexing" href={`${editBase}/settings#seo`}>
          <Pill variant={s.searchIndexing ? 'on' : 'off'}>{s.searchIndexing ? 'On' : 'Off'}</Pill>
        </DetailRow>
        <DetailRow label="Visitor dark mode" href={`${editBase}/settings#dark-mode`}>
          <Pill variant={s.visitorTheme === 'light' ? 'off' : 'on'}>
            {s.visitorTheme === 'dark'
              ? 'Dark'
              : s.visitorTheme === 'toggleable'
                ? 'Toggleable'
                : 'Light'}
          </Pill>
        </DetailRow>
        <DetailRow label="Analytics" href={`${editBase}/addons`}>
          <Pill variant="off">Not connected</Pill>
        </DetailRow>
        <DetailRow label="Style kit" href={`${editBase}/edit`}>
          <Pill variant="info">{s.styleKit}</Pill>
        </DetailRow>
      </div>
    </div>
  );
}

dashboard.get('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new Error('dashboard reached without a resolved user');
  }
  // clerkAuth() middleware already upserted + loaded the customer row.
  const customerRecord = c.get('customer');
  if (!customerRecord) {
    throw new Error('dashboard reached without a resolved customer');
  }

  const database = db(c.env);
  const primaryEmail = customerRecord.email;
  const customerId = customerRecord.id;
  const customerPlan = customerRecord.plan;

  const origin = new URL(c.req.url).origin;
  const apex = appDomain(c.env);

  // Site rows and storage sum are independent — parallelize so the page open
  // pays one Neon round trip's worth of latency instead of two.
  const [rows, sb] = await Promise.all([
    database
      .select({
        id: site.id,
        name: site.name,
        subdomain: site.subdomain,
        styleKit: site.styleKit,
        publishedVersion: site.publishedVersion,
        updatedAt: site.updatedAt,
        editableState: site.editableState,
        passwordEnabled: site.passwordEnabled,
      })
      .from(site)
      .where(eq(site.customerId, customerId))
      .orderBy(desc(site.createdAt)),
    database
      .select({ total: sum(ownerAsset.byteSize) })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, customerId)),
  ]);

  const cards = buildCards(rows, origin, requireTurnstileSiteKey(c.env));
  const publishedCount = rows.filter((r) => r.publishedVersion > 0).length;
  const storageBytes = Number(sb[0]?.total ?? 0);

  const siteLimit = siteLimitForPlan(customerPlan);
  const atSiteLimit = siteLimit !== null && cards.length >= siteLimit;
  const planName = billingPlanLabel(customerPlan);
  const siteLimitLabel = siteLimit === null ? 'Unlimited' : String(siteLimit);
  const storageLimitLabel = formatBytes(storageLimitForPlan(customerPlan));

  const avatarUrl = user.imageUrl;
  const displayName = customerRecord.displayName ?? user.firstName ?? undefined;

  const greetingName = displayName ?? primaryEmail.split('@')[0];

  return c.html(
    <DashboardShell
      title="Open Canvas — Your sites"
      crumbs={[{ label: 'Dashboard' }]}
      activePath="/dashboard"
      pageStyles={cardStyles}
      userMeta={{ avatarUrl, displayName, email: primaryEmail }}
      theme={readThemeCookie(c)}
    >
      <div class="page-head">
        <div>
          <h1>Your sites</h1>
          <p class="hi">
            Welcome back, {greetingName}. You have{' '}
            <b>
              {String(publishedCount)} live {publishedCount === 1 ? 'site' : 'sites'}
            </b>{' '}
            and {String(Math.max(cards.length - publishedCount, 0))} in progress.
          </p>
        </div>
        <div class="page-head-actions">
          <Button
            variant="secondary"
            class="import-site"
            id="import-btn"
            disabled
            title="Site import is disabled in the public POC. Run the scraper locally to enable."
          >
            Import
          </Button>
          {atSiteLimit ? (
            <Button variant="primary" class="new-site" href="/dashboard/settings">
              Upgrade to add sites
            </Button>
          ) : (
            <Button variant="primary" class="new-site" href="/dashboard/templates">
              + New site
            </Button>
          )}
        </div>
      </div>

      <div class="dash-stats">
        <div class="dash-stat-card">
          <div class="stat-label">Total sites</div>
          <div class="stat-value">{String(cards.length)}</div>
          <div class="stat-sub">of {siteLimitLabel} on {planName}</div>
        </div>
        <div class="dash-stat-card">
          <div class="stat-label">Published</div>
          <div class="stat-value">
            <span class="accent">{String(publishedCount)}</span>
          </div>
          <div class="stat-sub">
            {cards.length > 0
              ? `${Math.round((publishedCount / cards.length) * 100)}% of sites`
              : 'No sites yet'}
          </div>
        </div>
        <div class="dash-stat-card">
          <div class="stat-label">Storage used</div>
          <div class="stat-value">{formatBytes(storageBytes)}</div>
          <div class="stat-sub">of {storageLimitLabel} on {planName}</div>
        </div>
        <div class="dash-stat-card">
          <div class="stat-label">Plan</div>
          <div class="stat-value">{planName}</div>
          <div class="stat-sub"><a href="/dashboard/settings" style="font-size:12px">{customerPlan === 'team' ? 'Manage' : 'Upgrade'}</a></div>
        </div>
      </div>

      <div class="sec-head">
        <h2>All sites</h2>
        <div class="seg">
          <button class="on">All</button>
          <button>Published</button>
          <button>Drafts</button>
        </div>
      </div>

      <div class="import-modal-overlay" id="import-overlay" data-open="false">
        <div class="import-modal">
          <div class="import-modal-header">
            <div>
              <h2>Import a website</h2>
              <p class="import-sub">Paste any public URL to import it as an editable site.</p>
            </div>
            <button type="button" class="import-close" id="import-close" aria-label="Close">
              &times;
            </button>
          </div>
          <div class="import-field">
            <label for="import-url">URL to import</label>
            <input type="url" id="import-url" placeholder="https://example.com" required />
          </div>
          <div class="import-arrow">&#x2193; auto-filled from URL</div>
          <div class="import-field">
            <label for="import-name">Site name</label>
            <input
              type="text"
              id="import-name"
              placeholder="My Imported Site"
              maxlength={80}
              required
            />
          </div>
          <div class="import-field">
            <label for="import-subdomain">
              Subdomain <small>(optional)</small>
            </label>
            <input type="text" id="import-subdomain" placeholder="auto-generated from name" />
            <p class="field-hint">.{apex}</p>
          </div>
          <div class="import-error" id="import-error"></div>
          <div class="import-progress" id="import-progress">
            Importing... this may take up to 30 seconds.
          </div>
          <div class="import-actions">
            <Button variant="secondary" class="btn-import-cancel" id="import-cancel">
              Cancel
            </Button>
            <Button variant="primary" class="btn-import-submit" id="import-submit">
              Import
            </Button>
          </div>
        </div>
      </div>
      <p class="dash-sub">
        Signed in as {primaryEmail}.{' '}
        <a class="dash-sign-out" href="/sign-out">
          Sign out
        </a>
      </p>

      {cards.length > 0 ? (
        <div class="site-grid">
          {cards.map((s) => (
            <div class="site-card">
              <div class="site-card-thumb">
                <iframe
                  srcdoc={s.thumbHtml}
                  scrolling="no"
                  tabindex={-1}
                  loading="lazy"
                  sandbox="allow-same-origin"
                  title={`Preview of ${s.siteName}`}
                />
              </div>
              <div class="site-card-body">
                <h3>{s.siteName}</h3>
                <a
                  class="site-card-addr"
                  href={`https://${s.subdomain}.${apex}`}
                  target="_blank"
                  rel="noopener"
                >
                  {s.subdomain}.{apex}
                </a>
                <div class="site-card-meta">
                  <Badge variant="info">{s.styleKit}</Badge>
                  {s.publishedVersion > 0 ? (
                    <Badge variant="success">published v{String(s.publishedVersion)}</Badge>
                  ) : (
                    <Badge variant="warning">draft</Badge>
                  )}
                  <span class="site-card-date">Updated {formatDate(s.updatedAt)}</span>
                </div>
                <div class="site-card-actions">
                  <Button
                    variant="primary"
                    class="btn-edit"
                    href={`/dashboard/sites/${s.siteId}/edit`}
                  >
                    Edit
                  </Button>
                  {s.publishedVersion > 0 ? (
                    <Button
                      variant="secondary"
                      class="btn-unpublish"
                      data-site-id={s.siteId}
                      data-action="unpublish"
                    >
                      <span class="dot" />
                      Live &middot; Make draft
                    </Button>
                  ) : (
                    <Button variant="secondary" class="btn-publish" data-site-id={s.siteId}>
                      Publish
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    class="btn-dots"
                    aria-expanded="false"
                    aria-label="Site details"
                    title="Site details"
                  >
                    &#x22EE;
                  </Button>
                </div>
              </div>
              <DetailsPanel s={s} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div class="dash-welcome">
            <h2>Welcome to Open Canvas</h2>
            <p>
              Build your first client site in minutes. Pick a template, customize with the canvas
              editor, and publish to a live URL.
            </p>
            <div class="dash-welcome-actions">
              <Button variant="primary" href="/dashboard/templates">
                Pick a template
              </Button>
              <Button
                variant="secondary"
                class="import-site"
                id="import-btn"
                disabled
                title="Site import is disabled in the public POC. Run the scraper locally to enable."
              >
                Import existing site
              </Button>
            </div>
          </div>
          <div class="dash-quick">
            <a href="/dashboard/templates" class="dash-quick-card">
              <span class="qicon">&#x2B50;</span>
              <h3>Start from a template</h3>
              <p>Choose from curated starter templates for portfolios, landing pages, and more.</p>
            </a>
            <a href="/dashboard/profile" class="dash-quick-card">
              <span class="qicon">&#x1F464;</span>
              <h3>Set up your profile</h3>
              <p>Add your name and bio so collaborators know who you are.</p>
            </a>
            <a href="/dashboard/settings" class="dash-quick-card">
              <span class="qicon">&#x2699;</span>
              <h3>Explore settings</h3>
              <p>Check your plan, usage, and notification preferences.</p>
            </a>
          </div>
        </>
      )}
      <div id="card-backdrop" class="card-backdrop" data-open="false" />
      {toggleScript}
      {importScript}
    </DashboardShell>,
  );
});
