import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTemplateSourceAdminApp } from './source-admin-dashboard.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[source-admin-dashboard:smoke] ${message}`);
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-canvas-template-dashboard-'));
  await mkdir(join(root, 'src', 'canvas', 'section-library', 'entries'), { recursive: true });
  await mkdir(join(root, 'src', 'templates'), { recursive: true });
  return root;
}

const repoRoot = await tempRepo();
const entryPath = join(
  repoRoot,
  'src',
  'canvas',
  'section-library',
  'entries',
  'starter-template-hero.json',
);
const originalEntrySource = await readFile(
  join(process.cwd(), 'src', 'canvas', 'section-library', 'entries', 'starter-template-hero.json'),
  'utf8',
);
await writeFile(entryPath, originalEntrySource, 'utf8');

const app = createTemplateSourceAdminApp({ paths: { repoRoot } });

const home = await app.request('http://template-source-admin.local/');
assert(home.status === 200, 'dashboard page must render');
const homeHtml = await home.text();
assert(
  homeHtml.includes('data-template-source-admin'),
  'dashboard page must include the template source admin app hook',
);
assert(
  !homeHtml.includes('localhost:8787'),
  'dashboard preview links must not point at a separate localhost preview server',
);
assert(
  homeHtml.includes("previewLink.href = '/preview/' + encodeURIComponent"),
  'dashboard preview links must target the source-admin preview route',
);

const preview = await app.request(
  'http://template-source-admin.local/preview/enterprise-scale-canvas',
);
assert(preview.status === 200, 'source-admin app must render built-in template previews');
const previewHtml = await preview.text();
assert(
  previewHtml.includes('Enterprise Scale preview') &&
    previewHtml.includes('data-opencanvas-interactive-runtime'),
  'source-admin preview must render the built-in template HTML',
);

const catalog = await app.request('http://template-source-admin.local/api/templates');
assert(catalog.status === 200, 'catalog API must respond');
const catalogJson: {
  templates?: Array<{ id: string; sectionCount: number }>;
} = await catalog.json();
const starter = catalogJson.templates?.find((template) => template.id === 'starter-canvas');
assert(starter !== undefined, 'catalog API must include starter-canvas');
assert(starter.sectionCount > 0, 'catalog API must expose section counts');

const changedEntry = JSON.parse(originalEntrySource) as Record<string, unknown>;
changedEntry.name = 'Dashboard route edited hero';
const save = await app.request(
  'http://template-source-admin.local/api/templates/starter-canvas/sections/starter-template-hero-v1',
  {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: JSON.stringify(changedEntry) }),
  },
);
assert(save.status === 200, 'section save API must accept valid source JSON');
assert(
  (await readFile(entryPath, 'utf8')).includes('"name": "Dashboard route edited hero"'),
  'section save API must rewrite the source file',
);

const invalid = await app.request(
  'http://template-source-admin.local/api/templates/starter-canvas/sections/starter-template-hero-v1',
  {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: '{' }),
  },
);
assert(invalid.status === 400, 'section save API must reject invalid source JSON loudly');
const invalidJson: { error?: string } = await invalid.json();
assert(
  typeof invalidJson.error === 'string' && invalidJson.error.includes('not valid JSON'),
  'section save API must return the validation error',
);

console.log('[source-admin-dashboard:smoke] OK');
