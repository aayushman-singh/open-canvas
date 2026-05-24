import { Hono } from 'hono';
import { raw } from 'hono/html';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { clerkAuth, resolveAuthRedirectUrl, resolveClerkKeys } from '../../auth/middleware';
import { buildSignOutUrl, requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { renderCanvasSnapshot } from '../../canvas/render';
import { canvasPublishedStyles } from '../../canvas/public-styles';
import type { PublishedSnapshot, CanvasSiteState } from '../../canvas/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DEV_PUBLIC_HOST?: string;
  DATABASE_URL: string;
};

export const dashboard = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

dashboard.use('*', clerkAuth());
dashboard.use('*', requireAuth());

const THUMB_SCALE = 0.24;

function formatDate(d: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[d.getUTCMonth()]} ${String(d.getUTCDate())}`;
}

function buildThumbHtml(
  state: CanvasSiteState,
  siteId: string,
  origin: string,
): string {
  const snapshot: PublishedSnapshot = {
    version: 0,
    publishedAt: new Date().toISOString(),
    styleKit: state.styleKit,
    pages: state.pages,
    ...(state.customStyleKit ? { customStyleKit: state.customStyleKit } : {}),
    ...(state.symbols?.length ? { symbols: state.symbols } : {}),
  };
  try {
    const canvasHtml = renderCanvasSnapshot(
      snapshot,
      `/api/canvas/sites/${siteId}/assets`,
      siteId,
    );
    return [
      '<!DOCTYPE html><html><head>',
      `<base href="${origin}/">`,
      '<style>', canvasPublishedStyles, '</style>',
      '</head><body style="margin:0;overflow:hidden;background:#0a0a0a">',
      canvasHtml,
      '</body></html>',
    ].join('');
  } catch {
    return [
      '<html><body style="margin:0;background:#111;color:#555;',
      'display:flex;align-items:center;justify-content:center;',
      'height:100vh;font-family:sans-serif">',
      '<p>Preview unavailable</p></body></html>',
    ].join('');
  }
}

const cardStyles = `
  .dash-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .dash-header h1 { margin: 0; font-size: 28px; }
  .dash-header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .dash-header .new-site,
  .dash-header .import-site {
    font-size: 13px;
    font-weight: 500;
    padding: 6px 14px;
    border-radius: 6px;
    text-decoration: none;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }
  .dash-header .new-site {
    background: var(--accent);
    color: var(--bg);
  }
  .dash-header .new-site:hover { filter: brightness(0.88); }
  .dash-header .import-site {
    background: rgba(125,211,252,0.10);
    color: var(--accent);
    border: 1px solid rgba(125,211,252,0.18);
  }
  .dash-header .import-site:hover { background: rgba(125,211,252,0.18); }

  .import-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(4px);
    display: none;
    align-items: center;
    justify-content: center;
  }
  .import-modal-overlay[data-open="true"] { display: flex; }
  .import-modal {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    width: min(480px, calc(100vw - 48px));
    padding: 28px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6);
  }
  .import-modal h2 {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 600;
    color: var(--text);
  }
  .import-modal .import-sub {
    margin: 0 0 20px;
    font-size: 13px;
    color: var(--faint);
  }
  .import-field {
    margin-bottom: 14px;
  }
  .import-field label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    margin-bottom: 5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .import-field input {
    width: 100%;
    padding: 9px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .import-field input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(125,211,252,0.15);
  }
  .import-field .field-hint {
    font-size: 11px;
    color: var(--faint);
    margin-top: 4px;
  }
  .import-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 20px;
  }
  .import-actions button {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }
  .btn-import-cancel {
    background: rgba(255,255,255,0.06);
    color: var(--muted);
  }
  .btn-import-cancel:hover { background: rgba(255,255,255,0.10); }
  .btn-import-submit {
    background: var(--accent);
    color: var(--bg);
  }
  .btn-import-submit:hover { filter: brightness(0.88); }
  .btn-import-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }
  .import-error {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: rgba(239,68,68,0.10);
    border: 1px solid rgba(239,68,68,0.25);
    color: #ef4444;
    font-size: 13px;
    display: none;
  }
  .import-progress {
    margin-top: 12px;
    font-size: 13px;
    color: var(--accent);
    display: none;
  }
  .dash-sub { color: var(--faint); font-size: 13px; margin: 0 0 24px; }

  .site-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 20px;
    margin: 0 0 32px;
  }
  .site-card {
    position: relative;
    background: var(--panel);
    border-radius: 12px;
    border: 1px solid var(--line);
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s ease;
  }
  .site-card:hover:not(.site-card--expanded) {
    border-color: rgba(125,211,252,0.35);
    transform: translateY(-3px);
  }

  /* backdrop — fades in */
  .card-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: rgba(0,0,0,0.65);
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
    border-color: var(--accent);
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px var(--accent);
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
    background: #0a0a0a;
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

  .site-card-body {
    padding: 16px 20px;
  }
  .site-card-body h3 {
    margin: 0 0 4px;
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  .site-card-addr {
    display: inline-block;
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
    margin-bottom: 10px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .site-card-addr:hover { text-decoration: underline; }

  .site-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 14px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .badge-kit {
    background: rgba(125,211,252,0.10);
    color: var(--accent);
    border: 1px solid rgba(125,211,252,0.18);
  }
  .badge-pub {
    background: rgba(74,222,128,0.10);
    color: #4ade80;
    border: 1px solid rgba(74,222,128,0.18);
  }
  .badge-draft {
    background: rgba(250,204,21,0.10);
    color: #facc15;
    border: 1px solid rgba(250,204,21,0.18);
  }
  .site-card-date {
    font-size: 12px;
    color: var(--faint);
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
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    transition: background 0.12s, filter 0.12s;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }
  .btn-edit {
    flex: 1;
    background: var(--accent);
    color: var(--bg);
  }
  .btn-edit:hover { filter: brightness(0.88); }

  .btn-live {
    flex: 1;
    background: rgba(74,222,128,0.12);
    color: #4ade80;
    border: 1px solid rgba(74,222,128,0.22);
  }
  .btn-live:hover { background: rgba(74,222,128,0.20); }
  .btn-live .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    margin-right: 6px;
  }

  .btn-publish {
    flex: 1;
    background: rgba(250,204,21,0.10);
    color: #facc15;
    border: 1px solid rgba(250,204,21,0.18);
  }
  .btn-publish:hover { background: rgba(250,204,21,0.18); }

  .btn-unpublish {
    flex: 1;
    background: rgba(74,222,128,0.10);
    color: #4ade80;
    border: 1px solid rgba(74,222,128,0.18);
  }
  .btn-unpublish:hover { background: rgba(239,68,68,0.12); color: #ef4444; border-color: rgba(239,68,68,0.25); }
  .btn-unpublish .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    margin-right: 6px;
  }
  .btn-unpublish:hover .dot { background: #ef4444; }

  .btn-dots {
    width: 38px;
    min-width: 38px;
    background: var(--panel-strong, #182235);
    color: var(--muted);
    border: 1px solid var(--line);
    font-size: 18px;
    letter-spacing: 1px;
    line-height: 1;
    padding: 0;
  }
  .btn-dots:hover { background: rgba(255,255,255,0.08); color: var(--text); }
  .btn-dots[aria-expanded="true"] {
    background: rgba(125,211,252,0.10);
    color: var(--accent);
    border-color: rgba(125,211,252,0.25);
  }

  /* --- expandable details panel --- */
  .site-card-details {
    display: none;
    border-top: 1px solid var(--line);
    background: var(--bg);
    padding: 16px 20px;
  }
  .site-card-details[data-open="true"] {
    display: block;
  }
  .details-heading {
    margin: 0 0 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
  }
  .details-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .details-table tr {
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .details-table tr:last-child { border-bottom: none; }
  .details-table td {
    padding: 7px 0;
    vertical-align: middle;
  }
  .details-table td:first-child {
    color: var(--muted);
    width: 45%;
  }
  .details-table td:last-child {
    color: var(--text);
    text-align: right;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }
  .pill-on {
    background: rgba(74,222,128,0.10);
    color: #4ade80;
  }
  .pill-off {
    background: rgba(255,255,255,0.04);
    color: var(--faint);
  }
  .pill-info {
    background: rgba(125,211,252,0.08);
    color: var(--accent);
  }

  .dash-sign-out {
    font-size: 13px;
    color: var(--faint);
  }

  .site-card-thumb { container-type: inline-size; }
  @container (min-width: 1px) {
    .site-card-thumb iframe { transform: scale(calc(100cqi / 1440)); }
    .site-card--expanded .site-card-thumb iframe { transform: scale(calc(100cqi / 1440)); }
  }

  .status-live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 500;
    color: #4ade80;
  }
  .status-live .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
  }

  .detail-link a {
    display: contents;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
  }
  .detail-link:hover {
    background: rgba(125,211,252,0.06);
  }
  .detail-link td:first-child::after {
    content: ' \\2192';
    color: var(--accent);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .detail-link:hover td:first-child::after {
    opacity: 1;
  }

  .import-arrow {
    text-align: center;
    color: var(--faint);
    font-size: 12px;
    padding: 4px 0;
    letter-spacing: 0.03em;
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

  openBtn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
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
      alert(err.message || 'Unpublish failed');
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
      alert(err.message || 'Publish failed');
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
  darkModeEnabled: boolean;
  searchIndexing: boolean;
}

function buildCards(
  rows: Array<{
    id: string;
    name: string;
    subdomain: string;
    styleKit: string;
    publishedVersion: number;
    updatedAt: Date;
    editableState: CanvasSiteState;
    passwordEnabled: boolean;
  }>,
  origin: string,
): SiteCard[] {
  return rows.map((row) => {
    const state = row.editableState;
    return {
      siteId: row.id,
      siteName: row.name,
      subdomain: row.subdomain,
      styleKit: row.styleKit,
      publishedVersion: row.publishedVersion,
      updatedAt: row.updatedAt,
      thumbHtml: buildThumbHtml(state, row.id, origin),
      passwordEnabled: row.passwordEnabled,
      darkModeEnabled: state.darkModeEnabled ?? false,
      searchIndexing: !(state.siteNoIndex ?? false),
    };
  });
}

function Pill({ on, label }: { on: boolean; label?: string }) {
  const text = label ?? (on ? 'On' : 'Off');
  return <span class={`pill ${on ? 'pill-on' : 'pill-off'}`}>{text}</span>;
}

function InfoPill({ label }: { label: string }) {
  return <span class="pill pill-info">{label}</span>;
}

function DetailRow({
  label,
  href,
  children,
}: {
  label: string;
  href?: string;
  children: unknown;
}) {
  const inner = (
    <>
      <td>{label}</td>
      <td>{children as string}</td>
    </>
  );
  if (href) {
    return <tr class="detail-link"><a href={href}>{inner}</a></tr>;
  }
  return <tr>{inner}</tr>;
}

function DetailsPanel({ s }: { s: SiteCard }) {
  const editBase = `/dashboard/sites/${s.siteId}`;
  return (
    <div class="site-card-details" data-open="false">
      <p class="details-heading">Site details</p>
      <table class="details-table">
        <tbody>
          <DetailRow label="Hosting" href={`${editBase}/settings`}>
            <InfoPill label="Starter" />
          </DetailRow>
          <DetailRow label="CDN">
            <InfoPill label="Cloudflare Edge" />
          </DetailRow>
          <DetailRow label="Custom domain" href={`${editBase}/domains`}>
            <Pill on={false} label="Not configured" />
          </DetailRow>
          <DetailRow label="Password protection" href={`${editBase}/settings`}>
            <Pill on={s.passwordEnabled} />
          </DetailRow>
          <DetailRow label="Search indexing" href={`${editBase}/settings`}>
            <Pill on={s.searchIndexing} />
          </DetailRow>
          <DetailRow label="Visitor dark mode" href={`${editBase}/settings`}>
            <Pill on={s.darkModeEnabled} label={s.darkModeEnabled ? 'Toggleable' : 'Locked'} />
          </DetailRow>
          <DetailRow label="Analytics">
            <Pill on={false} label="Not connected" />
          </DetailRow>
          <DetailRow label="Style kit" href={`${editBase}/edit`}>
            <InfoPill label={s.styleKit} />
          </DetailRow>
        </tbody>
      </table>
    </div>
  );
}

dashboard.get('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new Error('dashboard reached without a resolved user');
  }

  const primaryEmail = user.emailAddresses.find(
    (addr) => addr.id === user.primaryEmailAddressId,
  )?.emailAddress;

  if (!primaryEmail) {
    throw new Error(`clerk user ${user.id} has no primary email address`);
  }

  const database = db(c.env);

  await database
    .insert(customer)
    .values({
      clerkUserId: user.id,
      email: primaryEmail,
    })
    .onConflictDoUpdate({
      target: customer.clerkUserId,
      set: {
        email: primaryEmail,
        updatedAt: sql`now()`,
      },
    });

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, user.id))
    .limit(1);
  const customerId = customerRow[0]?.id;

  const origin = new URL(c.req.url).origin;

  let cards: SiteCard[] = [];
  if (customerId) {
    const rows = await database
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
      .orderBy(desc(site.createdAt));

    cards = buildCards(rows, origin);
  }

  const { publishableKey } = resolveClerkKeys(c.env);
  const signOutUrl = buildSignOutUrl(publishableKey, resolveAuthRedirectUrl(c.env, c.req.url, '/'));

  return c.html(
    <DashboardShell
      title="rev01 — dashboard"
      crumbs={[{ label: 'Dashboard' }]}
      activePath="/dashboard"
      pageStyles={cardStyles}
    >
      <div class="dash-header">
        <h1>Your sites</h1>
        <div class="dash-header-actions">
          <button class="import-site" type="button" id="import-btn">Import</button>
          <a class="new-site" href="/dashboard/templates">+ New site</a>
        </div>
      </div>

      <div class="import-modal-overlay" id="import-overlay" data-open="false">
        <div class="import-modal">
          <h2>Import a website</h2>
          <p class="import-sub">Paste any public URL to import it as an editable site.</p>
          <div class="import-field">
            <label for="import-url">URL to import</label>
            <input type="url" id="import-url" placeholder="https://example.com" required />
          </div>
          <div class="import-arrow">&#x2193; auto-filled from URL</div>
          <div class="import-field">
            <label for="import-name">Site name</label>
            <input type="text" id="import-name" placeholder="My Imported Site" maxlength={80} required />
          </div>
          <div class="import-field">
            <label for="import-subdomain">Subdomain <small>(optional)</small></label>
            <input type="text" id="import-subdomain" placeholder="auto-generated from name" />
            <p class="field-hint">.rev01.aayushman.dev</p>
          </div>
          <div class="import-error" id="import-error"></div>
          <div class="import-progress" id="import-progress">Importing... this may take up to 30 seconds.</div>
          <div class="import-actions">
            <button class="btn-import-cancel" type="button" id="import-cancel">Cancel</button>
            <button class="btn-import-submit" type="button" id="import-submit">Import</button>
          </div>
        </div>
      </div>
      <p class="dash-sub">
        Signed in as {primaryEmail}.{' '}
        <a class="dash-sign-out" href={signOutUrl}>Sign out</a>
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
                  href={`https://${s.subdomain}.rev01.aayushman.dev`}
                  target="_blank"
                  rel="noopener"
                >
                  {s.subdomain}.rev01.aayushman.dev
                </a>
                <div class="site-card-meta">
                  <span class="badge badge-kit">{s.styleKit}</span>
                  {s.publishedVersion > 0 ? (
                    <span class="badge badge-pub">published v{String(s.publishedVersion)}</span>
                  ) : (
                    <span class="badge badge-draft">draft</span>
                  )}
                  <span class="site-card-date">Updated {formatDate(s.updatedAt)}</span>
                </div>
                <div class="site-card-actions">
                  <a class="btn-edit" href={`/dashboard/sites/${s.siteId}/edit`}>Edit</a>
                  {s.publishedVersion > 0 ? (
                    <button
                      class="btn-unpublish"
                      data-site-id={s.siteId}
                      data-action="unpublish"
                      type="button"
                    >
                      <span class="dot" />
                      Live &middot; Make draft
                    </button>
                  ) : (
                    <button class="btn-publish" data-site-id={s.siteId} type="button">
                      Publish
                    </button>
                  )}
                  <button
                    class="btn-dots"
                    type="button"
                    aria-expanded="false"
                    aria-label="Site details"
                    title="Site details"
                  >
                    &#x22EE;
                  </button>
                </div>
              </div>
              <DetailsPanel s={s} />
            </div>
          ))}
        </div>
      ) : (
        <p>
          No sites yet — <a href="/dashboard/templates">pick a template</a> to start.
        </p>
      )}
      <div id="card-backdrop" class="card-backdrop" data-open="false" />
      {toggleScript}
      {importScript}
    </DashboardShell>,
  );
});
