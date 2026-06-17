// scripts/extract-section-library.ts
//
// LEGACY — ADR 0061 Phase C one-shot extraction from TemplateSeed
// `.state` blobs into `entries/*.json`, `entries/manifest.ts`, and
// `origin-mapping.ts`. Do not use this for composition-era templates.
//
// To add or refresh Section Library entries in the composition era,
// author `entries/*.json` directly and run `bun run section-library:sync`.
//
// Re-running this script overwrites auto-extracted JSON files and
// regenerates manifest + origin map from TemplateSeed state. It is kept
// for historical re-extraction only.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  CanvasSection,
  EditableSite,
} from '../src/canvas/schema.js';
import type { AssetManifestEntry, SectionCategory } from '../src/db/schema.js';
import { categoryForRecipe } from '../src/canvas/section-library/category.js';
import { allTemplateSeeds } from '../src/templates/registry.js';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRIES_DIR = join(ROOT, 'src/canvas/section-library/entries');
const MANIFEST_FILE = join(ENTRIES_DIR, 'manifest.ts');
const ORIGIN_MAP_FILE = join(ROOT, 'src/canvas/section-library/origin-mapping.ts');

interface ExtractedEntry {
  baseSlug: string;
  category: SectionCategory;
  name: string;
  description: string;
  recipeId: string;
  headingPreview: string;
  sectionData: CanvasSection;
  assetManifest: AssetManifestEntry[];
  originTemplateId: string | null;
}

interface OriginMapKey {
  templateId: string;
  sectionId: string;
}

interface OriginMapping {
  key: OriginMapKey;
  baseSlug: string;
}

// ---------------------------------------------------------------------------
// Template prefix table — drives the `{prefix}-template-...` slug.
//
// Derived from each TemplateSeed's id; documented as a const map rather than
// computed so the slug authority is explicit at PR review time.

const TEMPLATE_PREFIX: Record<string, string> = {
  'starter-canvas': 'starter',
  'launch-canvas': 'launch',
  'enterprise-scale-canvas': 'enterprise',
  'studio-canvas': 'studio',
  'local-canvas': 'local',
  'press-canvas': 'press',
  'violet-launch': 'violet',
  'apogee-showcase': 'apogee',
  'portfolio-showcase': 'portfolio',
};

// Per-template raw-section-id prefixes that get stripped before joining.
// Each template's fixture uses its own naming convention; this table is
// the single place that knows about them.
const SECTION_ID_PREFIXES: Record<string, string[]> = {
  'starter-canvas': ['section-'],
  'launch-canvas': ['section-'],
  'enterprise-scale-canvas': ['enterprise-'],
  'studio-canvas': ['section-'],
  'local-canvas': ['section-'],
  'press-canvas': ['section-'],
  'violet-launch': ['section-'],
  'apogee-showcase': ['wf-site-', 'wf-'],
  'portfolio-showcase': ['pf-site-', 'pf-'],
};

function stripKnownPrefixes(templateId: string, rawId: string): string {
  for (const prefix of SECTION_ID_PREFIXES[templateId] ?? []) {
    if (rawId.startsWith(prefix)) return rawId.slice(prefix.length);
  }
  return rawId;
}

function templatePrefix(templateId: string): string {
  const prefix = TEMPLATE_PREFIX[templateId];
  if (!prefix) throw new Error(`extract-section-library: template '${templateId}' missing from TEMPLATE_PREFIX`);
  return prefix;
}

// ---------------------------------------------------------------------------
// Category mapping per ADR 0061 Decision 8.
//
// Position-based: anything in `seed.state.header` is 'header', anything in
// `seed.state.footer` is 'footer' regardless of recipeId. Body sections
// map by recipeId.

type SectionPosition = 'header' | 'footer' | 'body';

function categoryFor(section: CanvasSection, position: SectionPosition): SectionCategory {
  if (position === 'header') return 'header';
  if (position === 'footer') return 'footer';
  return categoryForRecipe(section.recipeId);
}

// ---------------------------------------------------------------------------
// Heading preview — same logic as src/routes/api/library-sections.ts. Kept
// inline so the extraction script doesn't pull a route module into scope.

function firstHeadingPreview(section: CanvasSection): string {
  for (const element of section.elements) {
    if (element.type !== 'text') continue;
    if (element.role !== 'heading') continue;
    const plain = element.content.map((run) => run.text).join('');
    if (plain.trim().length === 0) continue;
    return plain.length > 80 ? `${plain.slice(0, 77)}…` : plain;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Per-template description: surfaced in the picker card body so an Owner
// browsing the pool sees where each section came from.

function describeOrigin(templateName: string, position: SectionPosition, section: CanvasSection): string {
  const where = position === 'header' ? 'header' : position === 'footer' ? 'footer' : 'body section';
  return `${templateName} ${where} — ${section.recipeId} recipe.`;
}

// ---------------------------------------------------------------------------
// Walk every TemplateSeed.

function* walkSections(seed: { id: string; name: string; state: EditableSite }): Generator<{
  section: CanvasSection;
  position: SectionPosition;
  pageSlug: string | null;
}> {
  if (seed.state.header) {
    yield { section: seed.state.header, position: 'header', pageSlug: null };
  }
  if (seed.state.footer) {
    yield { section: seed.state.footer, position: 'footer', pageSlug: null };
  }
  for (const page of seed.state.pages ?? []) {
    for (const section of page.sections) {
      yield { section, position: 'body', pageSlug: page.slug };
    }
  }
}

const entries: ExtractedEntry[] = [];
const originMap: OriginMapping[] = [];
const seenSlugs = new Set<string>();

for (const seed of allTemplateSeeds) {
  const prefix = templatePrefix(seed.id);
  for (const { section, position } of walkSections(seed)) {
    let suffix: string;
    if (position === 'header') {
      suffix = 'header';
    } else if (position === 'footer') {
      suffix = 'footer';
    } else {
      suffix = stripKnownPrefixes(seed.id, section.id);
    }
    const baseSlug = `${prefix}-template-${suffix}`;

    if (seenSlugs.has(baseSlug)) {
      throw new Error(
        `extract-section-library: duplicate baseSlug '${baseSlug}' from ${seed.id}:${section.id} — extend SECTION_ID_PREFIXES or rename the source section`,
      );
    }
    seenSlugs.add(baseSlug);

    const category = categoryFor(section, position);
    const headingPreview = firstHeadingPreview(section);
    const entry: ExtractedEntry = {
      baseSlug,
      category,
      name: section.name,
      description: describeOrigin(seed.name, position, section),
      recipeId: section.recipeId,
      headingPreview: headingPreview.length > 0 ? headingPreview : section.recipeId,
      sectionData: section,
      assetManifest: [],
      originTemplateId: seed.id,
    };
    entries.push(entry);
    originMap.push({ key: { templateId: seed.id, sectionId: section.id }, baseSlug });
  }
}

// ---------------------------------------------------------------------------
// Write outputs.
//
// Wipe is selective: anything NOT starting with `library-template-` is
// considered auto-extracted and gets cleared; standalone fixtures
// (`library-template-*`, e.g. the testimonial set from Phase F) survive.
// Stale auto-extracted files that no longer correspond to any current
// TemplateSeed section are removed; the manifest finally globs the
// directory to discover both auto and standalone entries.

if (existsSync(ENTRIES_DIR)) {
  for (const name of readdirSync(ENTRIES_DIR)) {
    if (!name.endsWith('.json')) continue;
    if (name.startsWith('library-template-')) continue;
    rmSync(join(ENTRIES_DIR, name), { force: true });
  }
} else {
  mkdirSync(ENTRIES_DIR, { recursive: true });
}

for (const entry of entries) {
  const file = join(ENTRIES_DIR, `${entry.baseSlug}.json`);
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}

// Discover the full entry set on disk (auto-extracted just-written +
// standalone library-template-*). The manifest enumerates this final
// state so adding a new standalone fixture is just "drop a JSON file in
// entries/" plus re-run.
interface ManifestEntryRef {
  baseSlug: string;
  filename: string;
}
function discoverEntries(): ManifestEntryRef[] {
  const refs: ManifestEntryRef[] = [];
  for (const name of readdirSync(ENTRIES_DIR)) {
    if (!name.endsWith('.json')) continue;
    const parsed = JSON.parse(readFileSync(join(ENTRIES_DIR, name), 'utf8')) as { baseSlug?: string };
    if (typeof parsed.baseSlug !== 'string' || parsed.baseSlug.length === 0) {
      throw new Error(`extract-section-library: entries/${name} is missing baseSlug`);
    }
    refs.push({ baseSlug: parsed.baseSlug, filename: name });
  }
  return refs;
}

// Manifest barrel: explicit imports keep the bundler happy and put the
// full registry on one navigable surface.
function manifestSource(refs: ManifestEntryRef[]): string {
  const sorted = [...refs].sort((a, b) => a.baseSlug.localeCompare(b.baseSlug));
  const importLines = sorted
    .map((e, i) => `import e${String(i)} from './${e.filename}' with { type: 'json' };`)
    .join('\n');
  const arrayLines = sorted.map((_, i) => `  e${String(i)} as SectionLibraryEntry,`).join('\n');
  return [
    '// src/canvas/section-library/entries/manifest.ts',
    '//',
    '// Auto-generated by `scripts/extract-section-library.ts`. Do not edit by',
    '// hand — re-run the script after editing TemplateSeed content or adding',
    '// a new entries/*.json file.',
    '',
    "import type { SectionLibraryEntry } from '../types.js';",
    '',
    importLines,
    '',
    'export const EXTRACTED_ENTRIES: ReadonlyArray<SectionLibraryEntry> = [',
    arrayLines,
    '];',
    '',
  ].join('\n');
}
writeFileSync(MANIFEST_FILE, manifestSource(discoverEntries()), 'utf8');

// Origin mapping module — Phase D's TemplateSeed rewrite uses this to
// resolve `(templateId, oldSectionId)` to the new `(baseSlug, version)`.
function originMappingSource(mappings: OriginMapping[]): string {
  const sorted = [...mappings].sort((a, b) =>
    `${a.key.templateId}:${a.key.sectionId}`.localeCompare(`${b.key.templateId}:${b.key.sectionId}`),
  );
  const lines = sorted
    .map((m) => `  '${m.key.templateId}:${m.key.sectionId}': '${m.baseSlug}',`)
    .join('\n');
  return [
    '// src/canvas/section-library/origin-mapping.ts',
    '//',
    '// ADR 0061 Phase C — bridge between the pre-migration `(templateId,',
    '// sectionId)` shape and the post-migration pool `baseSlug`. Auto-',
    '// generated by `scripts/extract-section-library.ts`.',
    '//',
    "// Phase D's TemplateSeed composition rewrite resolves each old",
    '// (templateId, sectionId) ref to its pool baseSlug via this table.',
    '// Phase G prunes references once the rewrite lands; the table itself',
    '// stays as a documented audit trail of which pool entry came from',
    '// which template/section pair.',
    '',
    'export const ORIGIN_TO_BASE_SLUG: Readonly<Record<string, string>> = {',
    lines,
    '};',
    '',
    'export function resolveBaseSlug(templateId: string, sectionId: string): string {',
    '  const key = `${templateId}:${sectionId}`;',
    '  const slug = ORIGIN_TO_BASE_SLUG[key];',
    '  if (slug === undefined) {',
    "    throw new Error(`origin-mapping: no pool entry for ${key} — re-run scripts/extract-section-library.ts`);",
    '  }',
    '  return slug;',
    '}',
    '',
  ].join('\n');
}
writeFileSync(ORIGIN_MAP_FILE, originMappingSource(originMap), 'utf8');

console.log(`extract-section-library: wrote ${String(entries.length)} entries to ${ENTRIES_DIR}`);
console.log(`extract-section-library: wrote manifest to ${MANIFEST_FILE}`);
console.log(`extract-section-library: wrote origin map to ${ORIGIN_MAP_FILE}`);
