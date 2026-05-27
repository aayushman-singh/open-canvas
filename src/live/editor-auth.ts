import { and, eq, isNotNull, or } from 'drizzle-orm';
import { site, siteCollaborator } from '../db/schema';

type Database = ReturnType<typeof import('../db/client').db>;

export interface LiveEditorSocketAccessRow {
  siteCustomerId: string;
  collaboratorCustomerId: string | null;
}

export function canUseLiveEditorSocket(
  row: LiveEditorSocketAccessRow,
  customerId: string,
): boolean {
  return row.siteCustomerId === customerId || row.collaboratorCustomerId === customerId;
}

export async function hasLiveEditorSocketAccess(
  database: Database,
  siteId: string,
  customerId: string,
): Promise<boolean> {
  const rows = await database
    .select({
      siteCustomerId: site.customerId,
      collaboratorCustomerId: siteCollaborator.customerId,
    })
    .from(site)
    .leftJoin(
      siteCollaborator,
      and(
        eq(siteCollaborator.siteId, site.id),
        eq(siteCollaborator.customerId, customerId),
        isNotNull(siteCollaborator.acceptedAt),
      ),
    )
    .where(
      and(
        eq(site.id, siteId),
        or(eq(site.customerId, customerId), isNotNull(siteCollaborator.id)),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? canUseLiveEditorSocket(row, customerId) : false;
}
