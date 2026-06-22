import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { customTemplate, site } from '../db/schema.js';
import type { StyleKit, EditableSite } from '../canvas/schema.js';
import { instantiateTemplate } from './registry.js';
import { validateEditableSite } from '../canvas/validate.js';
import { buildAssetManifest } from './custom-template-assets.js';

export interface CuratedTemplateSummary {
  id: string;
  name: string;
  tagline: string;
  visibility: 'global' | 'private';
  publicationStatus: 'drafting' | 'published' | 'unpublished';
  templateDraftSiteId: string | null;
  updatedAt: string;
}

export interface CuratedAdminDeps {
  database: Db;
  env: Record<string, unknown> | undefined;
}

export function requireTemplateAssetCustodianCustomerId(env: Record<string, unknown> | undefined): string {
  const custodianId = typeof env?.TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID === 'string'
    ? env.TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID.trim()
    : undefined;
  if (!custodianId) {
    throw new Error('curated-template-admin: TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID must be set');
  }
  return custodianId;
}

export async function listCuratedTemplates(database: Db): Promise<CuratedTemplateSummary[]> {
  const rows = await database
    .select({
      id: customTemplate.id,
      name: customTemplate.name,
      tagline: customTemplate.tagline,
      visibility: customTemplate.visibility,
      publicationStatus: customTemplate.publicationStatus,
      templateDraftSiteId: customTemplate.templateDraftSiteId,
      updatedAt: customTemplate.updatedAt,
    })
    .from(customTemplate)
    .where(eq(customTemplate.visibility, 'global'));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tagline: r.tagline,
    visibility: r.visibility,
    publicationStatus: r.publicationStatus,
    templateDraftSiteId: r.templateDraftSiteId,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }));
}

export async function ensureCuratedTemplateDraft(
  deps: CuratedAdminDeps,
  templateId: string,
): Promise<{ templateId: string; draftSiteId: string }> {
  const custodianId = requireTemplateAssetCustodianCustomerId(deps.env);

  const rows = await deps.database
    .select({
      id: customTemplate.id,
      name: customTemplate.name,
      styleKit: customTemplate.styleKit,
      siteState: customTemplate.siteState,
      templateDraftSiteId: customTemplate.templateDraftSiteId,
    })
    .from(customTemplate)
    .where(and(eq(customTemplate.id, templateId), eq(customTemplate.visibility, 'global')))
    .limit(1);

  const tmpl = rows[0];
  if (!tmpl) {
    throw new Error('curated-template-admin: template not found');
  }

  if (tmpl.templateDraftSiteId) {
    return { templateId, draftSiteId: tmpl.templateDraftSiteId };
  }

  const draftSiteId = crypto.randomUUID();
  const subdomain = `template-draft-${crypto.randomUUID().slice(0, 8)}`;

  await deps.database.insert(site).values({
    id: draftSiteId,
    customerId: custodianId,
    siteKind: 'template_draft',
    name: `Draft: ${tmpl.name}`,
    subdomain,
    styleKit: tmpl.styleKit as StyleKit,
    editableState: tmpl.siteState,
    publishedVersion: 0,
  });

  await deps.database
    .update(customTemplate)
    .set({
      templateDraftSiteId: draftSiteId,
      updatedAt: new Date(),
    })
    .where(eq(customTemplate.id, templateId));

  return { templateId, draftSiteId };
}

export interface CreateCuratedTemplateDraftInput {
  sourceId?: string | undefined;
  sourceTemplateId?: string | undefined;
  name: string;
  tagline?: string | undefined;
}

export async function createCuratedTemplateDraft(
  deps: CuratedAdminDeps,
  input: CreateCuratedTemplateDraftInput,
): Promise<{ templateId: string; draftSiteId: string }> {
  const custodianId = requireTemplateAssetCustodianCustomerId(deps.env);

  if (!input.name?.trim()) {
    throw new Error('curated-template-admin: name is required');
  }

  let siteState: EditableSite;
  let styleKit: string;

  if (input.sourceId) {
    siteState = instantiateTemplate(input.sourceId);
    styleKit = siteState.styleKit;
  } else if (input.sourceTemplateId) {
    const rows = await deps.database
      .select({
        siteState: customTemplate.siteState,
        styleKit: customTemplate.styleKit,
      })
      .from(customTemplate)
      .where(and(eq(customTemplate.id, input.sourceTemplateId), eq(customTemplate.visibility, 'global')))
      .limit(1);

    const src = rows[0];
    if (!src) {
      throw new Error('curated-template-admin: source template not found');
    }
    siteState = src.siteState;
    styleKit = src.styleKit;
  } else {
    throw new Error('curated-template-admin: either sourceId or sourceTemplateId must be provided');
  }

  const draftSiteId = crypto.randomUUID();
  const templateId = crypto.randomUUID();
  const subdomain = `template-draft-${crypto.randomUUID().slice(0, 8)}`;

  // Create hidden template_draft site row
  await deps.database.insert(site).values({
    id: draftSiteId,
    customerId: custodianId,
    siteKind: 'template_draft',
    name: `Draft: ${input.name}`,
    subdomain,
    styleKit: styleKit as StyleKit,
    editableState: siteState,
    publishedVersion: 0,
  });

  // Create global custom template row with drafting status
  await deps.database.insert(customTemplate).values({
    id: templateId,
    customerId: null,
    visibility: 'global',
    publicationStatus: 'drafting',
    templateDraftSiteId: draftSiteId,
    name: input.name,
    tagline: input.tagline ?? '',
    styleKit,
    siteState,
    assetManifest: [],
  });

  return { templateId, draftSiteId };
}

export async function publishCuratedTemplateDraft(
  deps: CuratedAdminDeps,
  templateId: string,
): Promise<{ templateId: string; status: 'published' }> {
  const custodianId = requireTemplateAssetCustodianCustomerId(deps.env);

  const rows = await deps.database
    .select({
      id: customTemplate.id,
      templateDraftSiteId: customTemplate.templateDraftSiteId,
    })
    .from(customTemplate)
    .where(and(eq(customTemplate.id, templateId), eq(customTemplate.visibility, 'global')))
    .limit(1);

  const tmpl = rows[0];
  if (!tmpl) {
    throw new Error('curated-template-admin: template not found');
  }

  if (!tmpl.templateDraftSiteId) {
    throw new Error('curated-template-admin: template has no associated draft site');
  }

  const siteRows = await deps.database
    .select({
      styleKit: site.styleKit,
      editableState: site.editableState,
    })
    .from(site)
    .where(and(eq(site.id, tmpl.templateDraftSiteId), eq(site.customerId, custodianId)))
    .limit(1);

  const draftSite = siteRows[0];
  if (!draftSite) {
    throw new Error('curated-template-admin: draft site not found or access denied');
  }

  const validation = validateEditableSite(draftSite.editableState);
  if (!validation.valid) {
    throw new Error(`curated-template-admin: draft site state invalid: ${validation.errors.join(', ')}`);
  }

  const manifest = await buildAssetManifest(deps.database, custodianId, draftSite.editableState);

  await deps.database
    .update(customTemplate)
    .set({
      styleKit: draftSite.styleKit,
      siteState: draftSite.editableState,
      assetManifest: manifest,
      publicationStatus: 'published',
      updatedAt: new Date(),
    })
    .where(eq(customTemplate.id, templateId));

  return { templateId, status: 'published' };
}

export async function unpublishCuratedTemplate(
  deps: Pick<CuratedAdminDeps, 'database'>,
  templateId: string,
): Promise<{ templateId: string; status: 'unpublished' }> {
  const rows = await deps.database
    .select({ id: customTemplate.id })
    .from(customTemplate)
    .where(and(eq(customTemplate.id, templateId), eq(customTemplate.visibility, 'global')))
    .limit(1);

  if (rows.length === 0) {
    throw new Error('curated-template-admin: template not found');
  }

  await deps.database
    .update(customTemplate)
    .set({
      publicationStatus: 'unpublished',
      updatedAt: new Date(),
    })
    .where(eq(customTemplate.id, templateId));

  return { templateId, status: 'unpublished' };
}

export interface RenameCuratedTemplateInput {
  name: string;
  tagline?: string | undefined;
}

export async function renameCuratedTemplate(
  deps: Pick<CuratedAdminDeps, 'database'>,
  templateId: string,
  input: RenameCuratedTemplateInput,
): Promise<void> {
  if (!input.name?.trim()) {
    throw new Error('curated-template-admin: name is required');
  }

  const rows = await deps.database
    .select({ id: customTemplate.id })
    .from(customTemplate)
    .where(and(eq(customTemplate.id, templateId), eq(customTemplate.visibility, 'global')))
    .limit(1);

  if (rows.length === 0) {
    throw new Error('curated-template-admin: template not found');
  }

  await deps.database
    .update(customTemplate)
    .set({
      name: input.name,
      tagline: input.tagline ?? '',
      updatedAt: new Date(),
    })
    .where(eq(customTemplate.id, templateId));
}

export async function duplicateCuratedTemplateDraft(
  deps: CuratedAdminDeps,
  templateId: string,
): Promise<{ templateId: string; draftSiteId: string }> {
  const custodianId = requireTemplateAssetCustodianCustomerId(deps.env);

  const rows = await deps.database
    .select({
      id: customTemplate.id,
      name: customTemplate.name,
      tagline: customTemplate.tagline,
      styleKit: customTemplate.styleKit,
      siteState: customTemplate.siteState,
    })
    .from(customTemplate)
    .where(and(eq(customTemplate.id, templateId), eq(customTemplate.visibility, 'global')))
    .limit(1);

  const tmpl = rows[0];
  if (!tmpl) {
    throw new Error('curated-template-admin: template not found');
  }

  const draftSiteId = crypto.randomUUID();
  const newTemplateId = crypto.randomUUID();
  const subdomain = `template-draft-${crypto.randomUUID().slice(0, 8)}`;

  await deps.database.insert(site).values({
    id: draftSiteId,
    customerId: custodianId,
    siteKind: 'template_draft',
    name: `Draft: ${tmpl.name} (Copy)`,
    subdomain,
    styleKit: tmpl.styleKit as StyleKit,
    editableState: tmpl.siteState,
    publishedVersion: 0,
  });

  await deps.database.insert(customTemplate).values({
    id: newTemplateId,
    customerId: null,
    visibility: 'global',
    publicationStatus: 'drafting',
    templateDraftSiteId: draftSiteId,
    name: `${tmpl.name} (Copy)`,
    tagline: tmpl.tagline,
    styleKit: tmpl.styleKit,
    siteState: tmpl.siteState,
    assetManifest: [],
  });

  return { templateId: newTemplateId, draftSiteId };
}

export async function deleteCuratedTemplate(
  deps: Pick<CuratedAdminDeps, 'database'>,
  templateId: string,
  confirmationName: string,
): Promise<void> {
  const rows = await deps.database
    .select({
      id: customTemplate.id,
      name: customTemplate.name,
      publicationStatus: customTemplate.publicationStatus,
      templateDraftSiteId: customTemplate.templateDraftSiteId,
    })
    .from(customTemplate)
    .where(and(eq(customTemplate.id, templateId), eq(customTemplate.visibility, 'global')))
    .limit(1);

  const tmpl = rows[0];
  if (!tmpl) {
    throw new Error('curated-template-admin: template not found');
  }

  if (tmpl.publicationStatus === 'published') {
    throw new Error('curated-template-admin: cannot delete a published curated template; unpublish it first');
  }

  if (confirmationName !== tmpl.name) {
    throw new Error('curated-template-admin: confirmation name must match template name');
  }

  const draftSiteId = tmpl.templateDraftSiteId;

  // Delete the customTemplate first due to FK templateDraftSiteId -> site.id
  await deps.database.delete(customTemplate).where(eq(customTemplate.id, templateId));

  // Explicitly delete the draft site row afterward
  if (draftSiteId) {
    await deps.database.delete(site).where(eq(site.id, draftSiteId));
  }
}
