import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeTemplateMetadataSource, writeTemplateSectionSource } from './source-admin.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[source-admin:smoke] ${message}`);
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-canvas-template-source-'));
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

const changedEntry = JSON.parse(originalEntrySource) as Record<string, unknown>;
changedEntry.name = 'Hero edited from source admin';
changedEntry.headingPreview = 'Source admin edits reach code';

const sectionResult = await writeTemplateSectionSource(
  'starter-canvas',
  'starter-template-hero-v1',
  JSON.stringify(changedEntry),
  { repoRoot },
);
assert(
  sectionResult.filePath === entryPath,
  'section save must report the exact source JSON file path',
);

const rewrittenEntrySource = await readFile(entryPath, 'utf8');
assert(
  rewrittenEntrySource.includes('"name": "Hero edited from source admin"'),
  'section save must rewrite source JSON content',
);
assert(
  rewrittenEntrySource.endsWith('\n'),
  'section save must keep source JSON newline-terminated',
);

const beforeBadSlug = await readFile(entryPath, 'utf8');
const badSlugEntry = JSON.parse(beforeBadSlug) as Record<string, unknown>;
badSlugEntry.baseSlug = 'not-the-starter-hero';
let badSlugFailed = false;
try {
  await writeTemplateSectionSource(
    'starter-canvas',
    'starter-template-hero-v1',
    JSON.stringify(badSlugEntry),
    { repoRoot },
  );
} catch (error) {
  badSlugFailed = error instanceof Error && error.message.includes('baseSlug');
}
assert(badSlugFailed, 'section save must reject a baseSlug rewrite');
assert(
  (await readFile(entryPath, 'utf8')) === beforeBadSlug,
  'rejected section save must leave the source file unchanged',
);

let unrelatedSectionFailed = false;
try {
  await writeTemplateSectionSource(
    'starter-canvas',
    'raydotsh-template-hero-v1',
    originalEntrySource,
    { repoRoot },
  );
} catch (error) {
  unrelatedSectionFailed = error instanceof Error && error.message.includes('does not use section');
}
assert(
  unrelatedSectionFailed,
  'section save must reject edits for sections outside the selected template',
);

const registryPath = join(repoRoot, 'src', 'templates', 'registry.ts');
await writeFile(
  registryPath,
  [
    'interface TemplateSeed { id: string; name: string; tagline: string; }',
    'export const starterTemplate: TemplateSeed = {',
    "  id: 'starter-canvas',",
    "  name: 'Starter Canvas',",
    "  tagline: 'Old starter tagline',",
    '};',
    'export const otherTemplate: TemplateSeed = {',
    "  id: 'other-template',",
    "  name: 'Other Template',",
    "  tagline: 'Must stay put',",
    '};',
    '',
  ].join('\n'),
  'utf8',
);

await writeTemplateMetadataSource(
  'starter-canvas',
  {
    name: 'Source Admin Starter',
    tagline: 'Edited without creating a site',
  },
  { registryFile: registryPath },
);

const rewrittenRegistry = await readFile(registryPath, 'utf8');
assert(
  rewrittenRegistry.includes('name: "Source Admin Starter"'),
  'metadata save must rewrite the selected template name literal',
);
assert(
  rewrittenRegistry.includes('tagline: "Edited without creating a site"'),
  'metadata save must rewrite the selected template tagline literal',
);
assert(
  rewrittenRegistry.includes("name: 'Other Template'"),
  'metadata save must not rewrite unrelated templates',
);

console.log('[source-admin:smoke] OK');
