// src/custom-domain/delete.ts
//
// DELETE /api/sites/:siteId/domains/:hostname — Owner removes a hostname.
//
// Flow:
//   1. Verify the site exists and belongs to the current Owner.
//   2. Find the customDomain row by (siteId, hostname).
//   3. Call Cloudflare to delete the hostname registration. A CF 404 is
//      tolerated (the row points at an already-gone CF record), because
//      the Owner's intent is "remove this" regardless of CF state.
//   4. Delete the DB row.
//
// We do NOT delete the row before CF acknowledges, because a CF failure
// here would leave us with an orphan CF hostname record. Order is CF first,
// then DB — failing on CF leaves the row visible and the Owner can retry.
// Per ADR 0005 decision 3 the binding hostname→site is permanent until
// explicit DELETE, so the only graceful failure here is "couldn't reach CF;
// try again."

import { and, eq } from 'drizzle-orm';
import type { CfHostnamesClient } from './cf-api.js';
import { CfApiError } from './cf-api.js';
import type { Db } from '../db/client.js';
import { customDomain } from '../db/schema.js';

export interface DeleteDeps {
  db: Db;
  cf: CfHostnamesClient;
}

export interface DeleteInput {
  siteId: string;
  customerId: string;
  hostname: string;
}

export type DeleteResult =
  | { status: 'deleted'; cfHostnameId: string; cfApiInvoked: boolean }
  | { status: 'not_found' }
  | { status: 'cf_rejected'; httpStatus: number; errors: { code: number; message: string }[] };

export async function deleteCustomDomain(
  deps: DeleteDeps,
  input: DeleteInput,
): Promise<DeleteResult> {
  // Defensive normalisation — Owner may have copy-pasted with mixed case
  // from the dashboard URL.
  const hostname = input.hostname.trim().toLowerCase();
  if (hostname.length === 0) {
    return { status: 'not_found' };
  }

  // Scope the row by both siteId AND customer ownership of the site. We
  // pull customer ownership via a join-by-subquery on the site table.
  const { site } = await import('../db/schema.js');
  const rows = await deps.db
    .select({
      id: customDomain.id,
      cfHostnameId: customDomain.cfHostnameId,
      hostname: customDomain.hostname,
    })
    .from(customDomain)
    .innerJoin(site, eq(customDomain.siteId, site.id))
    .where(
      and(
        eq(customDomain.siteId, input.siteId),
        eq(customDomain.hostname, hostname),
        eq(site.customerId, input.customerId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { status: 'not_found' };
  }

  let cfApiInvoked = false;
  try {
    await deps.cf.delete(row.cfHostnameId);
    cfApiInvoked = true;
  } catch (err) {
    if (err instanceof CfApiError) {
      // CF already lost the record — the Owner's intent is fulfilled by
      // dropping the row. Any other status code is a real failure.
      if (err.status === 404) {
        cfApiInvoked = true;
      } else {
        return { status: 'cf_rejected', httpStatus: err.status, errors: err.errors };
      }
    } else {
      throw err;
    }
  }

  await deps.db.delete(customDomain).where(eq(customDomain.id, row.id));
  return { status: 'deleted', cfHostnameId: row.cfHostnameId, cfApiInvoked };
}
