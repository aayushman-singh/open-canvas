// src/auth/accessible-site.ts
//
// Permission helper for routes that operate on an Editable Site.
//
// A Clerk user can reach a site when they are either the owner or an accepted
// collaborator whose role satisfies the route's required role. Callers get
// `null` for both "not found" and "not allowed" so routes do not leak whether
// a site id exists.

import { and, eq, isNotNull } from 'drizzle-orm';
import type { CollaboratorRole } from '../db/schema';
import { customer, site, siteCollaborator } from '../db/schema';
import type { EditableSite, StyleKit } from '../canvas/schema';

export interface AccessibleSite {
  id: string;
  customerId: string;
  name: string;
  subdomain: string;
  styleKit: StyleKit;
  editableState: EditableSite;
  publishedVersion: number;
  accessRole: 'owner' | CollaboratorRole;
}

export type SiteAccessRole = AccessibleSite['accessRole'];
export type SiteAccessRequirement = 'viewer' | 'editor' | 'owner';

const ACCESS_RANK: Record<SiteAccessRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

const REQUIRED_ACCESS_RANK: Record<SiteAccessRequirement, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function accessRoleMeetsRequirement(
  role: SiteAccessRole,
  required: SiteAccessRequirement,
): boolean {
  return ACCESS_RANK[role] >= REQUIRED_ACCESS_RANK[required];
}

type Db = ReturnType<typeof import('../db/client').db>;

/**
 * Resolve the site visible to a Clerk user at the requested access level.
 *
 * Ownership is checked first because it is the common path and because owner
 * access is always the canonical source of `customerId` for later writes.
 *
 * `callerCustomerId` is an optimisation: clerkAuth() middleware already loaded
 * the calling customer's row, so passing its id skips an otherwise-mandatory
 * SELECT against `customer` on every site-scoped request. Falls back to the
 * SELECT when the caller doesn't have a resolved customer yet (e.g. edit-
 * token paths where the customer-from-Clerk handshake hasn't run).
 */
export async function loadAccessibleSite(
  database: Db,
  clerkUserId: string,
  siteId: string,
  requiredRole: SiteAccessRequirement = 'viewer',
  callerCustomerId?: string,
): Promise<AccessibleSite | null> {
  let customerId: string | undefined = callerCustomerId;
  if (customerId === undefined) {
    const customerRow = await database
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.clerkUserId, clerkUserId))
      .limit(1);
    customerId = customerRow[0]?.id;
  }
  if (!customerId) return null;

  // Check ownership first (cheapest path)
  const ownedRow = await database
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
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);

  if (ownedRow[0]) {
    const ownedSite = { ...ownedRow[0], accessRole: 'owner' as const };
    return accessRoleMeetsRequirement(ownedSite.accessRole, requiredRole) ? ownedSite : null;
  }

  // Check accepted collaborator
  const collabRow = await database
    .select({
      role: siteCollaborator.role,
      siteId: site.id,
      customerId: site.customerId,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
      editableState: site.editableState,
      publishedVersion: site.publishedVersion,
    })
    .from(siteCollaborator)
    .innerJoin(site, eq(site.id, siteCollaborator.siteId))
    .where(
      and(
        eq(siteCollaborator.siteId, siteId),
        eq(siteCollaborator.customerId, customerId),
        isNotNull(siteCollaborator.acceptedAt),
      ),
    )
    .limit(1);

  if (collabRow[0]) {
    const accessibleSite: AccessibleSite = {
      id: collabRow[0].siteId,
      customerId: collabRow[0].customerId,
      name: collabRow[0].name,
      subdomain: collabRow[0].subdomain,
      styleKit: collabRow[0].styleKit,
      editableState: collabRow[0].editableState,
      publishedVersion: collabRow[0].publishedVersion,
      accessRole: collabRow[0].role,
    };
    return accessRoleMeetsRequirement(accessibleSite.accessRole, requiredRole)
      ? accessibleSite
      : null;
  }

  return null;
}

export async function isOwner(
  database: Db,
  clerkUserId: string,
  siteId: string,
): Promise<boolean> {
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return false;

  const row = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);

  return row.length > 0;
}
