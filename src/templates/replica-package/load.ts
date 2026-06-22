import { readdir, readFile, access } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import type { StyleKitPreset } from '../../canvas/schema.js';
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
  return value as string[];
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
  const metadata: ReplicaMetadata = {
    id,
    name: assertString(value.name, 'metadata.name'),
    tagline: assertString(value.tagline, 'metadata.tagline'),
    source: value.source as ReplicaMetadata['source'],
    targets: targets as ReplicaMetadata['targets'],
    styleKit: assertString(value.styleKit, 'metadata.styleKit') as ReplicaMetadata['styleKit'],
    pageOrder: assertStringArray(value.pageOrder, 'metadata.pageOrder'),
    requiredCopy: assertStringArray(value.requiredCopy, 'metadata.requiredCopy'),
    requiredAssetIds: assertStringArray(value.requiredAssetIds, 'metadata.requiredAssetIds'),
    forbiddenRuntimeTokens: assertStringArray(value.forbiddenRuntimeTokens, 'metadata.forbiddenRuntimeTokens'),
    assets: assets as ReplicaMetadata['assets'],
  };
  if (value.customStyleKit !== undefined) {
    metadata.customStyleKit = value.customStyleKit as StyleKitPreset;
  }
  return metadata;
}

function validatePage(value: unknown, fileStem: string): ReplicaPageSource {
  assertObject(value, `pages/${fileStem}.json`);
  const id = assertString(value.id, `pages/${fileStem}.id`);
  if (!ID_RE.test(id)) throw new Error(`replica-package: page id "${id}" must match ${ID_RE.source}`);
  const width = value.width;
  if (typeof width !== 'number' || width <= 0) throw new Error(`replica-package: page ${id}.width must be positive`);
  const page: ReplicaPageSource = {
    fileStem,
    id,
    slug: assertString(value.slug, `pages/${fileStem}.slug`),
    title: assertString(value.title, `pages/${fileStem}.title`),
    width,
    sections: assertStringArray(value.sections, `pages/${fileStem}.sections`),
  };
  if (typeof value.description === 'string') page.description = value.description;
  if (typeof value.pageBackground === 'string') page.pageBackground = value.pageBackground;
  if (typeof value.sectionGap === 'number') page.sectionGap = value.sectionGap;
  return page;
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validateAssetSourcePath(rootDir: string, sourcePath: string, assetId: string): Promise<void> {
  if (isAbsolute(sourcePath) || sourcePath.startsWith('/') || sourcePath.startsWith('\\') || /^[a-zA-Z]:/.test(sourcePath)) {
    throw new Error(`replica-package: asset "${assetId}" sourcePath "${sourcePath}" is an absolute path or escape attempt`);
  }

  const assetsDir = resolve(rootDir, 'assets');
  const assetFilePath = resolve(assetsDir, sourcePath);

  const relativePath = relative(assetsDir, assetFilePath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`replica-package: asset "${assetId}" sourcePath "${sourcePath}" escapes assets directory`);
  }

  if (!(await fileExists(assetFilePath))) {
    throw new Error(`replica-package: asset file "${sourcePath}" does not exist for asset "${assetId}"`);
  }
}

async function scanForbiddenTokens(rootDir: string, forbiddenTokens: string[]): Promise<void> {
  if (forbiddenTokens.length === 0) return;

  const filesToScan: { path: string; isMetadata: boolean }[] = [];

  // replica.json (metadata)
  const replicaJsonPath = join(rootDir, 'replica.json');
  if (await fileExists(replicaJsonPath)) {
    filesToScan.push({ path: replicaJsonPath, isMetadata: true });
  }

  // pages/*.json
  const pagesDir = join(rootDir, 'pages');
  if (await fileExists(pagesDir)) {
    for (const name of await readdir(pagesDir)) {
      if (name.endsWith('.json')) {
        filesToScan.push({ path: join(pagesDir, name), isMetadata: false });
      }
    }
  }

  // sections/*.json
  const sectionsDir = join(rootDir, 'sections');
  if (await fileExists(sectionsDir)) {
    for (const name of await readdir(sectionsDir)) {
      if (name.endsWith('.json')) {
        filesToScan.push({ path: join(sectionsDir, name), isMetadata: false });
      }
    }
  }

  for (const { path: filePath, isMetadata } of filesToScan) {
    let content = await readFile(filePath, 'utf8');

    if (isMetadata) {
      try {
        const parsed = JSON.parse(content) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const clone = { ...parsed } as Record<string, unknown>;
          delete clone.forbiddenRuntimeTokens;
          content = JSON.stringify(clone);
        }
      } catch (cause) {
        throw new Error(`replica-package: ${filePath} is not valid JSON`, { cause });
      }
    }

    for (const token of forbiddenTokens) {
      if (content.includes(token)) {
        const fileRef = relative(rootDir, filePath).replace(/\\/g, '/');
        throw new Error(`replica-package: forbidden runtime token "${token}" found in "${fileRef}"`);
      }
    }
  }
}

export async function assertReplicaPackage(pkg: ReplicaSourcePackage): Promise<void> {
  // 1. Duplicate pageOrder entries (checked first because it validates the package topology)
  const seenPageOrder = new Set<string>();
  for (const pageStem of pkg.metadata.pageOrder) {
    if (seenPageOrder.has(pageStem)) {
      throw new Error(`replica-package: duplicate pageOrder entry "${pageStem}"`);
    }
    seenPageOrder.add(pageStem);
  }

  // 2. Duplicate asset IDs in metadata.assets
  const seenAssetIds = new Set<string>();
  for (const asset of pkg.metadata.assets) {
    if (seenAssetIds.has(asset.id)) {
      throw new Error(`replica-package: duplicate asset id "${asset.id}"`);
    }
    seenAssetIds.add(asset.id);
  }

  // 3. Duplicate page IDs
  const seenPageIds = new Set<string>();
  for (const page of pkg.pages) {
    if (seenPageIds.has(page.id)) {
      throw new Error(`replica-package: duplicate page id "${page.id}"`);
    }
    seenPageIds.add(page.id);
  }

  // 4. Duplicate page slugs
  const seenPageSlugs = new Set<string>();
  for (const page of pkg.pages) {
    if (seenPageSlugs.has(page.slug)) {
      throw new Error(`replica-package: duplicate page slug "${page.slug}"`);
    }
    seenPageSlugs.add(page.slug);
  }

  // 5. Duplicate section baseSlug values
  const seenBaseSlugs = new Set<string>();
  for (const section of pkg.sections) {
    if (seenBaseSlugs.has(section.baseSlug)) {
      throw new Error(`replica-package: duplicate section baseSlug "${section.baseSlug}"`);
    }
    seenBaseSlugs.add(section.baseSlug);
  }

  // 6. Duplicate page section references / instance IDs on the same page
  for (const page of pkg.pages) {
    const seenSectionRefs = new Set<string>();
    const seenInstanceIds = new Set<string>();
    for (const ref of page.sections) {
      if (seenSectionRefs.has(ref)) {
        throw new Error(`replica-package: page "${page.fileStem}" has duplicate section reference "${ref}"`);
      }
      seenSectionRefs.add(ref);

      const instanceId = ref.replace(/[^a-z0-9]/g, '');
      if (seenInstanceIds.has(instanceId)) {
        throw new Error(`replica-package: page "${page.fileStem}" has duplicate section instance ID "${instanceId}" (from reference "${ref}")`);
      }
      seenInstanceIds.add(instanceId);
    }
  }

  // 7. Validate each metadata asset sourcePath resolves under the package assets directory and exists
  for (const asset of pkg.metadata.assets) {
    await validateAssetSourcePath(pkg.rootDir, asset.sourcePath, asset.id);
  }

  // 8. Scan for forbidden runtime tokens
  await scanForbiddenTokens(pkg.rootDir, pkg.metadata.forbiddenRuntimeTokens);

  // Existing validations
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
  await assertReplicaPackage(pkg);
  return pkg;
}
