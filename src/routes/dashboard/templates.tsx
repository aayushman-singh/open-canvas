import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { canvasPublishedStyles } from '../../canvas/public-styles';
import { renderCanvasSnapshot } from '../../canvas/render';
import { getSeedAsset } from '../../canvas/seed-assets';
import type { PublishedSnapshot } from '../../canvas/schema';
import { allTemplateSeeds, getTemplateSeed, type TemplateSeed } from '../../templates/registry';
import { SUBDOMAIN_RE } from '../api/sites';
import { DashboardShell } from './shell';

// The dashboard template preview iframe fetches seed assets through this
// route (NOT through the public R2 read path) so the preview works before
// the Owner has chosen a template. The seed bytes live as base64 text
// files under `src/assets/seed-source/`; we read them at module load and
// cache the decoded bytes so the preview asset serve is a pure-memory op.
const seedSourceDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'seed-source');
const seedBytesCache = new Map<string, Uint8Array>();
function readSeedBytes(sourcePath: string): Uint8Array {
  const cached = seedBytesCache.get(sourcePath);
  if (cached) return cached;
  const text = readFileSync(join(seedSourceDir, sourcePath), 'utf8').replace(/\s+/g, '');
  const binary = atob(text);
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
    height: 232px;
    border-bottom: 1px solid var(--line);
    background: #05070c;
  }
  .template-preview iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    pointer-events: none;
    background: #05070c;
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
  button {
    justify-self: start;
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: #05111a;
    padding: 12px 16px;
    font-weight: 700;
    cursor: pointer;
  }
  @media (max-width: 760px) {
    .templates { grid-template-columns: 1fr; }
    .fields { grid-template-columns: 1fr; }
    .subdomain { align-items: stretch; flex-direction: column; }
  }
`;

const previewStyles = `
  html,
  body {
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #05070c;
  }
  .rev01-preview-stage {
    width: 316.8px;
    min-height: 400px;
    margin: 0 auto;
    overflow: visible;
  }
  .rev01-preview-stage > .rev01-site {
    width: 1440px;
    transform: scale(0.22);
    transform-origin: top left;
  }
  .rev01-preview-stage .rev01-page {
    margin: 0;
  }
`;

function PreviewPage({ template }: { template: TemplateSeed }) {
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-05-22T00:00:00.000Z',
    styleKit: template.state.styleKit,
    pages: template.state.pages,
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
      <body>
        <div class="rev01-preview-stage">{raw(html)}</div>
      </body>
    </html>
  );
}

function Page() {
  const subdomainPattern = SUBDOMAIN_RE.source;
  return (
    <DashboardShell
      title="rev01 — create site"
      crumbs={[{ href: '/dashboard', label: 'Dashboard' }, { label: 'Create site' }]}
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
          <div class="templates">
            {allTemplateSeeds.map((template, idx) => (
              <label class="template">
                <input
                  type="radio"
                  name="templateId"
                  value={template.id}
                  required
                  checked={idx === 0}
                />
                <span class="template-body">
                  <span class="template-preview">
                    <iframe
                      src={`/dashboard/templates/${template.id}/preview`}
                      title={`${template.name} preview`}
                      loading="lazy"
                      sandbox=""
                      referrerpolicy="no-referrer"
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
          </div>
        </fieldset>

        <div class="fields">
          <label class="field">
            <span>Site name</span>
            <input type="text" name="siteName" maxlength={80} required placeholder="My site" />
          </label>

          <label class="field">
            <span>Subdomain</span>
            <span class="subdomain">
              <input
                type="text"
                name="subdomain"
                maxlength={63}
                required
                pattern={subdomainPattern}
                placeholder="my-site"
              />
              <span class="suffix">{PUBLISHED_SUFFIX}</span>
            </span>
            <small>Lowercase letters, numbers, and hyphens. 2 to 63 characters.</small>
          </label>
        </div>

        <button type="submit">Create site</button>
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

templatesRoute.get('/', (c) => c.html(<Page />));
