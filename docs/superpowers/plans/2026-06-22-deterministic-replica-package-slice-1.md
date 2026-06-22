# Deterministic Replica Package Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first deterministic Replica Source Package compiler slice with a tiny fixture that emits built-in Template Seed artifacts, import-ready file artifacts, and verification reports.

**Architecture:** Add a new `src/templates/replica-package/` module with a loader, asset compiler, target compiler, and verifier. The agent-facing input is JSON plus source assets under `src/templates/replicas/<replica-id>/`; generated TypeScript remains compiler output. Existing production template source admin files stay untouched.

**Tech Stack:** TypeScript, Bun scripts/smokes, existing `TemplateSeed`, `SectionLibraryEntry`, `EditableSite`, `validateEditableSite`, `validateSeedFixture`, `validatePublishedSnapshot`, `renderBuiltInTemplatePreviewBodyHtml`, seed asset base64 files.

## Global Constraints

- Template Seeds remain compositions of Section Library entries per ADR 0061.
- Site-level header and footer remain the only pinned slots per ADR 0059.
- Seed asset bytes remain base64 text under `src/assets/seed-source/` per ADR 0023.
- Unsupported source behaviour fails loudly through compile errors, validation errors, or explicit unsupported report rows.
- The compiler is deterministic: same package input produces the same output files, ids, and report.
- Target modes are explicit requested alternatives. They never silently replace a failing target.
- Do not modify `src/templates/source-admin*.ts`, `src/routes/dashboard/admin-template-source.tsx`, or `scripts/template-source-admin.ts`.
- No arbitrary source React, Vue, Svelte, CSS bundle, GSAP blob, or custom script becomes the replica answer.
- No owner-facing dashboard UI in Slice 1.

---

## File Map

- Create `src/templates/replica-package/types.ts`: exported package, ledger, unsupported finding, compile target, and report types.
- Create `src/templates/replica-package/load.ts`: reads a package folder and validates ids, page/section refs, asset refs, ledger rows, and unsupported findings.
- Create `src/templates/replica-package/load.smoke.ts`: red/green smoke for package loading and fail-loud malformed packages.
- Create `src/templates/replicas/tiny-replica/**`: tiny deterministic fixture package used by every Slice 1 smoke.
- Create `src/templates/replica-package/assets.ts`: compiles raw package assets into seed asset metadata and base64 bytes.
- Create `src/templates/replica-package/assets.smoke.ts`: verifies deterministic asset hashes, keys, and missing-file errors.
- Create `src/canvas/seed-assets.generated.ts`: generated seed asset registry companion.
- Modify `src/canvas/seed-assets.ts`: merge generated seed assets into `SEED_ASSET_REGISTRY`.
- Create `src/templates/generated/manifest.ts`: generated Template Seed manifest companion.
- Modify `src/templates/registry.ts`: append generated Template Seeds to `allTemplateSeeds`.
- Create `src/templates/replica-package/compiler.ts`: compiles `seed`, `import`, or `both` targets with atomic writes.
- Create `src/templates/replica-package/compiler.smoke.ts`: verifies emitted files and `both` target failure semantics.
- Create `src/templates/replica-package/verify.ts`: validates generated seed/import artifacts and writes deterministic reports.
- Create `src/templates/replica-package/verify.smoke.ts`: verifies report content and rendered evidence.
- Create `scripts/replica.ts`: CLI entrypoint for `bun run replica compile --source ... --target ...`.
- Modify `package.json`: add `replica` and `replica-package:smoke` scripts, then add the smoke to `ci:smoke`.

## Task 1: Replica Package Loader And Tiny Fixture

**Files:**
- Create: `src/templates/replica-package/types.ts`
- Create: `src/templates/replica-package/load.ts`
- Create: `src/templates/replica-package/load.smoke.ts`
- Create: `src/templates/replicas/tiny-replica/replica.json`
- Create: `src/templates/replicas/tiny-replica/pages/home.json`
- Create: `src/templates/replicas/tiny-replica/sections/tiny-replica-hero.json`
- Create: `src/templates/replicas/tiny-replica/assets/tiny-mark.svg`
- Create: `src/templates/replicas/tiny-replica/fidelity-ledger.json`
- Create: `src/templates/replicas/tiny-replica/unsupported.json`

**Interfaces:**
- Produces: `loadReplicaPackage(sourceDir: string): Promise<ReplicaSourcePackage>`
- Produces: `assertReplicaPackage(value: ReplicaSourcePackage): void`
- Consumes later: `ReplicaSourcePackage.metadata`, `.pages`, `.sections`, `.assets`, `.fidelityLedger`, `.unsupported`

- [ ] **Step 1: Write tiny fixture package files**

Create `src/templates/replicas/tiny-replica/replica.json`:

```json
{
  "id": "tiny-replica",
  "name": "Tiny Replica",
  "tagline": "A deterministic replica compiler fixture.",
  "source": {
    "kind": "url",
    "url": "https://example.test/tiny-replica"
  },
  "targets": ["seed", "import"],
  "styleKit": "charcoal",
  "pageOrder": ["home"],
  "requiredCopy": ["Tiny Replica", "Deterministic hero"],
  "requiredAssetIds": ["seed-tiny-replica-mark"],
  "forbiddenRuntimeTokens": ["React", "gsap", "ScrollTrigger"],
  "assets": [
    {
      "id": "seed-tiny-replica-mark",
      "sourcePath": "tiny-mark.svg",
      "mediaType": "image/svg+xml",
      "kind": "image",
      "width": 96,
      "height": 96,
      "alt": "Tiny replica geometric mark"
    }
  ]
}
```

Create `src/templates/replicas/tiny-replica/pages/home.json`:

```json
{
  "id": "page-tiny-replica-home",
  "slug": "home",
  "title": "Tiny Replica",
  "width": 1440,
  "sections": ["tiny-replica-hero"]
}
```

Create `src/templates/replicas/tiny-replica/assets/tiny-mark.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="#111827"/><circle cx="48" cy="48" r="28" fill="#38bdf8"/><path d="M28 54h40v8H28z" fill="#f8fafc"/></svg>
```

Create `src/templates/replicas/tiny-replica/sections/tiny-replica-hero.json`:

```json
{
  "baseSlug": "tiny-replica-hero",
  "category": "hero",
  "name": "Tiny Replica Hero",
  "description": "Tiny Replica hero section used by the deterministic replica compiler smoke.",
  "recipeId": "custom",
  "headingPreview": "Tiny Replica",
  "sectionData": {
    "id": "tiny-replica-hero",
    "recipeId": "custom",
    "name": "Tiny Replica Hero",
    "height": 520,
    "elements": [
      {
        "id": "tiny-replica-bg",
        "type": "container",
        "box": { "x": 0, "y": 0, "w": 1440, "h": 520, "z": 0 },
        "variant": "flat",
        "pinnedStyle": { "background": "#f8fafc" }
      },
      {
        "id": "tiny-replica-mark",
        "type": "media",
        "box": { "x": 104, "y": 108, "w": 96, "h": 96, "z": 2 },
        "mediaKind": "image",
        "assetId": "seed-tiny-replica-mark",
        "alt": "Tiny replica geometric mark",
        "fit": "contain"
      },
      {
        "id": "tiny-replica-heading",
        "type": "text",
        "box": { "x": 240, "y": 100, "w": 720, "h": 96, "z": 2 },
        "content": [{ "text": "Tiny Replica" }],
        "role": "heading",
        "fontSize": 64,
        "fontWeight": 700,
        "align": "left",
        "pinnedStyle": { "color": "#111827" }
      },
      {
        "id": "tiny-replica-body",
        "type": "text",
        "box": { "x": 240, "y": 212, "w": 620, "h": 72, "z": 2 },
        "content": [{ "text": "Deterministic hero emitted from a Replica Source Package." }],
        "role": "body",
        "fontSize": 22,
        "fontWeight": 400,
        "align": "left",
        "pinnedStyle": { "color": "#334155" }
      }
    ]
  },
  "assetManifest": [],
  "originTemplateId": "tiny-replica"
}
```

Create `src/templates/replicas/tiny-replica/fidelity-ledger.json`:

```json
[
  {
    "id": "hero-copy",
    "sourceBehaviour": "Hero heading, body copy, and source mark render as ordinary builder-native elements.",
    "status": "native",
    "primitive": "section-library",
    "evidence": ["Tiny Replica", "Deterministic hero", "seed-tiny-replica-mark"]
  },
  {
    "id": "custom-cursor",
    "sourceBehaviour": "Reference cursor trail is intentionally outside the tiny fixture output.",
    "status": "unsupported",
    "unsupportedId": "custom-cursor"
  }
]
```

Create `src/templates/replicas/tiny-replica/unsupported.json`:

```json
[
  {
    "id": "custom-cursor",
    "sourceBehaviour": "Reference cursor trail follows pointer movement.",
    "reason": "Tiny Replica fixture does not model pointer-reactive effects.",
    "requiredPrimitive": "Pointer-Reactive Effect"
  }
]
```

- [ ] **Step 2: Add loader types**

Create `src/templates/replica-package/types.ts`:

```ts
import type { EditableSite, StyleKit, StyleKitPreset } from '../../canvas/schema.js';
import type { SectionLibraryEntry } from '../../canvas/section-library/index.js';

export type ReplicaCompileTarget = 'seed' | 'import' | 'both';
export type ReplicaDeclaredTarget = Exclude<ReplicaCompileTarget, 'both'>;
export type ReplicaFidelityStatus = 'native' | 'unsupported' | 'omitted';

export interface ReplicaSourceRef {
  kind: 'url' | 'github';
  url?: string;
  repository?: string;
}

export interface ReplicaAssetSource {
  id: string;
  sourcePath: string;
  mediaType: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  alt: string;
}

export interface ReplicaMetadata {
  id: string;
  name: string;
  tagline: string;
  source: ReplicaSourceRef;
  targets: ReplicaDeclaredTarget[];
  styleKit: StyleKit;
  customStyleKit?: StyleKitPreset;
  pageOrder: string[];
  requiredCopy: string[];
  requiredAssetIds: string[];
  forbiddenRuntimeTokens: string[];
  assets: ReplicaAssetSource[];
}

export interface ReplicaPageSource {
  fileStem: string;
  id: string;
  slug: string;
  title: string;
  width: number;
  sections: string[];
  description?: string;
  pageBackground?: string;
  sectionGap?: number;
}

export interface ReplicaFidelityItem {
  id: string;
  sourceBehaviour: string;
  status: ReplicaFidelityStatus;
  primitive?: string;
  evidence?: string[];
  unsupportedId?: string;
}

export interface ReplicaUnsupportedFinding {
  id: string;
  sourceBehaviour: string;
  reason: string;
  requiredPrimitive: string;
}

export interface ReplicaSourcePackage {
  rootDir: string;
  metadata: ReplicaMetadata;
  pages: ReplicaPageSource[];
  sections: SectionLibraryEntry[];
  fidelityLedger: ReplicaFidelityItem[];
  unsupported: ReplicaUnsupportedFinding[];
}

export interface ReplicaCompileReport {
  replicaId: string;
  target: ReplicaCompileTarget;
  writtenFiles: string[];
  editableSite?: EditableSite;
  unsupported: ReplicaUnsupportedFinding[];
  fidelityLedger: ReplicaFidelityItem[];
}
```

- [ ] **Step 3: Write failing loader smoke**

Create `src/templates/replica-package/load.smoke.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadReplicaPackage } from './load.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-load:smoke] ${message}`);
}

const tiny = await loadReplicaPackage('src/templates/replicas/tiny-replica');
assert(tiny.metadata.id === 'tiny-replica', 'loader must read replica metadata id');
assert(tiny.pages.length === 1 && tiny.pages[0]?.slug === 'home', 'loader must read pages by pageOrder');
assert(tiny.sections.length === 1, 'loader must read one section');
assert(tiny.sections[0]?.baseSlug === 'tiny-replica-hero', 'loader must preserve section baseSlug');
assert(tiny.metadata.assets[0]?.id === 'seed-tiny-replica-mark', 'loader must read asset declarations');
assert(tiny.fidelityLedger.some((item) => item.status === 'native'), 'loader must read native fidelity row');
assert(tiny.unsupported[0]?.id === 'custom-cursor', 'loader must read unsupported findings');

const badRoot = await mkdtemp(join(tmpdir(), 'replica-bad-'));
await mkdir(join(badRoot, 'pages'), { recursive: true });
await mkdir(join(badRoot, 'sections'), { recursive: true });
await mkdir(join(badRoot, 'assets'), { recursive: true });
await writeFile(
  join(badRoot, 'replica.json'),
  JSON.stringify({
    id: 'Bad Id',
    name: 'Bad',
    tagline: 'Bad package',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home'],
    requiredCopy: [],
    requiredAssetIds: [],
    forbiddenRuntimeTokens: [],
    assets: []
  }),
  'utf8',
);
await writeFile(
  join(badRoot, 'pages', 'home.json'),
  JSON.stringify({ id: 'page-bad-home', slug: 'home', title: 'Bad', width: 1440, sections: ['missing-section'] }),
  'utf8',
);
await writeFile(join(badRoot, 'fidelity-ledger.json'), '[]', 'utf8');
await writeFile(join(badRoot, 'unsupported.json'), '[]', 'utf8');

let badFailed = false;
try {
  await loadReplicaPackage(badRoot);
} catch (error) {
  badFailed = error instanceof Error && error.message.includes('metadata.id');
}
assert(badFailed, 'loader must fail loudly on invalid replica id');

console.log('[replica-package-load:smoke] OK');
```

Run: `bun run src/templates/replica-package/load.smoke.ts`

Expected: FAIL with module not found for `./load.js`.

- [ ] **Step 4: Implement loader**

Create `src/templates/replica-package/load.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { SectionLibraryEntry } from '../../canvas/section-library/index.js';
import type {
  ReplicaFidelityItem,
  ReplicaMetadata,
  ReplicaPageSource,
  ReplicaSourcePackage,
  ReplicaUnsupportedFinding,
} from './types.js';

const ID_RE = /^[a-z][a-z0-9-]*$/;
const INSTANCE_ID_RE = /^[a-z][a-z0-9]*$/;

async function readJsonFile<T>(filePath: string): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (cause) {
    throw new Error(`replica-package: ${filePath} is not valid JSON`, { cause });
  }
  return parsed as T;
}

function assertObject(value: unknown, context: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`replica-package: ${context} must be a JSON object`);
  }
}

function assertString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`replica-package: ${context} must be a non-empty string`);
  }
  return value;
}

function assertStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`replica-package: ${context} must be an array of non-empty strings`);
  }
  return value;
}

function validateMetadata(value: unknown): ReplicaMetadata {
  assertObject(value, 'replica.json');
  const id = assertString(value.id, 'metadata.id');
  if (!ID_RE.test(id)) throw new Error(`replica-package: metadata.id "${id}" must match ${ID_RE.source}`);
  const targets = value.targets;
  if (!Array.isArray(targets) || targets.length === 0 || targets.some((target) => target !== 'seed' && target !== 'import')) {
    throw new Error('replica-package: metadata.targets must contain seed and/or import');
  }
  if (new Set(targets).size !== targets.length) {
    throw new Error('replica-package: metadata.targets must not contain duplicates');
  }
  const assets = value.assets;
  if (!Array.isArray(assets)) throw new Error('replica-package: metadata.assets must be an array');
  for (const asset of assets) {
    assertObject(asset, 'metadata.assets[]');
    const assetId = assertString(asset.id, 'asset.id');
    if (!assetId.startsWith('seed-')) throw new Error(`replica-package: asset id "${assetId}" must start with seed-`);
    assertString(asset.sourcePath, `${assetId}.sourcePath`);
    assertString(asset.mediaType, `${assetId}.mediaType`);
    if (asset.kind !== 'image' && asset.kind !== 'video') throw new Error(`replica-package: ${assetId}.kind must be image or video`);
    if (asset.width !== null && typeof asset.width !== 'number') throw new Error(`replica-package: ${assetId}.width must be number or null`);
    if (asset.height !== null && typeof asset.height !== 'number') throw new Error(`replica-package: ${assetId}.height must be number or null`);
    assertString(asset.alt, `${assetId}.alt`);
  }
  return {
    id,
    name: assertString(value.name, 'metadata.name'),
    tagline: assertString(value.tagline, 'metadata.tagline'),
    source: value.source as ReplicaMetadata['source'],
    targets: targets as ReplicaMetadata['targets'],
    styleKit: assertString(value.styleKit, 'metadata.styleKit') as ReplicaMetadata['styleKit'],
    ...(value.customStyleKit !== undefined ? { customStyleKit: value.customStyleKit as ReplicaMetadata['customStyleKit'] } : {}),
    pageOrder: assertStringArray(value.pageOrder, 'metadata.pageOrder'),
    requiredCopy: assertStringArray(value.requiredCopy, 'metadata.requiredCopy'),
    requiredAssetIds: assertStringArray(value.requiredAssetIds, 'metadata.requiredAssetIds'),
    forbiddenRuntimeTokens: assertStringArray(value.forbiddenRuntimeTokens, 'metadata.forbiddenRuntimeTokens'),
    assets: assets as ReplicaMetadata['assets'],
  };
}

function validatePage(value: unknown, fileStem: string): ReplicaPageSource {
  assertObject(value, `pages/${fileStem}.json`);
  const id = assertString(value.id, `pages/${fileStem}.id`);
  if (!ID_RE.test(id)) throw new Error(`replica-package: page id "${id}" must match ${ID_RE.source}`);
  const width = value.width;
  if (typeof width !== 'number' || width <= 0) throw new Error(`replica-package: page ${id}.width must be positive`);
  return {
    fileStem,
    id,
    slug: assertString(value.slug, `pages/${fileStem}.slug`),
    title: assertString(value.title, `pages/${fileStem}.title`),
    width,
    sections: assertStringArray(value.sections, `pages/${fileStem}.sections`),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.pageBackground === 'string' ? { pageBackground: value.pageBackground } : {}),
    ...(typeof value.sectionGap === 'number' ? { sectionGap: value.sectionGap } : {}),
  };
}

function validateSection(value: unknown, fileName: string): SectionLibraryEntry {
  assertObject(value, `sections/${fileName}`);
  const baseSlug = assertString(value.baseSlug, `sections/${fileName}.baseSlug`);
  if (!ID_RE.test(baseSlug)) throw new Error(`replica-package: section baseSlug "${baseSlug}" must match ${ID_RE.source}`);
  assertString(value.category, `${baseSlug}.category`);
  assertString(value.name, `${baseSlug}.name`);
  assertString(value.description, `${baseSlug}.description`);
  assertString(value.recipeId, `${baseSlug}.recipeId`);
  assertString(value.headingPreview, `${baseSlug}.headingPreview`);
  assertObject(value.sectionData, `${baseSlug}.sectionData`);
  if (!Array.isArray(value.assetManifest)) throw new Error(`replica-package: ${baseSlug}.assetManifest must be an array`);
  return value as unknown as SectionLibraryEntry;
}

function validateFidelity(value: unknown): ReplicaFidelityItem[] {
  if (!Array.isArray(value)) throw new Error('replica-package: fidelity-ledger.json must be an array');
  const seen = new Set<string>();
  for (const item of value) {
    assertObject(item, 'fidelity-ledger item');
    const id = assertString(item.id, 'fidelity item.id');
    if (seen.has(id)) throw new Error(`replica-package: duplicate fidelity id "${id}"`);
    seen.add(id);
    assertString(item.sourceBehaviour, `${id}.sourceBehaviour`);
    if (item.status !== 'native' && item.status !== 'unsupported' && item.status !== 'omitted') {
      throw new Error(`replica-package: ${id}.status must be native, unsupported, or omitted`);
    }
    if (item.status === 'native' && !Array.isArray(item.evidence)) {
      throw new Error(`replica-package: native fidelity item "${id}" must include evidence`);
    }
    if (item.status === 'unsupported' && typeof item.unsupportedId !== 'string') {
      throw new Error(`replica-package: unsupported fidelity item "${id}" must include unsupportedId`);
    }
  }
  return value as ReplicaFidelityItem[];
}

function validateUnsupported(value: unknown): ReplicaUnsupportedFinding[] {
  if (!Array.isArray(value)) throw new Error('replica-package: unsupported.json must be an array');
  const seen = new Set<string>();
  for (const item of value) {
    assertObject(item, 'unsupported item');
    const id = assertString(item.id, 'unsupported.id');
    if (seen.has(id)) throw new Error(`replica-package: duplicate unsupported id "${id}"`);
    seen.add(id);
    assertString(item.sourceBehaviour, `${id}.sourceBehaviour`);
    assertString(item.reason, `${id}.reason`);
    assertString(item.requiredPrimitive, `${id}.requiredPrimitive`);
  }
  return value as ReplicaUnsupportedFinding[];
}

export function assertReplicaPackage(pkg: ReplicaSourcePackage): void {
  const pageStems = new Set(pkg.pages.map((page) => page.fileStem));
  for (const pageStem of pkg.metadata.pageOrder) {
    if (!pageStems.has(pageStem)) throw new Error(`replica-package: pageOrder references missing page "${pageStem}"`);
  }
  const sectionSlugs = new Set(pkg.sections.map((section) => section.baseSlug));
  for (const page of pkg.pages) {
    for (const sectionSlug of page.sections) {
      if (!sectionSlugs.has(sectionSlug)) {
        throw new Error(`replica-package: page "${page.fileStem}" references missing section "${sectionSlug}"`);
      }
    }
  }
  const assetIds = new Set(pkg.metadata.assets.map((asset) => asset.id));
  for (const requiredAssetId of pkg.metadata.requiredAssetIds) {
    if (!assetIds.has(requiredAssetId)) {
      throw new Error(`replica-package: requiredAssetIds references missing asset "${requiredAssetId}"`);
    }
  }
  const unsupportedIds = new Set(pkg.unsupported.map((item) => item.id));
  for (const item of pkg.fidelityLedger) {
    if (item.status === 'unsupported' && !unsupportedIds.has(item.unsupportedId!)) {
      throw new Error(`replica-package: fidelity item "${item.id}" references missing unsupported finding "${item.unsupportedId}"`);
    }
  }
  for (const page of pkg.pages) {
    const instance = page.sections.map((sectionSlug) => sectionSlug.replace(/[^a-z0-9]/g, ''));
    for (const instanceId of instance) {
      if (!INSTANCE_ID_RE.test(instanceId)) throw new Error(`replica-package: section instance id "${instanceId}" cannot be generated safely`);
    }
  }
}

async function readPages(rootDir: string, metadata: ReplicaMetadata): Promise<ReplicaPageSource[]> {
  const pagesByStem = new Map<string, ReplicaPageSource>();
  const pagesDir = join(rootDir, 'pages');
  for (const name of await readdir(pagesDir)) {
    if (!name.endsWith('.json')) continue;
    const fileStem = basename(name, '.json');
    pagesByStem.set(fileStem, validatePage(await readJsonFile(join(pagesDir, name)), fileStem));
  }
  return metadata.pageOrder.map((fileStem) => {
    const page = pagesByStem.get(fileStem);
    if (!page) throw new Error(`replica-package: missing pages/${fileStem}.json`);
    return page;
  });
}

async function readSections(rootDir: string): Promise<SectionLibraryEntry[]> {
  const sections: SectionLibraryEntry[] = [];
  const sectionsDir = join(rootDir, 'sections');
  for (const name of await readdir(sectionsDir)) {
    if (!name.endsWith('.json')) continue;
    sections.push(validateSection(await readJsonFile(join(sectionsDir, name)), name));
  }
  sections.sort((a, b) => a.baseSlug.localeCompare(b.baseSlug));
  return sections;
}

export async function loadReplicaPackage(sourceDir: string): Promise<ReplicaSourcePackage> {
  const metadata = validateMetadata(await readJsonFile(join(sourceDir, 'replica.json')));
  const pkg: ReplicaSourcePackage = {
    rootDir: sourceDir,
    metadata,
    pages: await readPages(sourceDir, metadata),
    sections: await readSections(sourceDir),
    fidelityLedger: validateFidelity(await readJsonFile(join(sourceDir, 'fidelity-ledger.json'))),
    unsupported: validateUnsupported(await readJsonFile(join(sourceDir, 'unsupported.json'))),
  };
  assertReplicaPackage(pkg);
  return pkg;
}
```

- [ ] **Step 5: Run loader smoke**

Run: `bun run src/templates/replica-package/load.smoke.ts`

Expected: PASS with `[replica-package-load:smoke] OK`.

- [ ] **Step 6: Commit loader task**

```bash
git add src/templates/replica-package/types.ts src/templates/replica-package/load.ts src/templates/replica-package/load.smoke.ts src/templates/replicas/tiny-replica
git commit -m "feat: add replica package loader"
```

## Task 2: Seed Asset Compiler And Generated Registry Hook

**Files:**
- Create: `src/templates/replica-package/assets.ts`
- Create: `src/templates/replica-package/assets.smoke.ts`
- Create: `src/canvas/seed-assets.generated.ts`
- Modify: `src/canvas/seed-assets.ts`

**Interfaces:**
- Consumes: `ReplicaSourcePackage`
- Produces: `compileReplicaSeedAssets(pkg: ReplicaSourcePackage): Promise<CompiledReplicaSeedAsset[]>`
- Produces: `renderGeneratedSeedAssetRegistry(assets: CompiledReplicaSeedAsset[]): string`
- Later tasks write the rendered registry to `src/canvas/seed-assets.generated.ts`

- [ ] **Step 1: Write failing asset smoke**

Create `src/templates/replica-package/assets.smoke.ts`:

```ts
import { compileReplicaSeedAssets, renderGeneratedSeedAssetRegistry } from './assets.js';
import { loadReplicaPackage } from './load.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-assets:smoke] ${message}`);
}

const pkg = await loadReplicaPackage('src/templates/replicas/tiny-replica');
const assets = await compileReplicaSeedAssets(pkg);
assert(assets.length === 1, 'tiny package must compile exactly one asset');
const asset = assets[0]!;
assert(asset.seedId === 'seed-tiny-replica-mark', 'compiled asset must preserve seed id');
assert(asset.registry.sourcePath === 'tiny-replica-mark.svg.b64', 'compiled asset sourcePath must be deterministic');
assert(asset.registry.mediaType === 'image/svg+xml', 'compiled asset must preserve mediaType');
assert(asset.registry.byteSize > 100, 'compiled asset must record byte size');
assert(asset.base64.length > asset.registry.byteSize, 'compiled asset must carry base64 bytes');
assert(asset.registry.r2Key.endsWith('.svg'), 'compiled asset r2Key must use media extension');

const registrySource = renderGeneratedSeedAssetRegistry(assets);
assert(
  registrySource.includes('GENERATED_SEED_ASSET_REGISTRY') &&
    registrySource.includes('seed-tiny-replica-mark') &&
    registrySource.includes(asset.registry.contentHash),
  'generated registry source must include registry object and asset hash',
);

const missing = structuredClone(pkg);
missing.metadata.assets[0] = { ...missing.metadata.assets[0]!, sourcePath: 'missing.svg' };
let missingFailed = false;
try {
  await compileReplicaSeedAssets(missing);
} catch (error) {
  missingFailed = error instanceof Error && error.message.includes('missing.svg');
}
assert(missingFailed, 'asset compiler must fail loudly when source bytes are missing');

console.log('[replica-package-assets:smoke] OK');
```

Run: `bun run src/templates/replica-package/assets.smoke.ts`

Expected: FAIL with module not found for `./assets.js`.

- [ ] **Step 2: Add generated seed asset registry file**

Create `src/canvas/seed-assets.generated.ts`:

```ts
import type { SeedAsset } from './seed-assets.js';

export const GENERATED_SEED_ASSET_REGISTRY: Record<string, SeedAsset> = {};
```

- [ ] **Step 3: Modify seed asset registry hook**

In `src/canvas/seed-assets.ts`, add this import near the top after the file comment:

```ts
import { GENERATED_SEED_ASSET_REGISTRY } from './seed-assets.generated.js';
```

Change the registry closing from:

```ts
export const SEED_ASSET_REGISTRY: Record<string, SeedAsset> = {
  // existing entries...
};
```

to keep all existing entries and append the generated registry before the closing `};`:

```ts
  ...GENERATED_SEED_ASSET_REGISTRY,
};
```

Do not change any existing seed asset ids or metadata.

- [ ] **Step 4: Implement asset compiler**

Create `src/templates/replica-package/assets.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { contentHashToR2Key, extFromMediaType, sha256Hex } from '../../assets/hash.js';
import type { SeedAsset } from '../../canvas/seed-assets.js';
import type { ReplicaAssetSource, ReplicaSourcePackage } from './types.js';

export interface CompiledReplicaSeedAsset {
  seedId: string;
  sourceAsset: ReplicaAssetSource;
  registry: SeedAsset;
  base64SourcePath: string;
  base64: string;
}

function generatedSourcePath(seedId: string, mediaType: string): string {
  const ext = extFromMediaType(mediaType);
  const stem = seedId.startsWith('seed-') ? seedId.slice('seed-'.length) : seedId;
  return `${stem}.${ext}.b64`;
}

export async function compileReplicaSeedAssets(
  pkg: ReplicaSourcePackage,
): Promise<CompiledReplicaSeedAsset[]> {
  const compiled: CompiledReplicaSeedAsset[] = [];
  for (const sourceAsset of pkg.metadata.assets) {
    const rawPath = join(pkg.rootDir, 'assets', sourceAsset.sourcePath);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(rawPath);
    } catch (cause) {
      throw new Error(`replica-assets: missing asset bytes ${sourceAsset.sourcePath}`, { cause });
    }
    const contentHash = await sha256Hex(bytes);
    const r2Key = contentHashToR2Key(contentHash, extFromMediaType(sourceAsset.mediaType));
    const sourcePath = generatedSourcePath(sourceAsset.id, sourceAsset.mediaType);
    compiled.push({
      seedId: sourceAsset.id,
      sourceAsset,
      base64SourcePath: sourcePath,
      base64: Buffer.from(bytes).toString('base64'),
      registry: {
        contentHash,
        r2Key,
        mediaType: sourceAsset.mediaType,
        kind: sourceAsset.kind,
        width: sourceAsset.width,
        height: sourceAsset.height,
        byteSize: bytes.byteLength,
        sourcePath,
        alt: sourceAsset.alt,
      },
    });
  }
  compiled.sort((a, b) => a.seedId.localeCompare(b.seedId));
  return compiled;
}

export function renderGeneratedSeedAssetRegistry(assets: CompiledReplicaSeedAsset[]): string {
  const lines: string[] = [];
  lines.push("import type { SeedAsset } from './seed-assets.js';");
  lines.push('');
  lines.push('// Generated by `bun run replica compile`. Do not edit by hand.');
  lines.push('export const GENERATED_SEED_ASSET_REGISTRY: Record<string, SeedAsset> = {');
  for (const asset of assets) {
    lines.push(`  ${JSON.stringify(asset.seedId)}: ${JSON.stringify(asset.registry, null, 2).replace(/\n/g, '\n  ')},`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 5: Run asset smoke and seed asset verifier**

Run:

```bash
bun run src/templates/replica-package/assets.smoke.ts
bun run seed:assets
```

Expected:

- First command PASS with `[replica-package-assets:smoke] OK`.
- Second command PASS and existing seed count unchanged because generated registry is still empty.

- [ ] **Step 6: Commit asset task**

```bash
git add src/templates/replica-package/assets.ts src/templates/replica-package/assets.smoke.ts src/canvas/seed-assets.generated.ts src/canvas/seed-assets.ts
git commit -m "feat: add replica seed asset compiler"
```

## Task 3: Seed And Import Target Compiler

**Files:**
- Create: `src/templates/generated/manifest.ts`
- Create: `src/templates/replica-package/compiler.ts`
- Create: `src/templates/replica-package/compiler.smoke.ts`
- Modify: `src/templates/registry.ts`

**Interfaces:**
- Consumes: `loadReplicaPackage`, `compileReplicaSeedAssets`
- Produces: `compileReplicaPackage(input: CompileReplicaPackageInput): Promise<ReplicaCompileReport>`
- Produces seed files: Section Library entries, base64 asset files, generated asset registry, generated template file, generated template manifest, generated smoke file
- Produces import files: `tmp/replicas/<id>/editable-site.json`, `asset-manifest.json`, `report.json`

- [ ] **Step 1: Create empty generated template manifest**

Create `src/templates/generated/manifest.ts`:

```ts
import type { TemplateSeed } from '../registry.js';

// Generated by `bun run replica compile`. Do not edit by hand.
export const generatedTemplateSeeds: ReadonlyArray<TemplateSeed> = [];
```

- [ ] **Step 2: Hook generated templates into registry**

In `src/templates/registry.ts`, add:

```ts
import { generatedTemplateSeeds } from './generated/manifest.js';
```

Then append generated templates at the end of `allTemplateSeeds`:

```ts
  velocityAthleteTemplate,
  ...generatedTemplateSeeds,
];
```

Do not reorder existing hand-authored templates.

- [ ] **Step 3: Write failing compiler smoke**

Create `src/templates/replica-package/compiler.smoke.ts`:

```ts
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileReplicaPackage } from './compiler.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-compiler:smoke] ${message}`);
}

const repoRoot = await mkdtemp(join(tmpdir(), 'replica-compile-'));
await mkdir(join(repoRoot, 'src', 'canvas', 'section-library', 'entries'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'assets', 'seed-source'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'canvas'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'templates', 'generated'), { recursive: true });
await mkdir(join(repoRoot, 'src', 'templates'), { recursive: true });

const result = await compileReplicaPackage({
  sourceDir: 'src/templates/replicas/tiny-replica',
  target: 'both',
  repoRoot,
  importOutDir: join(repoRoot, 'tmp', 'replicas'),
});

assert(result.replicaId === 'tiny-replica', 'compile result must preserve replica id');
assert(result.target === 'both', 'compile result must preserve requested target');
assert(
  result.writtenFiles.some((file) => file.endsWith('src/templates/generated/tiny-replica.ts')),
  'seed target must write generated template file',
);
assert(
  result.writtenFiles.some((file) => file.endsWith('tmp/replicas/tiny-replica/editable-site.json')),
  'import target must write editable-site.json',
);

const generatedTemplate = await readFile(join(repoRoot, 'src', 'templates', 'generated', 'tiny-replica.ts'), 'utf8');
assert(
  generatedTemplate.includes('id: "tiny-replica"') &&
    generatedTemplate.includes('sectionId: "tiny-replica-hero-v1"'),
  'generated template must contain deterministic template and section refs',
);

const generatedRegistry = await readFile(join(repoRoot, 'src', 'canvas', 'seed-assets.generated.ts'), 'utf8');
assert(
  generatedRegistry.includes('seed-tiny-replica-mark') &&
    generatedRegistry.includes('tiny-replica-mark.svg.b64'),
  'generated seed asset registry must include tiny asset',
);

const editableSite = JSON.parse(await readFile(join(repoRoot, 'tmp', 'replicas', 'tiny-replica', 'editable-site.json'), 'utf8')) as {
  pages?: { sections?: { elements?: { id?: string }[] }[] }[];
};
assert(
  editableSite.pages?.[0]?.sections?.[0]?.elements?.some((element) => element.id === 'tiny-replica-heading'),
  'import target must materialize package sections into editable-site.json',
);

let invalidTargetFailed = false;
try {
  await compileReplicaPackage({
    sourceDir: 'src/templates/replicas/tiny-replica',
    target: 'preview' as never,
    repoRoot,
    importOutDir: join(repoRoot, 'tmp', 'replicas'),
  });
} catch (error) {
  invalidTargetFailed =
    error instanceof Error && error.message.includes('unsupported target preview');
}
assert(invalidTargetFailed, 'compiler must fail loudly on unsupported target');

console.log('[replica-package-compiler:smoke] OK');
```

Run: `bun run src/templates/replica-package/compiler.smoke.ts`

Expected: FAIL with module not found for `./compiler.js`.

- [ ] **Step 4: Implement compiler**

Create `src/templates/replica-package/compiler.ts`:

```ts
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { EditableSite, PublishedSnapshot } from '../../canvas/schema.js';
import { validateEditableSite, validatePublishedSnapshot } from '../../canvas/validate.js';
import { compileReplicaSeedAssets, renderGeneratedSeedAssetRegistry } from './assets.js';
import { loadReplicaPackage } from './load.js';
import type {
  ReplicaCompileReport,
  ReplicaCompileTarget,
  ReplicaPageSource,
  ReplicaSourcePackage,
} from './types.js';

export interface CompileReplicaPackageInput {
  sourceDir: string;
  target: ReplicaCompileTarget;
  repoRoot?: string;
  importOutDir?: string;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function instanceIdFor(baseSlug: string): string {
  const id = baseSlug.replace(/[^a-z0-9]/g, '');
  if (id.length === 0) throw new Error(`replica-compiler: cannot derive instance id for ${baseSlug}`);
  return id;
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  await rename(tmpPath, filePath);
}

function renderTemplateSource(pkg: ReplicaSourcePackage): string {
  const lines: string[] = [];
  const exportName = `${pkg.metadata.id.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())}Template`;
  lines.push("import type { TemplateSeed } from '../registry.js';");
  lines.push('');
  lines.push('// Generated by `bun run replica compile`. Do not edit by hand.');
  lines.push(`export const ${exportName}: TemplateSeed = {`);
  lines.push(`  id: ${quote(pkg.metadata.id)},`);
  lines.push(`  name: ${quote(pkg.metadata.name)},`);
  lines.push(`  tagline: ${quote(pkg.metadata.tagline)},`);
  lines.push(`  styleKit: ${quote(pkg.metadata.styleKit)},`);
  lines.push('  pages: [');
  for (const page of pkg.pages) {
    lines.push('    {');
    lines.push(`      id: ${quote(page.id)},`);
    lines.push(`      slug: ${quote(page.slug)},`);
    lines.push(`      title: ${quote(page.title)},`);
    lines.push(`      width: ${String(page.width)},`);
    if (page.description !== undefined) lines.push(`      description: ${quote(page.description)},`);
    if (page.pageBackground !== undefined) lines.push(`      pageBackground: ${quote(page.pageBackground)},`);
    if (page.sectionGap !== undefined) lines.push(`      sectionGap: ${String(page.sectionGap)},`);
    lines.push('      bodyRefs: [');
    for (const sectionSlug of page.sections) {
      lines.push(`        { sectionId: ${quote(`${sectionSlug}-v1`)}, instanceId: ${quote(instanceIdFor(sectionSlug))} },`);
    }
    lines.push('      ],');
    lines.push('    },');
  }
  lines.push('  ],');
  lines.push('};');
  lines.push('');
  lines.push(`export const generatedTemplateSeeds: ReadonlyArray<TemplateSeed> = [${exportName}];`);
  lines.push('');
  return lines.join('\n');
}

function renderGeneratedTemplateManifest(pkg: ReplicaSourcePackage): string {
  const moduleName = pkg.metadata.id;
  return [
    "import type { TemplateSeed } from '../registry.js';",
    `import { generatedTemplateSeeds as ${moduleName.replace(/-/g, '_')}Templates } from './${moduleName}.js';`,
    '',
    '// Generated by `bun run replica compile`. Do not edit by hand.',
    `export const generatedTemplateSeeds: ReadonlyArray<TemplateSeed> = [...${moduleName.replace(/-/g, '_')}Templates];`,
    '',
  ].join('\n');
}

function materializePage(pkg: ReplicaSourcePackage, page: ReplicaPageSource): EditableSite['pages'][number] {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    width: page.width,
    ...(page.description !== undefined ? { description: page.description } : {}),
    ...(page.pageBackground !== undefined ? { pageBackground: page.pageBackground } : {}),
    ...(page.sectionGap !== undefined ? { sectionGap: page.sectionGap } : {}),
    sections: page.sections.map((sectionSlug) => {
      const entry = pkg.sections.find((section) => section.baseSlug === sectionSlug);
      if (!entry) throw new Error(`replica-compiler: missing section ${sectionSlug}`);
      const section = structuredClone(entry.sectionData);
      section.instanceScope = instanceIdFor(sectionSlug);
      return section;
    }),
  };
}

export function materializeReplicaEditableSite(pkg: ReplicaSourcePackage): EditableSite {
  const site: EditableSite = {
    styleKit: pkg.metadata.styleKit,
    ...(pkg.metadata.customStyleKit !== undefined ? { customStyleKit: pkg.metadata.customStyleKit } : {}),
    pages: pkg.pages.map((page) => materializePage(pkg, page)),
  };
  const validation = validateEditableSite(site);
  if (!validation.valid) {
    throw new Error(`replica-compiler: import target produced invalid EditableSite:\n  ${validation.errors.join('\n  ')}`);
  }
  const snapshot: PublishedSnapshot = { ...site, version: 1, publishedAt: '2026-06-22T00:00:00.000Z' };
  const publishValidation = validatePublishedSnapshot(snapshot);
  if (!publishValidation.valid) {
    throw new Error(`replica-compiler: import target produced invalid PublishedSnapshot:\n  ${publishValidation.errors.join('\n  ')}`);
  }
  return site;
}

async function compileSeedTarget(pkg: ReplicaSourcePackage, repoRoot: string): Promise<string[]> {
  const written: string[] = [];
  const assets = await compileReplicaSeedAssets(pkg);
  for (const section of pkg.sections) {
    const path = join(repoRoot, 'src', 'canvas', 'section-library', 'entries', `${section.baseSlug}.json`);
    await writeFileAtomic(path, `${JSON.stringify(section, null, 2)}\n`);
    written.push(path);
  }
  for (const asset of assets) {
    const path = join(repoRoot, 'src', 'assets', 'seed-source', asset.base64SourcePath);
    await writeFileAtomic(path, `${asset.base64}\n`);
    written.push(path);
  }
  const seedRegistryPath = join(repoRoot, 'src', 'canvas', 'seed-assets.generated.ts');
  await writeFileAtomic(seedRegistryPath, renderGeneratedSeedAssetRegistry(assets));
  written.push(seedRegistryPath);
  const templatePath = join(repoRoot, 'src', 'templates', 'generated', `${pkg.metadata.id}.ts`);
  await writeFileAtomic(templatePath, renderTemplateSource(pkg));
  written.push(templatePath);
  const manifestPath = join(repoRoot, 'src', 'templates', 'generated', 'manifest.ts');
  await writeFileAtomic(manifestPath, renderGeneratedTemplateManifest(pkg));
  written.push(manifestPath);
  return written;
}

async function compileImportTarget(pkg: ReplicaSourcePackage, importOutDir: string): Promise<{ written: string[]; site: EditableSite }> {
  const site = materializeReplicaEditableSite(pkg);
  const assets = await compileReplicaSeedAssets(pkg);
  const outDir = join(importOutDir, pkg.metadata.id);
  const written: string[] = [];
  const sitePath = join(outDir, 'editable-site.json');
  await writeFileAtomic(sitePath, `${JSON.stringify(site, null, 2)}\n`);
  written.push(sitePath);
  const manifestPath = join(outDir, 'asset-manifest.json');
  await writeFileAtomic(
    manifestPath,
    `${JSON.stringify(assets.map((asset) => ({ assetId: asset.seedId, ...asset.registry })), null, 2)}\n`,
  );
  written.push(manifestPath);
  return { written, site };
}

export async function compileReplicaPackage(
  input: CompileReplicaPackageInput,
): Promise<ReplicaCompileReport> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const importOutDir = input.importOutDir ?? join(repoRoot, 'tmp', 'replicas');
  const pkg = await loadReplicaPackage(input.sourceDir);
  const target = input.target;
  if (target !== 'seed' && target !== 'import' && target !== 'both') {
    throw new Error(`replica-compiler: unsupported target ${String(target)}`);
  }
  const writtenFiles: string[] = [];
  let editableSite: EditableSite | undefined;
  if (target === 'seed' || target === 'both') {
    writtenFiles.push(...(await compileSeedTarget(pkg, repoRoot)));
  }
  if (target === 'import' || target === 'both') {
    const result = await compileImportTarget(pkg, importOutDir);
    writtenFiles.push(...result.written);
    editableSite = result.site;
  }
  const report: ReplicaCompileReport = {
    replicaId: pkg.metadata.id,
    target,
    writtenFiles,
    ...(editableSite !== undefined ? { editableSite } : {}),
    unsupported: pkg.unsupported,
    fidelityLedger: pkg.fidelityLedger,
  };
  if (target === 'import' || target === 'both') {
    const reportPath = join(importOutDir, pkg.metadata.id, 'report.json');
    await writeFileAtomic(reportPath, `${JSON.stringify({ ...report, editableSite: undefined }, null, 2)}\n`);
    report.writtenFiles.push(reportPath);
  }
  return report;
}
```

- [ ] **Step 5: Run compiler smoke**

Run:

```bash
bun run src/templates/replica-package/compiler.smoke.ts
bun run typecheck
```

Expected:

- Compiler smoke PASS with `[replica-package-compiler:smoke] OK`.
- Typecheck PASS.

- [ ] **Step 6: Commit compiler task**

```bash
git add src/templates/generated/manifest.ts src/templates/replica-package/compiler.ts src/templates/replica-package/compiler.smoke.ts src/templates/registry.ts
git commit -m "feat: compile replica package targets"
```

## Task 4: Verifier And Generated Smoke Source

**Files:**
- Create: `src/templates/replica-package/verify.ts`
- Create: `src/templates/replica-package/verify.smoke.ts`
- Modify: `src/templates/replica-package/compiler.ts`

**Interfaces:**
- Consumes: `ReplicaCompileReport`, `loadReplicaPackage`
- Produces: `verifyReplicaOutputs(input: VerifyReplicaOutputsInput): Promise<void>`
- Compiler now emits `src/templates/<replica-id>.replica.smoke.ts` for seed target.

- [ ] **Step 1: Write failing verifier smoke**

Create `src/templates/replica-package/verify.smoke.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileReplicaPackage } from './compiler.js';
import { verifyReplicaOutputs } from './verify.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-verify:smoke] ${message}`);
}

const repoRoot = await mkdtemp(join(tmpdir(), 'replica-verify-'));
const result = await compileReplicaPackage({
  sourceDir: 'src/templates/replicas/tiny-replica',
  target: 'both',
  repoRoot,
  importOutDir: join(repoRoot, 'tmp', 'replicas'),
});

await verifyReplicaOutputs({
  sourceDir: 'src/templates/replicas/tiny-replica',
  compileReport: result,
  importOutDir: join(repoRoot, 'tmp', 'replicas'),
});

const generatedSmokePath = join(repoRoot, 'src', 'templates', 'tiny-replica.replica.smoke.ts');
const generatedSmoke = await readFile(generatedSmokePath, 'utf8');
assert(
  generatedSmoke.includes("getTemplateSeed('tiny-replica')") &&
    generatedSmoke.includes('seed-tiny-replica-mark') &&
    generatedSmoke.includes('custom-cursor'),
  'compiler must generate seed replica smoke with registration, asset, and unsupported checks',
);

const report = JSON.parse(await readFile(join(repoRoot, 'tmp', 'replicas', 'tiny-replica', 'report.json'), 'utf8')) as {
  unsupported?: { id?: string }[];
  fidelityLedger?: { id?: string }[];
};
assert(report.unsupported?.some((item) => item.id === 'custom-cursor'), 'report must include unsupported finding');
assert(report.fidelityLedger?.some((item) => item.id === 'hero-copy'), 'report must include fidelity ledger');

console.log('[replica-package-verify:smoke] OK');
```

Run: `bun run src/templates/replica-package/verify.smoke.ts`

Expected: FAIL with module not found for `./verify.js`.

- [ ] **Step 2: Implement verifier**

Create `src/templates/replica-package/verify.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadReplicaPackage } from './load.js';
import type { ReplicaCompileReport } from './types.js';

export interface VerifyReplicaOutputsInput {
  sourceDir: string;
  compileReport: ReplicaCompileReport;
  importOutDir: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`replica-verify: ${message}`);
}

export async function verifyReplicaOutputs(input: VerifyReplicaOutputsInput): Promise<void> {
  const pkg = await loadReplicaPackage(input.sourceDir);
  const report = input.compileReport;
  assert(report.replicaId === pkg.metadata.id, 'compile report replica id mismatch');
  for (const item of pkg.fidelityLedger) {
    if (item.status === 'native') {
      assert(Array.isArray(item.evidence) && item.evidence.length > 0, `native fidelity item ${item.id} must include evidence`);
    }
    if (item.status === 'unsupported') {
      assert(
        pkg.unsupported.some((finding) => finding.id === item.unsupportedId),
        `unsupported fidelity item ${item.id} must reference unsupported finding`,
      );
    }
  }
  if (report.target === 'import' || report.target === 'both') {
    const reportPath = join(input.importOutDir, pkg.metadata.id, 'report.json');
    const parsed = JSON.parse(await readFile(reportPath, 'utf8')) as ReplicaCompileReport;
    assert(parsed.replicaId === pkg.metadata.id, 'report.json replica id mismatch');
    assert(parsed.unsupported.length === pkg.unsupported.length, 'report.json unsupported finding count mismatch');
    assert(parsed.fidelityLedger.length === pkg.fidelityLedger.length, 'report.json fidelity ledger count mismatch');
  }
}
```

- [ ] **Step 3: Add generated smoke source renderer**

In `src/templates/replica-package/compiler.ts`, add this helper:

```ts
function renderGeneratedSmokeSource(pkg: ReplicaSourcePackage): string {
  const requiredCopy = JSON.stringify(pkg.metadata.requiredCopy, null, 2);
  const requiredAssetIds = JSON.stringify(pkg.metadata.requiredAssetIds, null, 2);
  const forbidden = JSON.stringify(pkg.metadata.forbiddenRuntimeTokens, null, 2);
  const nativeEvidence = JSON.stringify(
    pkg.fidelityLedger.flatMap((item) => (item.status === 'native' ? (item.evidence ?? []) : [])),
    null,
    2,
  );
  const unsupportedIds = JSON.stringify(pkg.unsupported.map((item) => item.id), null, 2);
  return `import { renderBuiltInTemplatePreviewBodyHtml } from './built-in-preview.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import { validateEditableSite, validatePublishedSnapshot, validateSeedFixture } from '../canvas/validate.js';
import { getTemplateSeed, instantiateTemplate } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[${pkg.metadata.id}:replica-smoke] ' + message);
}

const seed = getTemplateSeed('${pkg.metadata.id}');
assert(seed !== null, 'getTemplateSeed(\\'${pkg.metadata.id}\\') must resolve generated template');

const state = instantiateTemplate('${pkg.metadata.id}');
const editable = validateEditableSite(state);
assert(editable.valid, editable.valid ? '' : editable.errors.join('\\n'));
const seedFixture = validateSeedFixture(state);
assert(seedFixture.valid, seedFixture.valid ? '' : seedFixture.errors.join('\\n'));
const published = validatePublishedSnapshot({ ...state, version: 1, publishedAt: '2026-06-22T00:00:00.000Z' });
assert(published.valid, published.valid ? '' : published.errors.join('\\n'));

const html = renderBuiltInTemplatePreviewBodyHtml('${pkg.metadata.id}', {
  turnstileSiteKey: '1x00000000000000000000AA',
});
for (const token of ${requiredCopy}) {
  assert(html.includes(token), 'preview must include required copy ' + JSON.stringify(token));
}
for (const assetId of ${requiredAssetIds}) {
  assert(getSeedAsset(assetId) !== null, 'seed asset must be registered ' + assetId);
  assert(html.includes(assetId), 'preview must include seed asset id ' + assetId);
}
for (const token of ${forbidden}) {
  assert(!html.toLowerCase().includes(String(token).toLowerCase()), 'preview must not include forbidden runtime token ' + token);
}
for (const token of ${nativeEvidence}) {
  assert(html.includes(token), 'native fidelity evidence missing ' + JSON.stringify(token));
}
for (const unsupportedId of ${unsupportedIds}) {
  assert(unsupportedId.length > 0, 'unsupported finding id must be non-empty');
}

console.log('[${pkg.metadata.id}:replica-smoke] OK');
`;
}
```

Then in `compileSeedTarget`, after writing generated template manifest, write the generated smoke:

```ts
  const smokePath = join(repoRoot, 'src', 'templates', `${pkg.metadata.id}.replica.smoke.ts`);
  await writeFileAtomic(smokePath, renderGeneratedSmokeSource(pkg));
  written.push(smokePath);
```

- [ ] **Step 4: Run verifier smoke**

Run:

```bash
bun run src/templates/replica-package/verify.smoke.ts
bun run src/templates/replica-package/compiler.smoke.ts
bun run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit verifier task**

```bash
git add src/templates/replica-package/verify.ts src/templates/replica-package/verify.smoke.ts src/templates/replica-package/compiler.ts
git commit -m "test: verify replica compiler outputs"
```

## Task 5: CLI, Scripts, And End-To-End Tiny Compile

**Files:**
- Create: `scripts/replica.ts`
- Modify: `package.json`
- Generated by command: `src/canvas/section-library/entries/tiny-replica-hero.json`
- Generated by command: `src/assets/seed-source/tiny-replica-mark.svg.b64`
- Generated by command: `src/canvas/seed-assets.generated.ts`
- Generated by command: `src/templates/generated/tiny-replica.ts`
- Generated by command: `src/templates/generated/manifest.ts`
- Generated by command: `src/templates/tiny-replica.replica.smoke.ts`
- Generated by command: `tmp/replicas/tiny-replica/editable-site.json`
- Generated by command: `tmp/replicas/tiny-replica/asset-manifest.json`
- Generated by command: `tmp/replicas/tiny-replica/report.json`

**Interfaces:**
- Consumes: `compileReplicaPackage`
- Produces: CLI `bun run replica compile --source <dir> --target seed|import|both`
- Produces package scripts `replica-package:smoke` and CI coverage

- [ ] **Step 1: Write CLI**

Create `scripts/replica.ts`:

```ts
import { compileReplicaPackage, type CompileReplicaPackageInput } from '../src/templates/replica-package/compiler.js';

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function usage(): never {
  throw new Error(
    [
      'Usage:',
      '  bun run replica compile --source <dir> --target seed|import|both',
    ].join('\n'),
  );
}

const command = process.argv[2];
if (command !== 'compile') usage();

const sourceDir = valueAfter('--source');
const target = valueAfter('--target');
if (!sourceDir || !target) usage();
if (target !== 'seed' && target !== 'import' && target !== 'both') {
  throw new Error(`replica: --target must be seed, import, or both (got ${target})`);
}

const input: CompileReplicaPackageInput = {
  sourceDir,
  target,
};

const result = await compileReplicaPackage(input);
console.log(
  JSON.stringify(
    {
      replicaId: result.replicaId,
      target: result.target,
      writtenFiles: result.writtenFiles,
      unsupported: result.unsupported.map((item) => item.id),
      fidelity: result.fidelityLedger.map((item) => ({ id: item.id, status: item.status })),
    },
    null,
    2,
  ),
);
```

- [ ] **Step 2: Add package scripts**

Modify `package.json` scripts:

```json
"replica": "bun run scripts/replica.ts",
"replica-package:smoke": "bun run src/templates/replica-package/load.smoke.ts && bun run src/templates/replica-package/assets.smoke.ts && bun run src/templates/replica-package/compiler.smoke.ts && bun run src/templates/replica-package/verify.smoke.ts && bun run src/templates/tiny-replica.replica.smoke.ts"
```

Add `&& bun run replica-package:smoke` to `ci:smoke` near existing template/section-library smokes, after `section-library-composition:smoke`.

- [ ] **Step 3: Generate tiny fixture outputs**

Run:

```bash
bun run replica compile --source src/templates/replicas/tiny-replica --target both
```

Expected: JSON output lists written files including:

```text
src/canvas/section-library/entries/tiny-replica-hero.json
src/assets/seed-source/tiny-replica-mark.svg.b64
src/canvas/seed-assets.generated.ts
src/templates/generated/tiny-replica.ts
src/templates/generated/manifest.ts
src/templates/tiny-replica.replica.smoke.ts
tmp/replicas/tiny-replica/editable-site.json
tmp/replicas/tiny-replica/asset-manifest.json
tmp/replicas/tiny-replica/report.json
```

- [ ] **Step 4: Sync Section Library manifest**

Run:

```bash
bun run section-library:sync
```

Expected: `src/canvas/section-library/entries/manifest.ts` gains `tiny-replica-hero.json`.

- [ ] **Step 5: Run end-to-end verification**

Run:

```bash
bun run replica-package:smoke
bun run template-preview:smoke
bun run section-library-composition:smoke
bun run seed:assets
bun run typecheck
```

Expected:

- `replica-package:smoke` PASS, including generated `tiny-replica.replica.smoke.ts`.
- `template-preview:smoke` PASS.
- `section-library-composition:smoke` PASS and template count increments by one.
- `seed:assets` PASS and includes generated seed asset count.
- `typecheck` PASS.

- [ ] **Step 6: Run full CI smoke**

Run:

```bash
bun run ci:smoke
```

Expected: PASS.

- [ ] **Step 7: Commit CLI and generated fixture outputs**

```bash
git add scripts/replica.ts package.json src/templates/replica-package src/templates/replicas/tiny-replica src/canvas/section-library/entries/tiny-replica-hero.json src/canvas/section-library/entries/manifest.ts src/assets/seed-source/tiny-replica-mark.svg.b64 src/canvas/seed-assets.generated.ts src/templates/generated src/templates/tiny-replica.replica.smoke.ts tmp/replicas/tiny-replica
git commit -m "feat: add deterministic replica package compiler"
```

## Plan Self-Review

- Spec coverage: Slice 1 covers package schema, compiler shell, generated-manifest hook, file-output import target, verifier, and tiny fixture.
- Admin isolation: no task edits `src/templates/source-admin*.ts`, `src/routes/dashboard/admin-template-source.tsx`, or `scripts/template-source-admin.ts`.
- Fail-loud posture: loader rejects malformed ids/refs, asset compiler rejects missing bytes, compiler rejects invalid targets and invalid Editable Site output, verifier rejects missing ledger/report evidence.
- Target modes: `seed`, `import`, and `both` are explicit. `both` runs both adapters and fails if either throws.
- TDD: every implementation task starts with a failing smoke, then minimal implementation, then verification, then commit.
