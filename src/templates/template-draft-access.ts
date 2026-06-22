import { and, eq } from 'drizzle-orm';
import { isTemplateSourceAdminCustomer } from '../auth/db-admin';
import { site } from '../db/schema';
import type { Customer } from '../db/schema';
import type { Db } from '../db/client';

export async function loadTemplateDraftForCurator(
  database: Db,
  customerRecord: Customer | null | undefined,
  siteId: string,
) {
  if (!customerRecord || !isTemplateSourceAdminCustomer(customerRecord)) return null;
  const rows = await database
    .select({
      id: site.id,
      customerId: site.customerId,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
      editableState: site.editableState,
      publishedVersion: site.publishedVersion,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.siteKind, 'template_draft')))
    .limit(1);
  return rows[0] ?? null;
}
