import { eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { canvasPublishedStyles } from '../../canvas/public-styles';
import { renderCanvasSnapshot } from '../../canvas/render';
import { getSeedAsset } from '../../canvas/seed-assets';
import type { PublishedSnapshot } from '../../canvas/schema';
import { siteLimitError, siteLimitForPlan } from '../../billing/plan-limits';
import { db } from '../../db/client';
import { customer, customTemplate, site, type BillingPlan } from '../../db/schema';
import { entitlementsFor, isUnlimited } from '../../billing/plans';
import { allTemplateSeeds, getTemplateSeed, type TemplateSeed } from '../../templates/registry';
import { SUBDOMAIN_RE } from '../api/sites';
import { DashboardShell } from './shell';
import { Button } from '../../ui';

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

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

export const templatesRoute = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

templatesRoute.use('*', clerkAuth());
templatesRoute.use('*', requireAuth());

const PUBLISHED_SUFFIX = '.rev01.aayushman.dev';

const pageStyles = `
  .limit-notice {
    padding: 14px 20px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255,255,255,0.04);
    color: var(--muted);
    font-size: 14px;
    margin-top: 12px;
  }
  .limit-notice a { color: var(--accent); font-weight: 600; }
  .lede {
    margin: 10px 0 24px;
    max-width: 640px;
    color: var(--muted);
    font-size: 15px;
  }
  form {
    display: grid;
    gap: 20px;
  }
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 10px;
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
  }
  .ttab-radio {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    scroll-margin-top: 72px;
  }
  .ttab-bar {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    margin-bottom: 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
  }
  .ttab-bar label {
    padding: 8px 16px;
    border-radius: 6px;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: background 140ms ease, color 140ms ease;
  }
  .ttab-bar label:hover {
    color: var(--text);
  }
  #ttab-community:checked ~ .ttab-bar label[for='ttab-community'],
  #ttab-personal:checked ~ .ttab-bar label[for='ttab-personal'] {
    background: var(--accent);
    color: #05070c;
  }
  .ttab-radio:focus-visible ~ .ttab-bar label[for='ttab-community'],
  .ttab-radio:focus-visible ~ .ttab-bar label[for='ttab-personal'] {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .ttab-panel { display: none; }
  #ttab-community:checked ~ .ttab-panel[data-tab='community'],
  #ttab-personal:checked ~ .ttab-panel[data-tab='personal'] {
    display: block;
  }
  .ttab-empty {
    padding: 40px 24px;
    border: 1px dashed var(--line);
    border-radius: 8px;
    text-align: center;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5;
  }
  .ttab-empty strong {
    color: var(--text);
    display: block;
    margin-bottom: 6px;
  }
  .template {
    display: grid;
    min-height: 370px;
    cursor: pointer;
  }
  .template input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .template-body {
    display: grid;
    align-content: space-between;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    overflow: hidden;
    transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
  }
  .template-preview {
    position: relative;
    height: 232px;
    border-bottom: 1px solid var(--line);
    background: #05070c;
    overflow: hidden;
    container-type: inline-size;
  }
  .template-preview iframe {
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
    .template-preview iframe { transform: scale(calc(100cqi / 1440)); }
  }
  .template-copy {
    display: grid;
    align-content: space-between;
    gap: 18px;
    padding: 16px;
  }
  .template input:checked + .template-body {
    border-color: var(--accent);
    background: var(--panel-strong);
  }
  .template:focus-within .template-body {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .template:hover .template-body {
    transform: translateY(-1px);
  }
  .template h2 {
    margin: 0 0 6px;
    font-size: 17px;
    letter-spacing: 0;
  }
  .template p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
  }
  .kit {
    color: var(--accent);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11px;
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
  }
  label.field {
    display: grid;
    gap: 6px;
    color: var(--muted);
    font-size: 13px;
  }
  input[type='text'] {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 11px 12px;
    font-size: 15px;
  }
  .subdomain {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .suffix {
    color: var(--faint);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    white-space: nowrap;
  }
  small {
    color: var(--faint);
    font-size: 12px;
  }
  .rev01-ui-btn { justify-self: start; }
  @media (max-width: 760px) {
    .templates { grid-template-columns: 1fr; }
    .fields { grid-template-columns: 1fr; }
    .subdomain { align-items: stretch; flex-direction: column; }
  }
`;

const previewStyles = `
  html, body { margin: 0; overflow: hidden; background: #05070c; }
`;

function PreviewPage({ template }: { template: TemplateSeed }) {
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-05-22T00:00:00.000Z',
    styleKit: template.state.styleKit,
    pages: template.state.pages,
    ...(template.state.header ? { header: template.state.header } : {}),
    ...(template.state.footer ? { footer: template.state.footer } : {}),
    ...(template.state.customStyleKit ? { customStyleKit: template.state.customStyleKit } : {}),
  };
  const html = renderCanvasSnapshot(snapshot, `/dashboard/templates/${template.id}/assets`);

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
    <label class="template">
      <input type="radio" name="templateId" value={dt.id} required checked={false} />
      <span class="template-body">
        <span class="template-preview">
          <iframe
            src={`/api/custom-templates/${dt.id}/preview`}
            scrolling="no"
            tabindex={-1}
            title={`${dt.name} preview`}
            loading="lazy"
            sandbox=""
          />
        </span>
        <span class="template-copy">
          <span>
            <h2>{dt.name}</h2>
            <p>{dt.tagline}</p>
          </span>
          <span class="kit">{dt.styleKit}</span>
        </span>
      </span>
    </label>
  );
}

function Page({
  communityCustomTemplates,
  personalCustomTemplates,
  atSiteLimit,
}: {
  communityCustomTemplates: CustomTemplateCard[];
  personalCustomTemplates: CustomTemplateCard[];
  atSiteLimit: boolean;
}) {
  const subdomainPattern = SUBDOMAIN_RE.source;
  const communityCount = allTemplateSeeds.length + communityCustomTemplates.length;
  const personalCount = personalCustomTemplates.length;
  const hasAnyCustom = communityCustomTemplates.length + personalCustomTemplates.length > 0;
  return (
    <DashboardShell
      title="rev01 — create site"
      crumbs={[{ label: 'Templates' }]}
      activePath="/dashboard/templates"
      pageStyles={pageStyles}
    >
      <h1>Choose a starting point</h1>
      <p class="lede">
        Pick the canvas seed closest to what you want. You can still move every primitive, rewrite
        the rich text, swap the Style Kit, and publish when it feels right.
      </p>

      <form method="post" action="/api/sites">
        <fieldset>
          <legend>Template</legend>
          <input type="radio" id="ttab-community" name="__ttab" class="ttab-radio" checked />
          <input type="radio" id="ttab-personal" name="__ttab" class="ttab-radio" />
          <div class="ttab-bar" role="tablist">
            <label for="ttab-community">Community ({communityCount})</label>
            <label for="ttab-personal">Personal ({personalCount})</label>
          </div>

          <div class="ttab-panel" data-tab="community">
            <div class="templates">
              {allTemplateSeeds.map((template, idx) => (
                <label class="template">
                  <input
                    type="radio"
                    name="templateId"
                    value={template.id}
                    required
                    checked={idx === 0 && !hasAnyCustom}
                  />
                  <span class="template-body">
                    <span class="template-preview">
                      <iframe
                        src={`/dashboard/templates/${template.id}/preview`}
                        scrolling="no"
                        tabindex={-1}
                        title={`${template.name} preview`}
                        loading="lazy"
                        sandbox=""
                      />
                    </span>
                    <span class="template-copy">
                      <span>
                        <h2>{template.name}</h2>
                        <p>{template.tagline}</p>
                      </span>
                      <span class="kit">{template.state.styleKit}</span>
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
              <div class="templates">
                {personalCustomTemplates.map((dt) => (
                  <CustomTemplateTile dt={dt} />
                ))}
              </div>
            )}
          </div>
        </fieldset>

        <div class="fields">
          <label class="field">
            <span>Site name</span>
            <input type="text" name="siteName" maxlength={80} required placeholder="My site" />
          </label>

          <label class="field">
            <span>
              Subdomain <small>(optional — auto-generated from name if blank)</small>
            </span>
            <span class="subdomain">
              <input
                type="text"
                name="subdomain"
                maxlength={63}
                pattern={subdomainPattern}
                placeholder="auto-generated"
              />
              <span class="suffix">{PUBLISHED_SUFFIX}</span>
            </span>
          </label>
        </div>

        {siteLimitErrorMessage ? (
          <p class="limit-notice">
            {siteLimitErrorMessage} <a href="/dashboard/settings">Upgrade</a> to create more.
          </p>
        ) : (
          <Button variant="primary" type="submit">
            Create site
          </Button>
        )}
      </form>
    </DashboardShell>
  );
}

templatesRoute.get('/:templateId/preview', (c) => {
  const template = getTemplateSeed(c.req.param('templateId'));
  if (!template) {
    return c.text('template not found', 404);
  }
  return c.html(<PreviewPage template={template} />);
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
  let communityCustomTemplates: CustomTemplateCard[] = [];
  let personalCustomTemplates: CustomTemplateCard[] = [];
  let atSiteLimit = false;
  if (auth.userId) {
    const database = db(c.env);
    const customerRow = await database
      .select({ id: customer.id, plan: customer.plan })
      .from(customer)
      .where(eq(customer.clerkUserId, auth.userId))
      .limit(1);
    const customerId = customerRow[0]?.id;
    const currentPlanId: BillingPlan = customerRow[0]?.plan ?? 'free';

    const whereClause = customerId
      ? or(eq(customTemplate.visibility, 'global'), eq(customTemplate.customerId, customerId))
      : eq(customTemplate.visibility, 'global');

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

    if (customerId) {
      const { siteLimit } = entitlementsFor(currentPlanId);
      if (!isUnlimited(siteLimit)) {
        const countRows = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(site)
          .where(eq(site.customerId, customerId));
        atSiteLimit = (countRows[0]?.count ?? 0) >= siteLimit;
      }
    }
  }

  return c.html(
    <Page
      communityCustomTemplates={communityCustomTemplates}
      personalCustomTemplates={personalCustomTemplates}
      atSiteLimit={atSiteLimit}
    />,
  );
});
