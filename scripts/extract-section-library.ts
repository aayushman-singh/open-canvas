// scripts/extract-section-library.ts
//
// ADR 0061 Phase C — one-shot extraction of every section from every
// TemplateSeed into individual `src/canvas/section-library/entries/*.json`
// files, plus a manifest barrel + an origin map.
//
// Idempotent — re-running overwrites the output files. The script is the
// generator; `entries/*.json`, `entries/manifest.ts`, and
// `src/canvas/section-library/origin-mapping.ts` are the committed
// artefacts that the runtime + Phase D's TemplateSeed rewrite consume.
//
// Run with `bun run scripts/extract-section-library.ts` after editing
// TemplateSeed content; regenerated output is what the registry serves.

import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  CanvasSection,
  EditableSite,
} from '../src/canvas/schema.js';
import type { AssetManifestEntry, SectionCategory } from '../src/db/schema.js';
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
  switch (section.recipeId) {
    case 'hero-split':
    case 'video-hero':
      return 'hero';
    case 'feature-grid':
      return 'features';
    case 'cta-band':
      return 'cta';
    case 'testimonial-row':
      return 'testimonials';
    case 'gallery-strip':
      return 'gallery';
    case 'logo-strip':
    case 'custom':
    default:
      return 'other';
  }
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

if (existsSync(ENTRIES_DIR)) {
  rmSync(ENTRIES_DIR, { recursive: true, force: true });
}
mkdirSync(ENTRIES_DIR, { recursive: true });

for (const entry of entries) {
  const file = join(ENTRIES_DIR, `${entry.baseSlug}.json`);
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}

// Manifest barrel: explicit imports keep the bundler happy and put the
// full registry on one navigable surface.
function manifestSource(entries: ExtractedEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.baseSlug.localeCompare(b.baseSlug));
  const importLines = sorted
    .map((e, i) => `import e${String(i)} from './${e.baseSlug}.json' with { type: 'json' };`)
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
writeFileSync(MANIFEST_FILE, manifestSource(entries), 'utf8');

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
