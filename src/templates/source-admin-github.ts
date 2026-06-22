import type { EditableSite } from '../canvas/schema.js';
import {
  SECTION_LIBRARY,
  entryRowId,
  type SectionInstanceRef,
  type SectionLibraryEntry,
} from '../canvas/section-library/index.js';
import { validateEditableSite } from '../canvas/validate.js';
import { allTemplateSeeds, getTemplateSeed, type TemplateSeed } from './registry.js';

export interface GitHubTemplateSourceConfig {
  token: string;
  repository: string;
  baseBranch: string;
}

export type GitHubTemplateSourceEnv = {
  TEMPLATE_SOURCE_GITHUB_TOKEN?: string;
  TEMPLATE_SOURCE_GITHUB_REPOSITORY?: string;
  TEMPLATE_SOURCE_GITHUB_BASE_BRANCH?: string;
};

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

export interface TemplateSourcePullRequestInput {
  templateId: string;
  sectionId: string;
  source: string;
}

export interface TemplateSourcePullRequestResult {
  templateId: string;
  sectionId: string;
  changedPath: string;
  branchName: string;
  pullRequestUrl: string;
}

export interface TemplateSourcePullRequestDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  randomSuffix?: () => string;
}

interface TemplateRefSlot {
  ref: SectionInstanceRef;
  slot: string;
}

type GitHubRefResponse = {
  object?: {
    sha?: unknown;
  };
};

type GitHubContentResponse = {
  sha?: unknown;
};

type GitHubPullResponse = {
  html_url?: unknown;
};

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_BASE_BRANCH = 'main';
const sectionEntriesByRowId = new Map<string, SectionLibraryEntry>();

for (const entry of SECTION_LIBRARY) {
  sectionEntriesByRowId.set(entryRowId(entry), entry);
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`template-source-admin: ${name} must be set`);
  }
  return value.trim();
}

export function requireTemplateSourceGitHubConfig(
  env: GitHubTemplateSourceEnv,
): GitHubTemplateSourceConfig {
  return {
    token: requireNonEmpty(env.TEMPLATE_SOURCE_GITHUB_TOKEN, 'TEMPLATE_SOURCE_GITHUB_TOKEN'),
    repository: requireNonEmpty(
      env.TEMPLATE_SOURCE_GITHUB_REPOSITORY,
      'TEMPLATE_SOURCE_GITHUB_REPOSITORY',
    ),
    baseBranch: env.TEMPLATE_SOURCE_GITHUB_BASE_BRANCH?.trim() || DEFAULT_BASE_BRANCH,
  };
}

function styleKitLabel(template: TemplateSeed): string {
  return template.styleKit === 'custom' ? 'custom' : template.styleKit;
}

export function getProductionTemplateSourceCatalog(): TemplateSourceCatalogEntry[] {
  return allTemplateSeeds.map((template) => ({
    id: template.id,
    name: template.name,
    tagline: template.tagline,
    styleKit: styleKitLabel(template),
    sectionCount: templateRefSlots(template).length,
  }));
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

function sectionFilePath(baseSlug: string): string {
  return `src/canvas/section-library/entries/${baseSlug}.json`;
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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

export function readProductionTemplateSourceDocument(templateId: string): TemplateSourceDocument {
  const template = requireTemplate(templateId);
  const sections: TemplateSourceSection[] = [];
  for (const slot of templateRefSlots(template)) {
    const entry = requireSectionEntry(slot.ref.sectionId);
    sections.push({
      sectionId: slot.ref.sectionId,
      instanceId: slot.ref.instanceId,
      baseSlug: entry.baseSlug,
      slot: slot.slot,
      filePath: sectionFilePath(entry.baseSlug),
      name: entry.name,
      source: prettyJson(entry),
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

function buildSectionSourceChange(input: TemplateSourcePullRequestInput): {
  path: string;
  content: string;
  template: TemplateSeed;
} {
  const template = requireTemplate(input.templateId);
  requireTemplateRef(template, input.sectionId);
  const currentEntry = requireSectionEntry(input.sectionId);
  const parsed = parseJsonObject(input.source, `${currentEntry.baseSlug}.json`);
  assertSectionEntryShape(parsed, currentEntry.baseSlug, `${currentEntry.baseSlug}.json`);
  return {
    path: sectionFilePath(currentEntry.baseSlug),
    content: prettyJson(parsed),
    template,
  };
}

function timestampSlug(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

function slugPart(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 48) : 'template';
}

function defaultRandomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function buildBranchName(
  templateId: string,
  deps: Pick<TemplateSourcePullRequestDeps, 'now' | 'randomSuffix'>,
): string {
  const now = deps.now?.() ?? new Date();
  const suffix = deps.randomSuffix?.() ?? defaultRandomSuffix();
  return `template-source/${slugPart(templateId)}/${timestampSlug(now)}-${slugPart(suffix)}`;
}

function encodeGitHubPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function githubJson<T>(
  config: GitHubTemplateSourceConfig,
  fetchFn: typeof fetch,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      'user-agent': 'open-canvas-template-source-admin',
      'x-github-api-version': '2022-11-28',
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetchFn(`${GITHUB_API_BASE}/repos/${config.repository}${path}`, init);
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new Error(
        `template-source-admin: GitHub ${method} ${path} returned invalid JSON with status ${String(
          response.status,
        )}`,
        { cause },
      );
    }
  }
  if (!response.ok) {
    throw new Error(
      `template-source-admin: GitHub ${method} ${path} failed with status ${String(
        response.status,
      )}: ${text}`,
    );
  }
  return parsed as T;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`template-source-admin: GitHub response missing ${context}`);
  }
  return value;
}

export async function createTemplateSourcePullRequest(
  config: GitHubTemplateSourceConfig,
  input: TemplateSourcePullRequestInput,
  deps: TemplateSourcePullRequestDeps = {},
): Promise<TemplateSourcePullRequestResult> {
  const githubConfig = {
    token: requireNonEmpty(config.token, 'TEMPLATE_SOURCE_GITHUB_TOKEN'),
    repository: requireNonEmpty(config.repository, 'TEMPLATE_SOURCE_GITHUB_REPOSITORY'),
    baseBranch: requireNonEmpty(config.baseBranch, 'TEMPLATE_SOURCE_GITHUB_BASE_BRANCH'),
  };
  const fetchFn = deps.fetch ?? fetch;
  const change = buildSectionSourceChange(input);
  const branchName = buildBranchName(input.templateId, deps);
  const encodedPath = encodeGitHubPath(change.path);

  const baseRef = await githubJson<GitHubRefResponse>(
    githubConfig,
    fetchFn,
    'GET',
    `/git/ref/heads/${encodeURIComponent(githubConfig.baseBranch)}`,
  );
  const baseSha = requireString(baseRef.object?.sha, 'base branch sha');

  await githubJson(
    githubConfig,
    fetchFn,
    'POST',
    '/git/refs',
    {
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    },
  );

  const existingFile = await githubJson<GitHubContentResponse>(
    githubConfig,
    fetchFn,
    'GET',
    `/contents/${encodedPath}?ref=${encodeURIComponent(githubConfig.baseBranch)}`,
  );
  const fileSha = requireString(existingFile.sha, `${change.path} sha`);

  await githubJson(
    githubConfig,
    fetchFn,
    'PUT',
    `/contents/${encodedPath}`,
    {
      message: `feat: update ${change.template.name} template source`,
      content: utf8Base64(change.content),
      branch: branchName,
      sha: fileSha,
    },
  );

  const pull = await githubJson<GitHubPullResponse>(
    githubConfig,
    fetchFn,
    'POST',
    '/pulls',
    {
      title: `Update ${change.template.name} template source`,
      head: branchName,
      base: githubConfig.baseBranch,
      body: [
        `Updates \`${change.path}\` from the production template source admin.`,
        '',
        `Template: \`${input.templateId}\``,
        `Section: \`${input.sectionId}\``,
      ].join('\n'),
    },
  );

  return {
    templateId: input.templateId,
    sectionId: input.sectionId,
    changedPath: change.path,
    branchName,
    pullRequestUrl: requireString(pull.html_url, 'pull request URL'),
  };
}
