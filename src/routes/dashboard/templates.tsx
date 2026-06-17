import { eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { canvasPublishedStyles } from '../../canvas/public-styles';
import { renderCanvasSnapshot } from '../../canvas/render';
import { requireTurnstileSiteKey } from '../../canvas/elements/form';
import { getSeedAsset } from '../../canvas/seed-assets';
import type { PublishedSnapshot } from '../../canvas/schema';
import { injectInteractiveRuntime } from '../../interactive/inject';
import { siteLimitError, siteLimitForPlan } from '../../billing/plan-limits';
import { db } from '../../db/client';
import { customTemplate, site } from '../../db/schema';
import { allTemplateSeeds, getTemplateSeed, instantiateTemplate, type TemplateSeed } from '../../templates/registry';
import { SUBDOMAIN_RE } from '../api/sites';
import { DashboardShell } from './shell';
import { Button, readThemeCookie } from '../../ui';
import type { Theme } from '../../ui';
import { publicHostSuffix, type HostConfigEnv } from '../../host-config';

// Seed asset bytes inlined as base64 so the template preview works in
// Workers (no filesystem access). Each key matches a SeedAsset.sourcePath.
const SEED_SOURCE_B64: Record<string, string> = {
  'transparent.png.b64':
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
};

const seedBytesCache = new Map<string, Uint8Array>();
function readSeedBytes(sourcePath: string): Uint8Array {
  const cached = seedBytesCache.get(sourcePath);
  if (cached) return cached;
  const b64 = SEED_SOURCE_B64[sourcePath];
  if (!b64) throw new Error(`seed source not found: ${sourcePath}`);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  seedBytesCache.set(sourcePath, bytes);
  return bytes;
}

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  TURNSTILE_SITE_KEY?: string;
};

export const templatesRoute = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

templatesRoute.use('*', clerkAuth());
templatesRoute.use('*', requireAuth());

// MIGRATION.md §5e — templates page wears the Open Canvas dashboard
// chrome. The `.ttab-bar` Community/Personal toggle becomes a settings-
// style underlined tab strip; each template card adopts the `.tpl`
// idiom from landing.html — preview surface on top, label + style-kit
// caption below. The site-name / subdomain fields use `.field`/`label.lbl`
// from components.css.
//
// DOM hooks preserved through the restyle:
//   - `<input type="radio" name="templateId" ...>` per review-smoke
//     ("visible templateId radio inputs").
//   - `<iframe ... src=".../preview" sandbox="allow-scripts">` per
//     review-smoke (no allow-same-origin).
//   - The `.ttab-radio` / `.ttab-bar` / `.ttab-panel` pattern still
//     drives the pure-CSS tab toggle; only its skin changes.
const pageStyles = `
  .content { max-width: 1100px; padding-bottom: 70px; }
  .content > h1 { font-size: 32px; letter-spacing: -.03em; }
  .lede {
    margin: 10px 0 26px;
    max-width: 720px;
    color: var(--ink-2);
    font-size: 15px;
    line-height: 1.55;
  }

  form.tpl-form {
    display: grid;
    gap: 22px;
  }
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 12px;
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* tab toggle: Community / Personal — restyled to settings-style underlined tabs */
  .ttab-radio {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    scroll-margin-top: 72px;
  }
  .ttab-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 22px;
    border-bottom: 1px solid var(--line);
  }
  .ttab-bar label {
    font-family: var(--sans);
    font-size: 14.5px;
    font-weight: 650;
    padding: 12px 4px;
    margin-right: 22px;
    color: var(--ink-3);
    cursor: pointer;
    position: relative;
    white-space: nowrap;
    transition: color .14s ease;
  }
  .ttab-bar label:hover { color: var(--ink-2); }
  #ttab-community:checked ~ .ttab-bar label[for='ttab-community'],
  #ttab-personal:checked ~ .ttab-bar label[for='ttab-personal'] {
    color: var(--ink);
  }
  #ttab-community:checked ~ .ttab-bar label[for='ttab-community']::after,
  #ttab-personal:checked ~ .ttab-bar label[for='ttab-personal']::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 3px;
    background: var(--red);
    border-radius: 99px;
  }
  .ttab-radio:focus-visible ~ .ttab-bar label[for='ttab-community'],
  .ttab-radio:focus-visible ~ .ttab-bar label[for='ttab-personal'] {
    outline: 2px solid var(--red);
    outline-offset: 3px;
    border-radius: var(--r-xs);
  }
  .ttab-panel { display: none; }
  #ttab-community:checked ~ .ttab-panel[data-tab='community'],
  #ttab-personal:checked ~ .ttab-panel[data-tab='personal'] {
    display: block;
  }
  .ttab-empty {
    padding: 40px 24px;
    border: 1px dashed var(--line-2);
    border-radius: var(--r);
    text-align: center;
    color: var(--ink-2);
    font-size: 14px;
    line-height: 1.6;
    background: var(--surface);
  }
  .ttab-empty strong {
    color: var(--ink);
    display: block;
    margin-bottom: 6px;
    font-family: var(--display);
    font-size: 15px;
  }

  /* template gallery (.tpl) — same idiom as landing.html templates section */
  .tpl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .tpl {
    position: relative;
    display: block;
    cursor: pointer;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    transition: transform .16s ease, box-shadow .2s ease, border-color .14s ease;
  }
  .tpl:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow);
  }
  .tpl input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    inset: 0;
  }
  .tpl input:checked ~ .tpl-body {
    /* selected ring */
    box-shadow: inset 0 0 0 2px var(--red);
  }
  .tpl:focus-within {
    outline: 2px solid var(--red);
    outline-offset: 3px;
  }
  .tpl-body {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
  }
  .tpl-shot {
    position: relative;
    height: 168px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--line);
    overflow: hidden;
    container-type: inline-size;
  }
  .tpl-shot iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 1440px;
    height: 900px;
    transform-origin: top left;
    transform: scale(0.22);
    border: none;
    pointer-events: none;
  }
  @container (min-width: 1px) {
    .tpl-shot iframe { transform: scale(calc(100cqi / 1440)); }
  }
  .tpl-cap {
    display: grid;
    gap: 8px;
    padding: 14px 16px 16px;
  }
  .tpl-cap b {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: -0.01em;
    line-height: 1.25;
  }
  .tpl-cap p {
    margin: 0;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 1.45;
  }
  .tpl-cap .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .tpl-cap .kit {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--red-ink);
    letter-spacing: -0.01em;
  }

  /* create-form fields under the template grid */
  .create-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    padding: 22px 24px;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .create-fields .fset { display: grid; gap: 7px; min-width: 0; }
  .create-fields .fset small.hint {
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }
  .subdomain {
    display: flex;
    align-items: stretch;
    gap: 8px;
    min-width: 0;
  }
  .subdomain .field { min-width: 0; }
  .suffix {
    color: var(--ink-3);
    font-family: var(--mono);
    font-size: 12.5px;
    white-space: nowrap;
    align-self: center;
    flex-shrink: 0;
  }

  .submit-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .limit-notice {
    padding: 14px 20px;
    border: 1px solid var(--red-line);
    border-radius: var(--r);
    background: var(--red-tint);
    color: var(--ink-2);
    font-size: 14px;
    line-height: 1.5;
  }
  .limit-notice a {
    color: var(--red-ink);
    font-weight: 650;
    border-bottom: 1px solid currentColor;
    padding-bottom: 1px;
  }

  @media (max-width: 760px) {
    .tpl-grid { grid-template-columns: 1fr; }
    .create-fields { grid-template-columns: 1fr; padding: 18px; }
    .subdomain { flex-direction: column; align-items: stretch; }
    .suffix { align-self: flex-start; }
  }
`;

const previewStyles = `
  html, body { margin: 0; overflow: hidden; background: var(--paper); }
`;

const builtInTemplatePreviewPublishedAt = '2026-05-22T00:00:00.000Z';

/** Body HTML for built-in template picker iframes — full snapshot + interactive runtime. */
export function renderBuiltInTemplatePreviewBodyHtml(
  templateId: string,
  options: { turnstileSiteKey: string },
): string {
  // ADR 0061 Phase D — instantiate the composition to get an EditableSite
  // shape the snapshot renderer accepts. Each preview re-materialises, so
  // pool edits between deploys surface on the next preview render.
  const state = instantiateTemplate(templateId);
  const snapshot: PublishedSnapshot = {
    ...state,
    version: 1,
    publishedAt: builtInTemplatePreviewPublishedAt,
  };
  // Template previews have no backing site yet — forms inside a preview
  // cannot submit to a real /__opencanvas/forms/<siteId>/<formId> endpoint. Pass
  // an explicit synthetic id so the renderer's siteId check still passes and
  // any accidental form POST hits a 404 against the forms router instead of
  // a silent double-slash URL.
  return injectInteractiveRuntime(
    renderCanvasSnapshot(
      snapshot,
      `/dashboard/templates/${templateId}/assets`,
      '__template-preview__',
      { turnstileSiteKey: options.turnstileSiteKey },
    ),
    snapshot,
  );
}

function PreviewPage({
  template,
  turnstileSiteKey,
}: {
  template: TemplateSeed;
  turnstileSiteKey: string;
}) {
  const html = renderBuiltInTemplatePreviewBodyHtml(template.id, { turnstileSiteKey });

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{template.name} preview</title>
        <style>{raw(canvasPublishedStyles)}</style>
        <style>{raw(previewStyles)}</style>
      </head>
      <body>{raw(html)}</body>
    </html>
  );
}

interface CustomTemplateCard {
  id: string;
  name: string;
  tagline: string;
  styleKit: string;
  visibility: string;
}

function CustomTemplateTile({ dt }: { dt: CustomTemplateCard }) {
  return (
    <label class="tpl">
      <input type="radio" name="templateId" value={dt.id} required checked={false} />
      <span class="tpl-body">
        <span class="tpl-shot">
          <iframe
            src={`/api/custom-templates/${dt.id}/preview`}
            scrolling="no"
            tabindex={-1}
            title={`${dt.name} preview`}
            loading="lazy"
            sandbox="allow-scripts"
          />
        </span>
        <span class="tpl-cap">
          <b>{dt.name}</b>
          <p>{dt.tagline}</p>
          <span class="meta">
            <span class="kit">{dt.styleKit}</span>
          </span>
        </span>
      </span>
    </label>
  );
}

function Page({
  communityCustomTemplates,
  personalCustomTemplates,
  siteLimitErrorMessage,
  publishedSuffix,
  theme,
}: {
  communityCustomTemplates: CustomTemplateCard[];
  personalCustomTemplates: CustomTemplateCard[];
  siteLimitErrorMessage: string | null;
  publishedSuffix: string;
  theme?: Theme | undefined;
}) {
  const subdomainPattern = SUBDOMAIN_RE.source;
  const communityCount = allTemplateSeeds.length + communityCustomTemplates.length;
  const personalCount = personalCustomTemplates.length;
  const hasAnyCustom = communityCustomTemplates.length + personalCustomTemplates.length > 0;
  return (
    <DashboardShell
      title="Open Canvas — create site"
      crumbs={[{ label: 'Templates' }]}
      activePath="/dashboard/templates"
      pageStyles={pageStyles}
      theme={theme}
    >
      <h1>Pick a starting point</h1>
      <p class="lede">
        Choose the canvas seed closest to what you want. You can still move every primitive, rewrite
        the rich text, swap the Style Kit, and publish when it feels right.
      </p>

      <form class="tpl-form" method="post" action="/api/sites">
        <fieldset>
          <legend>Template</legend>
          <input type="radio" id="ttab-community" name="__ttab" class="ttab-radio" checked />
          <input type="radio" id="ttab-personal" name="__ttab" class="ttab-radio" />
          <div class="ttab-bar" role="tablist">
            <label for="ttab-community">Community ({communityCount})</label>
            <label for="ttab-personal">Personal ({personalCount})</label>
          </div>

          <div class="ttab-panel" data-tab="community">
            <div class="tpl-grid">
              {allTemplateSeeds.map((template, idx) => (
                <label class="tpl">
                  <input
                    type="radio"
                    name="templateId"
                    value={template.id}
                    required
                    checked={idx === 0 && !hasAnyCustom}
                  />
                  <span class="tpl-body">
                    <span class="tpl-shot">
                      <iframe
                        src={`/dashboard/templates/${template.id}/preview`}
                        scrolling="no"
                        tabindex={-1}
                        title={`${template.name} preview`}
                        loading="lazy"
                        sandbox="allow-scripts"
                      />
                    </span>
                    <span class="tpl-cap">
                      <b>{template.name}</b>
                      <p>{template.tagline}</p>
                      <span class="meta">
                        <span class="kit">{template.styleKit}</span>
                      </span>
                    </span>
                  </span>
                </label>
              ))}
              {communityCustomTemplates.map((dt) => (
                <CustomTemplateTile dt={dt} />
              ))}
            </div>
          </div>

          <div class="ttab-panel" data-tab="personal">
            {personalCustomTemplates.length === 0 ? (
              <div class="ttab-empty">
                <strong>No personal templates yet</strong>
                Save a site as a template from the editor to start your private library. Personal
                templates are only visible to you.
              </div>
            ) : (
              <div class="tpl-grid">
                {personalCustomTemplates.map((dt) => (
                  <CustomTemplateTile dt={dt} />
                ))}
              </div>
            )}
          </div>
        </fieldset>

        <div class="create-fields">
          <div class="fset">
            <label class="lbl" for="siteName">
              Site name
            </label>
            <input
              class="field"
              type="text"
              id="siteName"
              name="siteName"
              maxlength={80}
              required
              placeholder="My site"
            />
          </div>

          <div class="fset">
            <label class="lbl" for="subdomain">
              Subdomain <small class="hint">(optional — auto-generated from name if blank)</small>
            </label>
            <span class="subdomain">
              <input
                class="field"
                type="text"
                id="subdomain"
                name="subdomain"
                maxlength={63}
                pattern={subdomainPattern}
                placeholder="auto-generated"
              />
              <span class="suffix">{publishedSuffix}</span>
            </span>
          </div>
        </div>

        <div class="submit-row">
          {siteLimitErrorMessage ? (
            <p class="limit-notice">
              {siteLimitErrorMessage} <a href="/dashboard/settings">Upgrade</a> to create more.
            </p>
          ) : (
            <Button variant="primary" type="submit">
              Create site
            </Button>
          )}
        </div>
      </form>
    </DashboardShell>
  );
}

templatesRoute.get('/:templateId/preview', (c) => {
  const template = getTemplateSeed(c.req.param('templateId'));
  if (!template) {
    return c.text('template not found', 404);
  }
  return c.html(
    <PreviewPage template={template} turnstileSiteKey={requireTurnstileSiteKey(c.env)} />,
  );
});

templatesRoute.get('/:templateId/assets/:assetId', (c) => {
  const template = getTemplateSeed(c.req.param('templateId'));
  if (!template) {
    return c.text('template not found', 404);
  }
  const asset = getSeedAsset(c.req.param('assetId'));
  if (!asset) {
    return c.text('template asset not found', 404);
  }
  // The preview path reads bytes directly from the seed-source files so it
  // works in dev without the R2 binding being populated. The R2-backed
  // read path (`/assets/:contentHash` on the public host) is the canonical
  // surface for live sites; this dashboard-side route is a build-time
  // preview affordance only.
  const bytes = readSeedBytes(asset.sourcePath);
  return new Response(bytes, {
    headers: {
      'content-type': asset.mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
});

templatesRoute.get('/', async (c) => {
  const auth = c.get('auth');
  const communityCustomTemplates: CustomTemplateCard[] = [];
  const personalCustomTemplates: CustomTemplateCard[] = [];
  let siteLimitErrorMessage: string | null = null;
  if (auth.userId) {
    const database = db(c.env);
    // clerkAuth() middleware already loaded the customer row.
    const customerRecord = c.get('customer');
    if (!customerRecord) {
      throw new Error('templates route reached with authenticated user but no customer row');
    }
    const customerId = customerRecord.id;
    const customerPlan = customerRecord.plan;

    const whereClause = or(
      eq(customTemplate.visibility, 'global'),
      eq(customTemplate.customerId, customerId),
    );

    const rows = await database
      .select({
        id: customTemplate.id,
        name: customTemplate.name,
        tagline: customTemplate.tagline,
        styleKit: customTemplate.styleKit,
        visibility: customTemplate.visibility,
      })
      .from(customTemplate)
      .where(whereClause);

    for (const row of rows) {
      if (row.visibility === 'private') {
        personalCustomTemplates.push(row);
      } else {
        communityCustomTemplates.push(row);
      }
    }

    const siteLimit = siteLimitForPlan(customerPlan);
    if (siteLimit !== null) {
      const countRows = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(site)
        .where(eq(site.customerId, customerId));
      if ((countRows[0]?.count ?? 0) >= siteLimit) {
        siteLimitErrorMessage = siteLimitError(customerPlan);
      }
    }
  }

  return c.html(
    <Page
      communityCustomTemplates={communityCustomTemplates}
      personalCustomTemplates={personalCustomTemplates}
      siteLimitErrorMessage={siteLimitErrorMessage}
      publishedSuffix={publicHostSuffix(c.env)}
      theme={readThemeCookie(c)}
    />,
  );
});
