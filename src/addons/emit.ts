// src/addons/emit.ts

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { addonEntitlement, site, siteAddon } from '../db/schema';
import { getAddon } from './registry';

async function fetchEntitledSiteAddons(database: Db, siteId: string) {
  const rows = await database
    .select({
      addonId: siteAddon.addonId,
      config: siteAddon.config,
      customerId: site.customerId,
    })
    .from(siteAddon)
    .innerJoin(site, eq(siteAddon.siteId, site.id))
    .where(and(eq(siteAddon.siteId, siteId), eq(siteAddon.enabled, true)));

  if (rows.length === 0) return [];

  const customerId = rows[0]!.customerId;

  const entitlements = await database
    .select({ addonId: addonEntitlement.addonId })
    .from(addonEntitlement)
    .where(eq(addonEntitlement.customerId, customerId));

  const entitled = new Set(entitlements.map((e) => e.addonId));

  return rows.filter((row) => entitled.has(row.addonId));
}

export async function emitAddonHeadScripts(
  database: Db,
  siteId: string,
): Promise<string> {
  const rows = await fetchEntitledSiteAddons(database, siteId);

  const parts: string[] = [];
  for (const row of rows) {
    const addon = getAddon(row.addonId);
    // REVIEW: silent `continue` on unknown addon breaks the all-or-nothing posture. If a siteAddon row references an id not in the registry, that's data corruption — should throw or log loudly, not silently skip.
    if (!addon) continue;
    const html = addon.emitHeadScripts(row.config);
    if (html) parts.push(html);
  }

  return parts.join('\n');
}

export async function emitAddonBodyScripts(
  database: Db,
  siteId: string,
): Promise<string> {
  // REVIEW: `fetchEntitledSiteAddons` is called again here — two identical DB roundtrips per publish. Consider hoisting the fetch to the caller and passing the result to both `emitAddonHeadScripts` and `emitAddonBodyScripts`, or merge them into a single `emitAddonScripts` returning `{ head: string; body: string }`.
  const rows = await fetchEntitledSiteAddons(database, siteId);

  const parts: string[] = [];
  for (const row of rows) {
    const addon = getAddon(row.addonId);
    if (!addon) continue;
    if (!addon.emitBodyScripts) continue;
    const html = addon.emitBodyScripts(row.config);
    if (html) parts.push(html);
  }

  return parts.join('\n');
}
