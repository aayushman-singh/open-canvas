import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import ts from 'typescript';

import type { EditableSite } from '../canvas/schema.js';
import {
  SECTION_LIBRARY,
  entryRowId,
  type SectionInstanceRef,
  type SectionLibraryEntry,
} from '../canvas/section-library/index.js';
import { validateEditableSite } from '../canvas/validate.js';
import { allTemplateSeeds, getTemplateSeed, type TemplateSeed } from './registry.js';

export interface TemplateSourceAdminPaths {
  repoRoot?: string;
  entriesDir?: string;
  registryFile?: string;
}

export interface TemplateSourceCatalogEntry {
  id: string;
  name: string;
  tagline: string;
  styleKit: string;
  sectionCount: number;
}

export interface TemplateSourceSection {
  sectionId: string;
  instanceId: string;
  baseSlug: string;
  slot: string;
  filePath: string;
  name: string;
  source: string;
}

export interface TemplateSourceDocument {
  template: {
    id: string;
    name: string;
    tagline: string;
    styleKit: string;
  };
  sections: TemplateSourceSection[];
}

export interface SectionWriteResult {
  templateId: string;
  sectionId: string;
  baseSlug: string;
  filePath: string;
}

export interface MetadataWriteInput {
  name?: string;
  tagline?: string;
}

export interface MetadataWriteResult {
  templateId: string;
  filePath: string;
  changedFields: Array<keyof MetadataWriteInput>;
}

interface ResolvedPaths {
  repoRoot: string;
  entriesDir: string;
  registryFile: string;
}

interface TemplateRefSlot {
  ref: SectionInstanceRef;
  slot: string;
}

const sectionEntriesByRowId = new Map<string, SectionLibraryEntry>();
for (const entry of SECTION_LIBRARY) {
  sectionEntriesByRowId.set(entryRowId(entry), entry);
}

function resolvePaths(paths: TemplateSourceAdminPaths = {}): ResolvedPaths {
  const repoRoot = paths.repoRoot ?? process.cwd();
  return {
    repoRoot,
    entriesDir: paths.entriesDir ?? join(repoRoot, 'src', 'canvas', 'section-library', 'entries'),
    registryFile: paths.registryFile ?? join(repoRoot, 'src', 'templates', 'registry.ts'),
  };
}

function requireTemplate(templateId: string): TemplateSeed {
  const template = getTemplateSeed(templateId);
  if (!template) {
    throw new Error(`template-source-admin: unknown template '${templateId}'`);
  }
  return template;
}

function templateRefSlots(template: TemplateSeed): TemplateRefSlot[] {
  const slots: TemplateRefSlot[] = [];
  if (template.headerRef) {
    slots.push({ ref: template.headerRef, slot: 'header' });
  }
  if (template.footerRef) {
    slots.push({ ref: template.footerRef, slot: 'footer' });
  }
  for (const page of template.pages) {
    page.bodyRefs.forEach((ref, index) => {
      slots.push({ ref, slot: `page:${page.slug}:section:${String(index + 1)}` });
    });
  }
  return slots;
}

function requireTemplateRef(template: TemplateSeed, sectionId: string): TemplateRefSlot {
  const match = templateRefSlots(template).find((slot) => slot.ref.sectionId === sectionId);
  if (!match) {
    throw new Error(
      `template-source-admin: template '${template.id}' does not use section '${sectionId}'`,
    );
  }
  return match;
}

function requireSectionEntry(sectionId: string): SectionLibraryEntry {
  const entry = sectionEntriesByRowId.get(sectionId);
  if (!entry) {
    throw new Error(
      `template-source-admin: section '${sectionId}' is not a code-defined Section Library entry`,
    );
  }
  return entry;
}

function sectionFilePath(paths: ResolvedPaths, baseSlug: string): string {
  return join(paths.entriesDir, `${baseSlug}.json`);
}

function parseJsonObject(source: string, context: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw new Error(`template-source-admin: ${context} is not valid JSON`, { cause });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`template-source-admin: ${context} must be a JSON object`);
  }
  return parsed;
}

function assertSectionEntryShape(
  value: unknown,
  expectedBaseSlug: string,
  context: string,
): asserts value is SectionLibraryEntry {
  const entry = value as Record<string, unknown>;
  const errors: string[] = [];
  if (entry.baseSlug !== expectedBaseSlug) {
    errors.push(
      `baseSlug must remain '${expectedBaseSlug}' (got ${JSON.stringify(entry.baseSlug)})`,
    );
  }
  for (const key of ['category', 'name', 'description', 'recipeId', 'headingPreview']) {
    if (typeof entry[key] !== 'string' || entry[key].length === 0) {
      errors.push(`${key} must be a non-empty string`);
    }
  }
  if (typeof entry.sectionData !== 'object' || entry.sectionData === null) {
    errors.push('sectionData must be an object');
  }
  if (!Array.isArray(entry.assetManifest)) {
    errors.push('assetManifest must be an array');
  }
  const origin = entry.originTemplateId;
  if (origin !== null && typeof origin !== 'string') {
    errors.push('originTemplateId must be a string or null');
  }
  if (errors.length > 0) {
    throw new Error(
      `template-source-admin: ${context} failed SectionLibraryEntry shape validation:\n  - ${errors.join('\n  - ')}`,
    );
  }

  const syntheticState: EditableSite = {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'template-source-admin-validation-page',
        slug: 'home',
        title: 'Template source admin validation',
        width: 1440,
        sections: [entry.sectionData as SectionLibraryEntry['sectionData']],
      },
    ],
  };
  const validation = validateEditableSite(syntheticState);
  if (!validation.valid) {
    throw new Error(
      `template-source-admin: ${context} failed canvas validation:\n  - ${validation.errors.join('\n  - ')}`,
    );
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  await rename(tmpPath, filePath);
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function styleKitLabel(template: TemplateSeed): string {
  return template.styleKit === 'custom' ? 'custom' : template.styleKit;
}

export function getTemplateSourceCatalog(): TemplateSourceCatalogEntry[] {
  return allTemplateSeeds.map((template) => ({
    id: template.id,
    name: template.name,
    tagline: template.tagline,
    styleKit: styleKitLabel(template),
    sectionCount: templateRefSlots(template).length,
  }));
}

export async function readTemplateSourceDocument(
  templateId: string,
  paths: TemplateSourceAdminPaths = {},
): Promise<TemplateSourceDocument> {
  const resolved = resolvePaths(paths);
  const template = requireTemplate(templateId);
  const sections: TemplateSourceSection[] = [];
  for (const slot of templateRefSlots(template)) {
    const entry = requireSectionEntry(slot.ref.sectionId);
    const filePath = sectionFilePath(resolved, entry.baseSlug);
    sections.push({
      sectionId: slot.ref.sectionId,
      instanceId: slot.ref.instanceId,
      baseSlug: entry.baseSlug,
      slot: slot.slot,
      filePath,
      name: entry.name,
      source: await readFile(filePath, 'utf8'),
    });
  }
  return {
    template: {
      id: template.id,
      name: template.name,
      tagline: template.tagline,
      styleKit: styleKitLabel(template),
    },
    sections,
  };
}

export async function writeTemplateSectionSource(
  templateId: string,
  sectionId: string,
  source: string,
  paths: TemplateSourceAdminPaths = {},
): Promise<SectionWriteResult> {
  const resolved = resolvePaths(paths);
  const template = requireTemplate(templateId);
  requireTemplateRef(template, sectionId);
  const entry = requireSectionEntry(sectionId);
  const filePath = sectionFilePath(resolved, entry.baseSlug);
  const parsed = parseJsonObject(source, `${entry.baseSlug}.json`);
  assertSectionEntryShape(parsed, entry.baseSlug, `${entry.baseSlug}.json`);
  await writeFileAtomic(filePath, prettyJson(parsed));
  return { templateId, sectionId, baseSlug: entry.baseSlug, filePath };
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  key: string,
): ts.PropertyAssignment | null {
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (propertyNameText(prop.name) === key) return prop;
  }
  return null;
}

function propertyStringValue(object: ts.ObjectLiteralExpression, key: string): string | null {
  const prop = objectProperty(object, key);
  if (!prop) return null;
  const init = prop.initializer;
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
    return init.text;
  }
  return null;
}

function replacementSpanForStringProperty(
  object: ts.ObjectLiteralExpression,
  key: string,
): { start: number; end: number } | null {
  const prop = objectProperty(object, key);
  if (!prop) return null;
  const init = prop.initializer;
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
    return { start: init.getStart(), end: init.getEnd() };
  }
  return null;
}

function findTemplateObject(
  sourceFile: ts.SourceFile,
  templateId: string,
): ts.ObjectLiteralExpression | null {
  let match: ts.ObjectLiteralExpression | null = null;

  function visit(node: ts.Node): void {
    if (match) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const initializer = node.initializer;
      const id = propertyStringValue(initializer, 'id');
      if (id === templateId) {
        match = initializer;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return match;
}

function validateMetadataInput(input: MetadataWriteInput): Array<keyof MetadataWriteInput> {
  const changedFields: Array<keyof MetadataWriteInput> = [];
  for (const field of ['name', 'tagline'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (value.trim().length === 0) {
      throw new Error(`template-source-admin: ${field} must be a non-empty string`);
    }
    changedFields.push(field);
  }
  if (changedFields.length === 0) {
    throw new Error('template-source-admin: metadata save requires name or tagline');
  }
  return changedFields;
}

export async function writeTemplateMetadataSource(
  templateId: string,
  input: MetadataWriteInput,
  paths: TemplateSourceAdminPaths = {},
): Promise<MetadataWriteResult> {
  const resolved = resolvePaths(paths);
  requireTemplate(templateId);
  const changedFields = validateMetadataInput(input);
  const source = await readFile(resolved.registryFile, 'utf8');
  const sourceFile = ts.createSourceFile(
    resolved.registryFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const object = findTemplateObject(sourceFile, templateId);
  if (!object) {
    throw new Error(
      `template-source-admin: registry file '${resolved.registryFile}' does not contain template '${templateId}'`,
    );
  }

  const replacements: Array<{ start: number; end: number; value: string; field: string }> = [];
  for (const field of changedFields) {
    const span = replacementSpanForStringProperty(object, field);
    if (!span) {
      throw new Error(
        `template-source-admin: template '${templateId}' registry field '${field}' must be a string literal`,
      );
    }
    replacements.push({
      ...span,
      value: JSON.stringify(input[field]),
      field,
    });
  }

  let nextSource = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    nextSource =
      nextSource.slice(0, replacement.start) +
      replacement.value +
      nextSource.slice(replacement.end);
  }
  await writeFileAtomic(resolved.registryFile, nextSource);

  return { templateId, filePath: resolved.registryFile, changedFields };
}
