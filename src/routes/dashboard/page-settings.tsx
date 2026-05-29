// src/routes/dashboard/page-settings.tsx
//
// Wishlist #21 — Owner SEO panel for a single page.
//
// Surfaces the per-page SEO fields (title, description, ogImageAssetId,
// canonical, noIndex, locale) plus the site-level `siteNoIndex` switch in
// one dashboard surface. The fields map 1:1 to `CanvasPage` SEO fields
// declared in `src/canvas/schema.ts`; the renderer (`emitPageMeta`)
// reads exactly the same shape.
//
// Mount point — `GET /dashboard/sites/:siteId/pages/:pageId/seo`. The
// main thread wires this in `src/index.ts` after the Wave 3 merge (the
// brief forbids this file from editing `src/index.ts`).
//
// Form submission: the page POSTs back to the same path. Persistence
// goes through the canvas API the same way other editor-side mutations
// do — see the brief's "Files forbidden" note: this surface only
// renders the UI; the canvas API + publish flow remain untouched.
// The inline client script posts a JSON patch to the canvas state
// endpoint; the actual server route handler is intentionally left as
// a follow-up wire-up by the main thread integration step, so this
// file owns only the dashboard render.
//
// Char limit warnings (60 title / 160 description) are SOFT — the
// renderer never truncates. The editor surface flags but does not
// reject input.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { CanvasPage, EditableSite, StyleKitPreset } from '../../canvas/schema';
import { getStyleKitPreset } from '../../canvas/style-kits';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { DashboardShell, buildSiteNav } from './shell';
import { Button, Card, readThemeCookie } from '../../ui';
import { appDomain, type HostConfigEnv } from '../../host-config';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const pageSettingsRoute = new Hono<Env>();

pageSettingsRoute.use('*', clerkAuth());
pageSettingsRoute.use('*', requireAuth());

const pageStyles = `
  .lede { margin: 8px 0 24px; color: var(--muted); max-width: 640px; line-height: 1.55; }

  /* Two-column layout — form left, sticky preview column right. Collapses to a
     single column under 1100px so the previews stack under the form. */
  .seo-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: 22px;
    align-items: start;
  }
  @media (max-width: 1100px) {
    .seo-layout { grid-template-columns: 1fr; }
  }
  .seo-preview-column { position: sticky; top: 24px; display: grid; gap: 16px; }

  form.seo {
    display: grid;
    gap: 14px;
  }
  form.seo label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  form.seo input[type="text"],
  form.seo input[type="url"],
  form.seo textarea {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 10px 12px;
    font-size: 15px;
    font-family: inherit;
  }
  form.seo textarea {
    min-height: 90px;
    resize: vertical;
  }
  form.seo .row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--text);
  }
  form.seo .row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  form.seo .charcount {
    color: var(--faint);
    font-size: 12px;
    margin-top: 2px;
  }
  form.seo .charcount.warn {
    color: #fbbf24;
  }
  form.seo .save-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 6px;
  }
  .err {
    margin-top: 4px;
    color: #fca5a5;
    font-size: 13px;
    min-height: 18px;
  }
  .ok {
    margin-top: 4px;
    color: #86efac;
    font-size: 13px;
    min-height: 18px;
  }

  /* --- Asset picker control (replaces the old "asset id" text box) ------- */
  .asset-picker {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 12px;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px;
    background: #0c1220;
  }
  .asset-picker .thumb {
    width: 64px;
    height: 64px;
    border-radius: 6px;
    background: rgba(255,255,255,0.04);
    border: 1px dashed rgba(255,255,255,0.10);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--faint);
    font-size: 11px;
    text-align: center;
  }
  .asset-picker .thumb[data-has-image="true"] {
    border-style: solid;
    border-color: rgba(255,255,255,0.15);
  }
  .asset-picker .controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .asset-picker .controls .meta {
    flex: 1 1 100%;
    color: var(--faint);
    font-size: 12px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .asset-picker button {
    background: rgba(125, 211, 252, 0.10);
    border: 1px solid rgba(125, 211, 252, 0.30);
    color: var(--accent);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .asset-picker button:hover { background: rgba(125,211,252,0.18); border-color: var(--accent); }
  .asset-picker button.clear {
    background: transparent;
    border-color: rgba(252,165,165,0.30);
    color: #fca5a5;
  }
  .asset-picker button.clear:hover { background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.55); }

  /* --- Picker modal ------------------------------------------------------ */
  .picker-modal {
    position: fixed;
    inset: 0;
    background: rgba(5, 8, 16, 0.78);
    backdrop-filter: blur(6px);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }
  .picker-modal[data-open="true"] { display: flex; }
  .picker-sheet {
    width: min(900px, 100%);
    max-height: 86vh;
    background: #0c1220;
    border: 1px solid var(--line);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 30px 80px rgba(0,0,0,0.6);
  }
  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--line);
  }
  .picker-head h3 { margin: 0; font-size: 16px; color: var(--text); }
  .picker-actions { display: flex; gap: 8px; align-items: center; }
  .picker-actions button, .picker-actions label {
    background: rgba(125,211,252,0.10);
    border: 1px solid rgba(125,211,252,0.30);
    color: var(--accent);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .picker-actions .close {
    background: transparent;
    border-color: var(--line);
    color: var(--muted);
  }
  .picker-body {
    padding: 16px 20px;
    overflow: auto;
    flex: 1;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .picker-tile {
    aspect-ratio: 1 / 1;
    border-radius: 8px;
    border: 1px solid var(--line);
    background-size: cover;
    background-position: center;
    background-color: rgba(255,255,255,0.04);
    cursor: pointer;
    position: relative;
    transition: border-color 0.12s, transform 0.12s;
  }
  .picker-tile:hover { border-color: var(--accent); transform: translateY(-1px); }
  .picker-tile .alt {
    position: absolute;
    inset: auto 0 0 0;
    padding: 6px 8px;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,0.7));
    color: #fff;
    font-size: 11px;
    border-radius: 0 0 7px 7px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--muted);
    font-size: 14px;
  }
  .picker-status {
    padding: 8px 20px;
    color: var(--muted);
    font-size: 12.5px;
    border-top: 1px solid var(--line);
    min-height: 16px;
  }
  .picker-status.error { color: #fca5a5; }

  /* --- Preview cards ---------------------------------------------------- */
  .preview-stack { display: grid; gap: 14px; }
  .preview-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faint);
    margin: 0 0 6px;
  }

  /* Native OG card — replica of the Satori template, scaled to fit. */
  .og-card {
    aspect-ratio: 1200 / 630;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 8% 6.6% 0;
    background-color: var(--og-bg, #0c0c0d);
    color: var(--og-text, #f6f6f6);
    font-family: Inter, system-ui, sans-serif;
    box-shadow: 0 10px 24px rgba(0,0,0,0.35);
  }
  .og-card .og-site {
    font-size: clamp(8px, 1.4cqi, 18px);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--og-muted, #9a9aa3);
  }
  .og-card .og-mid {
    display: flex;
    flex-direction: column;
    gap: 1.6cqi;
    margin-bottom: 5%;
  }
  .og-card .og-tick {
    width: 5.3%;
    height: 1%;
    min-height: 4px;
    background-color: var(--og-accent, #d9dde4);
    border-radius: 999px;
  }
  .og-card .og-title {
    font-size: clamp(20px, 5cqi, 76px);
    font-weight: 700;
    line-height: 1.1;
    color: var(--og-text, #f6f6f6);
    max-width: 90%;
    overflow-wrap: break-word;
    margin: 0;
  }
  .og-card .og-desc {
    font-size: clamp(11px, 1.8cqi, 28px);
    line-height: 1.4;
    color: var(--og-muted, #9a9aa3);
    max-width: 80%;
    overflow-wrap: break-word;
    margin: 0;
  }
  .og-card .og-stripe {
    position: absolute;
    inset: auto 0 0 0;
    height: 4%;
    background-color: var(--og-accent, #d9dde4);
  }
  .og-card[data-has-custom="true"] {
    padding: 0;
    background-size: cover;
    background-position: center;
  }
  .og-card[data-has-custom="true"] > * { display: none; }
  .og-card { container-type: inline-size; }

  /* Embedded OG card replica inside Twitter/LinkedIn image slot — same colours
     and layout as the standalone preview, scaled to the slot's inline size. */
  .preview-twitter .pv-img,
  .preview-linkedin .pv-img {
    position: relative;
    overflow: hidden;
  }
  .preview-twitter .pv-img > .og-card,
  .preview-linkedin .pv-img > .og-card {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    border-radius: 0;
    box-shadow: none;
  }
  .preview-twitter .pv-img[data-has-custom="true"] > .og-card,
  .preview-linkedin .pv-img[data-has-custom="true"] > .og-card { display: none; }

  /* Twitter card (light theme — matches the actual platform). */
  .preview-twitter {
    border: 1px solid #cfd9de;
    border-radius: 16px;
    overflow: hidden;
    background: #fff;
    color: #0f1419;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .preview-twitter .pv-img {
    aspect-ratio: 1200 / 630;
    background: #eef3f5;
    position: relative;
  }
  .preview-twitter .pv-meta {
    padding: 10px 14px 12px;
    font-size: 13px;
  }
  .preview-twitter .pv-host {
    color: #536471;
    font-size: 13px;
    margin: 0 0 2px;
    text-transform: lowercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preview-twitter .pv-title {
    color: #0f1419;
    font-size: 15px;
    font-weight: 400;
    line-height: 1.25;
    margin: 0 0 4px;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .preview-twitter .pv-desc {
    color: #536471;
    font-size: 14px;
    line-height: 1.3;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* LinkedIn card. */
  .preview-linkedin {
    border: 1px solid rgba(0,0,0,0.18);
    border-radius: 4px;
    overflow: hidden;
    background: #fff;
    color: #000;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .preview-linkedin .pv-img {
    aspect-ratio: 1200 / 627;
    background: #f3f2ef;
  }
  .preview-linkedin .pv-meta {
    padding: 8px 12px 10px;
    background: #f3f2ef;
  }
  .preview-linkedin .pv-title {
    color: #000;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
    margin: 0 0 3px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .preview-linkedin .pv-host {
    color: rgba(0,0,0,0.6);
    font-size: 12px;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Google SERP snippet. */
  .preview-serp {
    background: #fff;
    color: #202124;
    padding: 16px 18px;
    border-radius: 8px;
    font-family: arial, sans-serif;
    border: 1px solid rgba(0,0,0,0.08);
  }
  .preview-serp .pv-host-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #5f6368;
    margin-bottom: 6px;
  }
  .preview-serp .pv-favicon {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #1a73e8;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    background-size: cover;
    background-position: center;
  }
  .preview-serp .pv-host-text { display: flex; flex-direction: column; }
  .preview-serp .pv-sitename { color: #202124; font-size: 14px; line-height: 1.2; }
  .preview-serp .pv-url { color: #5f6368; font-size: 12px; line-height: 1.2; }
  .preview-serp .pv-title {
    color: #1a0dab;
    font-size: 20px;
    line-height: 1.3;
    margin: 0 0 4px;
    font-weight: 400;
  }
  .preview-serp .pv-desc {
    color: #4d5156;
    font-size: 14px;
    line-height: 1.45;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .preview-serp[data-noindex="true"]::after {
    content: 'noindex — Google will not show this page';
    display: block;
    margin-top: 10px;
    padding: 6px 10px;
    background: rgba(251, 191, 36, 0.16);
    color: #b45309;
    border-radius: 6px;
    font-size: 12px;
  }
`;

interface OwnedPageContext {
  siteId: string;
  siteName: string;
  subdomain: string;
  page: CanvasPage;
  siteNoIndex: boolean;
  preset: StyleKitPreset;
  faviconAssetId: string | null;
}

async function lookupOwnedPage(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
  pageId: string,
): Promise<OwnedPageContext | null> {
  const database = db(env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;

  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      editableState: site.editableState,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const state = row.editableState as EditableSite | null;
  if (!state) return null;
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return null;

  // Resolve the live preview colours. `custom` kits carry their preset inline;
  // built-ins go through the lookup helper. Fall through to charcoal if a
  // custom kit is selected without a preset payload (defensive — the publish
  // path enforces this elsewhere).
  let preset: StyleKitPreset;
  if (state.styleKit === 'custom' && state.customStyleKit !== undefined) {
    preset = state.customStyleKit;
  } else if (state.styleKit === 'custom') {
    preset = getStyleKitPreset('charcoal');
  } else {
    preset = getStyleKitPreset(state.styleKit);
  }

  return {
    siteId: row.id,
    siteName: row.name,
    subdomain: row.subdomain,
    page,
    siteNoIndex: state.siteNoIndex === true,
    preset,
    faviconAssetId: state.faviconAssetId ?? null,
  };
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * The auto-generated OG card design as JSX — a CSS replica of the Satori
 * template in `src/og-image/render.tsx`. Reused in three slots: the
 * standalone preview, and embedded inside the Twitter and LinkedIn card
 * image areas (where it shows what a crawler would actually fetch).
 */
function ogCardJsx(args: {
  siteName: string;
  titleVal: string;
  descriptionVal: string;
  ogStyle: string;
  customImageUrl: string | null;
}) {
  const { siteName, titleVal, descriptionVal, ogStyle, customImageUrl } = args;
  const style =
    customImageUrl !== null
      ? `${ogStyle};background-image:url(${customImageUrl})`
      : ogStyle;
  return (
    <div
      class="og-card"
      data-preview="og"
      data-has-custom={customImageUrl !== null ? 'true' : null}
      style={style}
    >
      <div class="og-site" data-preview-site>{esc(siteName)}</div>
      <div class="og-mid">
        <div class="og-tick"></div>
        <h3
          class="og-title"
          data-preview-title
          data-empty-text="Untitled page"
        >
          {titleVal}
        </h3>
        {descriptionVal.length > 0 ? (
          <p class="og-desc" data-preview-desc data-empty-hide>{raw(descriptionVal)}</p>
        ) : (
          <p class="og-desc" data-preview-desc data-empty-hide hidden></p>
        )}
      </div>
      <div class="og-stripe"></div>
    </div>
  );
}

function clientScript(siteId: string, pageId: string): string {
  const sid = JSON.stringify(siteId);
  const pid = JSON.stringify(pageId);
  return String.raw`
(() => {
  const SITE_ID = ${sid};
  const PAGE_ID = ${pid};
  // Asset thumbnails on the dashboard host go through the owner-auth canvas
  // API. The bare /assets/<id> URL only resolves on a published-site host.
  function assetUrl(id) {
    return '/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/assets/' + encodeURIComponent(id);
  }
  const form = document.querySelector('form.seo');
  if (!form) return;
  const err = form.querySelector('.err');
  const ok = form.querySelector('.ok');
  function clearStatus() {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg) { clearStatus(); if (err) err.textContent = msg; }
  function showOk(msg) { clearStatus(); if (ok) ok.textContent = msg; }

  // Soft char-limit warnings: 60 chars for title, 160 for description.
  function wireCount(inputName, limit) {
    const input = form.querySelector('[name="' + inputName + '"]');
    const counter = form.querySelector('[data-count-for="' + inputName + '"]');
    if (!input || !counter) return;
    function update() {
      const n = input.value.length;
      counter.textContent = n + ' / ' + limit;
      counter.classList.toggle('warn', n > limit);
    }
    input.addEventListener('input', update);
    update();
  }
  wireCount('title', 60);
  wireCount('description', 160);

  // ---- Live previews -----------------------------------------------------
  // Bind title/description inputs to every [data-preview-title|desc] node so
  // OG card, Twitter, LinkedIn and SERP cards stay in sync as the user types.
  // Empty-state rules per element:
  //   data-empty-hide    → set hidden=true when input is empty (OG card desc)
  //   data-empty-text=X  → fall back to X when input is empty (Twitter / SERP)
  //   neither            → clear textContent (rare; effectively invisible)
  function bindPreview(inputName, attr) {
    const input = form.querySelector('[name="' + inputName + '"]');
    if (!input) return;
    const targets = document.querySelectorAll('[' + attr + ']');
    function update() {
      const v = input.value;
      for (const t of targets) {
        if (v.length === 0) {
          if (t.hasAttribute('data-empty-hide')) {
            t.textContent = '';
            t.hidden = true;
          } else if (t.hasAttribute('data-empty-text')) {
            t.textContent = t.getAttribute('data-empty-text') || '';
            t.hidden = false;
          } else {
            t.textContent = '';
          }
        } else {
          t.textContent = v;
          t.hidden = false;
        }
      }
    }
    input.addEventListener('input', update);
    update();
  }
  bindPreview('title', 'data-preview-title');
  bindPreview('description', 'data-preview-desc');

  // Canonical URL preview (SERP) — if the user sets a custom canonical, use
  // it; otherwise show the computed default already rendered server-side.
  const canonicalInput = form.querySelector('[name="canonical"]');
  const canonicalDefault = document.querySelector('[data-preview-canonical]')?.textContent || '';
  if (canonicalInput) {
    canonicalInput.addEventListener('input', () => {
      const node = document.querySelector('[data-preview-canonical]');
      if (!node) return;
      const v = canonicalInput.value.trim();
      node.textContent = v.length > 0 ? v : canonicalDefault;
    });
  }

  // noIndex toggle → toggle the SERP "Google won't show this" notice live.
  const noIndexCb = form.querySelector('[name="noIndex"]');
  if (noIndexCb) {
    // Site-level noIndex still wins even if the user clears the per-page
    // checkbox, so we OR baseline (site) with the live page-level value.
    const serpEl = document.querySelector('[data-preview="serp"]');
    noIndexCb.addEventListener('change', () => {
      if (!serpEl) return;
      const siteBaseline = serpEl.getAttribute('data-site-noindex') === 'true';
      serpEl.setAttribute('data-noindex', (siteBaseline || noIndexCb.checked) ? 'true' : 'false');
    });
  }

  // ---- Asset picker ------------------------------------------------------
  const modal = document.querySelector('[data-picker-modal]');
  const modalGrid = document.querySelector('[data-picker-grid]');
  const modalEmpty = document.querySelector('[data-picker-empty]');
  const modalStatus = document.querySelector('[data-picker-status]');
  const modalClose = document.querySelector('[data-picker-close]');
  const modalUpload = document.querySelector('[data-picker-upload]');
  let activePicker = null; // The .asset-picker element that opened the modal.

  function setStatus(msg, isError) {
    if (!modalStatus) return;
    modalStatus.textContent = msg || '';
    modalStatus.classList.toggle('error', !!isError);
  }

  async function loadAssets() {
    setStatus('Loading…', false);
    try {
      const r = await fetch('/api/owner/assets', { headers: { accept: 'application/json' } });
      if (!r.ok) { setStatus('Could not load assets (' + r.status + ')', true); return; }
      const body = await r.json();
      const assets = Array.isArray(body.assets) ? body.assets : [];
      renderAssetGrid(assets);
      setStatus(assets.length + ' image' + (assets.length === 1 ? '' : 's') + ' available', false);
    } catch (e) {
      setStatus('Network error: ' + (e && e.message ? e.message : String(e)), true);
    }
  }

  function renderAssetGrid(assets) {
    if (!modalGrid || !modalEmpty) return;
    modalGrid.innerHTML = '';
    const imageAssets = assets.filter((a) => (a.kind === 'image') || (typeof a.mediaType === 'string' && a.mediaType.startsWith('image/')));
    if (imageAssets.length === 0) { modalEmpty.hidden = false; return; }
    modalEmpty.hidden = true;
    for (const a of imageAssets) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'picker-tile';
      tile.style.backgroundImage = 'url(' + assetUrl(a.id) + ')';
      tile.setAttribute('data-asset-id', a.id);
      tile.title = a.alt || a.id;
      if (a.alt) {
        const alt = document.createElement('span');
        alt.className = 'alt';
        alt.textContent = a.alt;
        tile.appendChild(alt);
      }
      tile.addEventListener('click', () => selectAsset(a.id));
      modalGrid.appendChild(tile);
    }
  }

  function openPicker(picker) {
    activePicker = picker;
    if (modal) modal.setAttribute('data-open', 'true');
    loadAssets();
  }

  function closePicker() {
    activePicker = null;
    if (modal) modal.removeAttribute('data-open');
  }

  function selectAsset(assetId) {
    if (!activePicker) return;
    const hidden = activePicker.querySelector('input[type="hidden"]');
    const thumb = activePicker.querySelector('[data-picker-thumb]');
    const meta = activePicker.querySelector('[data-picker-meta]');
    const clearBtn = activePicker.querySelector('[data-picker-clear]');
    const chooseBtn = activePicker.querySelector('[data-picker-choose]');
    if (hidden) hidden.value = assetId;
    activePicker.setAttribute('data-asset-id', assetId);
    if (thumb) {
      thumb.style.backgroundImage = 'url(' + assetUrl(assetId) + ')';
      thumb.setAttribute('data-has-image', 'true');
      thumb.textContent = '';
    }
    if (meta) meta.textContent = 'Custom image overrides the generated card.';
    if (clearBtn) clearBtn.hidden = false;
    if (chooseBtn) chooseBtn.textContent = 'Change image';
    // Update every OG card preview (standalone + the embedded copies inside
    // the Twitter and LinkedIn image slots) and the platform image slots.
    const url = 'url(' + assetUrl(assetId) + ')';
    document.querySelectorAll('[data-preview="og"]').forEach((og) => {
      og.setAttribute('data-has-custom', 'true');
      og.style.backgroundImage = url;
    });
    for (const sel of ['[data-preview-img="twitter"]', '[data-preview-img="linkedin"]']) {
      const img = document.querySelector(sel);
      if (!img) continue;
      img.style.backgroundImage = url;
      img.style.backgroundSize = 'cover';
      img.style.backgroundPosition = 'center';
      img.setAttribute('data-has-custom', 'true');
    }
    closePicker();
  }

  function clearAsset(picker) {
    const hidden = picker.querySelector('input[type="hidden"]');
    const thumb = picker.querySelector('[data-picker-thumb]');
    const meta = picker.querySelector('[data-picker-meta]');
    const clearBtn = picker.querySelector('[data-picker-clear]');
    const chooseBtn = picker.querySelector('[data-picker-choose]');
    if (hidden) hidden.value = '';
    picker.setAttribute('data-asset-id', '');
    if (thumb) {
      thumb.style.backgroundImage = '';
      thumb.setAttribute('data-has-image', 'false');
      thumb.textContent = 'auto';
    }
    if (meta) meta.textContent = 'Leave blank to use the auto-generated card.';
    if (clearBtn) clearBtn.hidden = true;
    if (chooseBtn) chooseBtn.textContent = 'Choose image';
    document.querySelectorAll('[data-preview="og"]').forEach((og) => {
      og.removeAttribute('data-has-custom');
      og.style.backgroundImage = '';
    });
    for (const sel of ['[data-preview-img="twitter"]', '[data-preview-img="linkedin"]']) {
      const img = document.querySelector(sel);
      if (!img) continue;
      img.style.backgroundImage = '';
      img.removeAttribute('data-has-custom');
    }
  }

  document.querySelectorAll('[data-asset-picker]').forEach((picker) => {
    const choose = picker.querySelector('[data-picker-choose]');
    const clear = picker.querySelector('[data-picker-clear]');
    if (choose) choose.addEventListener('click', () => openPicker(picker));
    if (clear) clear.addEventListener('click', () => clearAsset(picker));
  });
  if (modalClose) modalClose.addEventListener('click', closePicker);
  if (modal) modal.addEventListener('click', (ev) => { if (ev.target === modal) closePicker(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal && modal.getAttribute('data-open') === 'true') closePicker();
  });

  if (modalUpload) {
    modalUpload.addEventListener('change', async () => {
      const file = modalUpload.files && modalUpload.files[0];
      if (!file) return;
      setStatus('Uploading ' + file.name + '…', false);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/owner/assets', { method: 'POST', body: fd });
        if (!r.ok) {
          let detail = r.statusText;
          try { const b = await r.json(); if (b && b.error) detail = b.error; } catch (_) {}
          setStatus('Upload failed: ' + detail, true);
          modalUpload.value = '';
          return;
        }
        const body = await r.json();
        modalUpload.value = '';
        if (body && body.id) {
          await loadAssets();
          selectAsset(body.id);
        }
      } catch (e) {
        setStatus('Network error: ' + (e && e.message ? e.message : String(e)), true);
        modalUpload.value = '';
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const data = {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      ogImageAssetId: form.ogImageAssetId.value.trim(),
      canonical: form.canonical.value.trim(),
      noIndex: form.noIndex.checked,
      locale: form.locale.value.trim(),
    };
    if (data.title.length === 0) {
      showError('Title is required.');
      if (button) button.disabled = false;
      return;
    }
    try {
      const response = await fetch('/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/pages/' + encodeURIComponent(PAGE_ID) + '/seo', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* noop */ }
        showError(detail);
        if (button) button.disabled = false;
        return;
      }
      showOk('Saved.');
    } catch (e) {
      showError('Network error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (button) button.disabled = false;
    }
  });
})();

// -- Metadata form (page metadata for collections) --
(() => {
  const SITE_ID = ${sid};
  const PAGE_ID = ${pid};
  const form = document.querySelector('#metadata-form');
  if (!form) return;
  const err = form.querySelector('.err');
  const ok = form.querySelector('.ok');
  function clearStatus() {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg) { clearStatus(); if (err) err.textContent = msg; }
  function showOk(msg) { clearStatus(); if (ok) ok.textContent = msg; }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const rawTags = form.tags.value.trim();
    const data = {
      publishedDate: form.publishedDate.value.trim() || null,
      author: form.author.value.trim() || null,
      tags: rawTags.length > 0 ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : null,
      category: form.category.value.trim() || null,
    };
    try {
      const response = await fetch('/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/pages/' + encodeURIComponent(PAGE_ID) + '/metadata', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* noop */ }
        showError(detail);
        if (button) button.disabled = false;
        return;
      }
      showOk('Saved.');
    } catch (e) {
      showError('Network error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (button) button.disabled = false;
    }
  });
})();
`;
}

pageSettingsRoute.get('/sites/:siteId/pages/:pageId/seo', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('page-settings route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  const pageId = c.req.param('pageId');
  if (!siteId || !pageId) {
    return c.text('page not found', 404);
  }
  const owned = await lookupOwnedPage(c.env, auth.userId, siteId, pageId);
  if (!owned) {
    return c.text('page not found', 404);
  }

  const { page, siteName, siteNoIndex, subdomain, preset, faviconAssetId } = owned;
  const titleVal = esc(page.title);
  const descriptionVal = esc(page.description ?? '');
  const ogImageVal = esc(page.ogImageAssetId ?? '');
  const canonicalVal = esc(page.canonical ?? '');
  const localeVal = esc(page.locale ?? '');
  const publishedDateVal = esc(page.publishedDate ?? '');
  const authorVal = esc(page.author ?? '');
  const tagsVal = esc((page.tags ?? []).join(', '));
  const categoryVal = esc(page.category ?? '');

  // -- Preview data --------------------------------------------------------
  // Asset URL for dashboard previews — goes through owner-auth canvas API.
  // The bare /assets/<id> path only resolves on the published-site host.
  const assetUrl = (id: string) =>
    `/api/canvas/sites/${encodeURIComponent(siteId)}/assets/${encodeURIComponent(id)}`;
  const publishedHost = `${subdomain}.${appDomain(c.env)}`;
  const publishedUrl = `https://${publishedHost}${page.slug.length > 0 ? `/${page.slug}` : '/'}`;
  // Initials for the SERP favicon fallback (when no custom favicon is set).
  const siteInitial = siteName.trim().slice(0, 1).toUpperCase() || 'R';
  // Inline style binding the preview colours to the actual Style Kit preset.
  const ogStyle = [
    `--og-bg:${preset.bg}`,
    `--og-text:${preset.text}`,
    `--og-muted:${preset.muted}`,
    `--og-accent:${preset.accent}`,
  ].join(';');

  return c.html(
    <DashboardShell
      title={`${siteName} — ${page.title} — SEO`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: siteName },
        { label: `${page.title} — SEO` },
      ]}
      pageStyles={pageStyles}
      siteNav={buildSiteNav(siteId, siteName, `/dashboard/sites/${siteId}/settings`)}
      theme={readThemeCookie(c)}
    >
      <h1>SEO &amp; metadata</h1>
      <p class="lede">
        How this page appears in search results and social-card unfurls.
        Sharing the published URL on Slack / Twitter / LinkedIn uses these fields.
      </p>

      {siteNoIndex ? (
        <Card style="border-color: rgba(251, 191, 36, 0.5);">
          <h2>Site is set to noindex</h2>
          <p class="sub">
            The site-level <code>siteNoIndex</code> switch is on, so every page
            in this site emits <code>noindex,nofollow</code> regardless of the
            per-page setting below. Turn it off in site settings to expose
            pages individually.
          </p>
        </Card>
      ) : null}

      <div class="seo-layout">
        <Card>
          <h2>Page meta</h2>
          <p class="sub">
            The page title doubles as the browser tab title and the social-card
            headline. Description shows in search snippets and unfurl cards.
          </p>
          <form class="seo" autocomplete="off">
            <label>
              <span>Title</span>
              <input
                type="text"
                name="title"
                value={titleVal}
                required
                maxlength={200}
              />
              <span class="charcount" data-count-for="title">0 / 60</span>
            </label>
            <label>
              <span>Description</span>
              <textarea name="description" maxlength={500}>{raw(descriptionVal)}</textarea>
              <span class="charcount" data-count-for="description">0 / 160</span>
            </label>
            <div>
              <span style="display:block;font-size:13px;color:var(--muted);margin-bottom:6px;">
                Social card image
              </span>
              <div
                class="asset-picker"
                data-asset-picker="og"
                data-asset-id={ogImageVal}
              >
                <div
                  class="thumb"
                  data-picker-thumb
                  data-has-image={ogImageVal.length > 0 ? 'true' : 'false'}
                  style={ogImageVal.length > 0 ? `background-image:url(${assetUrl(page.ogImageAssetId ?? '')})` : ''}
                >
                  {ogImageVal.length > 0 ? '' : 'auto'}
                </div>
                <div class="controls">
                  <button type="button" data-picker-choose>
                    {ogImageVal.length > 0 ? 'Change image' : 'Choose image'}
                  </button>
                  <button
                    type="button"
                    class="clear"
                    data-picker-clear
                    hidden={ogImageVal.length === 0}
                  >
                    Use auto-generated
                  </button>
                  <input type="hidden" name="ogImageAssetId" value={ogImageVal} />
                  <span class="meta" data-picker-meta>
                    {ogImageVal.length > 0
                      ? 'Custom image overrides the generated card.'
                      : 'Leave blank to use the auto-generated card.'}
                  </span>
                </div>
              </div>
            </div>
            <label>
              <span>Canonical URL</span>
              <input
                type="url"
                name="canonical"
                value={canonicalVal}
                placeholder="leave blank to use the page's own URL"
              />
            </label>
            <label>
              <span>Locale (BCP-47)</span>
              <input
                type="text"
                name="locale"
                value={localeVal}
                placeholder="en, fr, ar — defaults to site default"
                maxlength={20}
              />
            </label>
            <div class="row">
              <input
                type="checkbox"
                name="noIndex"
                id="noIndex"
                checked={page.noIndex === true}
              />
              <label for="noIndex" style="color: var(--text); font-size: 14px;">
                Hide this page from search engines (<code>noindex,nofollow</code>)
              </label>
            </div>
            <div class="save-row">
              <Button variant="primary" type="submit">Save</Button>
            </div>
            <p class="err" role="alert" aria-live="polite"></p>
            <p class="ok" role="status" aria-live="polite"></p>
          </form>
        </Card>

        <div class="seo-preview-column">
          <Card>
            <h2>Live preview</h2>
            <p class="sub">
              How this page appears in unfurled links and search results. Updates as you type —
              save to make changes stick.
            </p>
            <div class="preview-stack">
              <div>
                <p class="preview-label">Open Graph card</p>
                {ogCardJsx({
                  siteName,
                  titleVal,
                  descriptionVal,
                  ogStyle,
                  customImageUrl:
                    ogImageVal.length > 0
                      ? assetUrl(page.ogImageAssetId ?? '')
                      : null,
                })}
              </div>

              <div>
                <p class="preview-label">Twitter / X</p>
                <div class="preview-twitter">
                  <div
                    class="pv-img"
                    data-preview-img="twitter"
                    data-has-custom={ogImageVal.length > 0 ? 'true' : null}
                    style={
                      ogImageVal.length > 0
                        ? `background-color:${preset.bg};background-image:url(${assetUrl(page.ogImageAssetId ?? '')});background-size:cover;background-position:center`
                        : `background-color:${preset.bg}`
                    }
                  >
                    {ogCardJsx({
                      siteName,
                      titleVal,
                      descriptionVal,
                      ogStyle,
                      customImageUrl: null,
                    })}
                  </div>
                  <div class="pv-meta">
                    <p class="pv-host" data-preview-host>{publishedHost}</p>
                    <p
                      class="pv-title"
                      data-preview-title
                      data-empty-text="Untitled page"
                    >
                      {titleVal}
                    </p>
                    <p
                      class="pv-desc"
                      data-preview-desc
                      data-empty-text="No description set — Twitter falls back to the title."
                    >
                      {descriptionVal.length > 0 ? raw(descriptionVal) : 'No description set — Twitter falls back to the title.'}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <p class="preview-label">LinkedIn</p>
                <div class="preview-linkedin">
                  <div
                    class="pv-img"
                    data-preview-img="linkedin"
                    data-has-custom={ogImageVal.length > 0 ? 'true' : null}
                    style={
                      ogImageVal.length > 0
                        ? `background-color:${preset.bg};background-image:url(${assetUrl(page.ogImageAssetId ?? '')});background-size:cover;background-position:center`
                        : `background-color:${preset.bg}`
                    }
                  >
                    {ogCardJsx({
                      siteName,
                      titleVal,
                      descriptionVal,
                      ogStyle,
                      customImageUrl: null,
                    })}
                  </div>
                  <div class="pv-meta">
                    <p
                      class="pv-title"
                      data-preview-title
                      data-empty-text="Untitled page"
                    >
                      {titleVal}
                    </p>
                    <p class="pv-host" data-preview-host>{publishedHost}</p>
                  </div>
                </div>
              </div>

              <div>
                <p class="preview-label">Google search result</p>
                <div
                  class="preview-serp"
                  data-preview="serp"
                  data-noindex={page.noIndex === true || siteNoIndex ? 'true' : 'false'}
                  data-site-noindex={siteNoIndex ? 'true' : 'false'}
                >
                  <div class="pv-host-row">
                    <div
                      class="pv-favicon"
                      data-preview-favicon
                      style={faviconAssetId ? `background-image:url(${assetUrl(faviconAssetId)})` : ''}
                    >
                      {faviconAssetId ? '' : siteInitial}
                    </div>
                    <div class="pv-host-text">
                      <span class="pv-sitename">{esc(siteName)}</span>
                      <span class="pv-url" data-preview-canonical>{publishedUrl}</span>
                    </div>
                  </div>
                  <h3
                    class="pv-title"
                    data-preview-title
                    data-empty-text="Untitled page"
                  >
                    {titleVal}
                  </h3>
                  <p
                    class="pv-desc"
                    data-preview-desc
                    data-empty-text="Add a description above to control what Google shows under the title."
                  >
                    {descriptionVal.length > 0 ? raw(descriptionVal) : 'Add a description above to control what Google shows under the title.'}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Shared asset picker modal — one instance, opened by any picker control. */}
      <div class="picker-modal" data-picker-modal>
        <div class="picker-sheet" role="dialog" aria-label="Choose image">
          <div class="picker-head">
            <h3>Choose an image</h3>
            <div class="picker-actions">
              <label>
                Upload new
                <input
                  type="file"
                  data-picker-upload
                  accept="image/*"
                  style="display:none"
                />
              </label>
              <button type="button" class="close" data-picker-close>Close</button>
            </div>
          </div>
          <div class="picker-body">
            <div class="picker-grid" data-picker-grid></div>
            <div class="picker-empty" data-picker-empty hidden>
              No images yet. Click "Upload new" to add one.
            </div>
          </div>
          <p class="picker-status" data-picker-status></p>
        </div>
      </div>

      <Card>
        <h2>Page metadata</h2>
        <p class="sub">
          Used by page-bound collections for filtering, sorting, and display.
          These fields are optional — fill them in when this page should appear
          in collection listings (blog, portfolio, etc.).
        </p>
        <form class="seo" id="metadata-form" autocomplete="off">
          <label>
            <span>Published date</span>
            <input
              type="date"
              name="publishedDate"
              value={publishedDateVal}
            />
          </label>
          <label>
            <span>Author</span>
            <input
              type="text"
              name="author"
              value={authorVal}
              maxlength={200}
            />
          </label>
          <label>
            <span>Tags (comma-separated)</span>
            <input
              type="text"
              name="tags"
              value={tagsVal}
              maxlength={500}
              placeholder="design, launch, case-study"
            />
          </label>
          <label>
            <span>Category</span>
            <input
              type="text"
              name="category"
              value={categoryVal}
              maxlength={100}
              placeholder="blog, portfolio, news"
            />
          </label>
          <div class="save-row">
            <Button variant="primary" type="submit">Save metadata</Button>
          </div>
          <p class="err" role="alert" aria-live="polite"></p>
          <p class="ok" role="status" aria-live="polite"></p>
        </form>
      </Card>

      <script type="module">{raw(clientScript(siteId, pageId))}</script>
    </DashboardShell>,
  );
});

export default pageSettingsRoute;
