// src/addons/emit.ts

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { addonEntitlement, site, siteAddon } from '../db/schema';
import { getAddon } from './registry';

export async function emitAddonHeadScripts(
  database: Db,
  siteId: string,
): Promise<string> {
  const rows = await database
    .select({
      addonId: siteAddon.addonId,
      config: siteAddon.config,
      customerId: site.customerId,
    })
    .from(siteAddon)
    .innerJoin(site, eq(siteAddon.siteId, site.id))
    .where(and(eq(siteAddon.siteId, siteId), eq(siteAddon.enabled, true)));

  if (rows.length === 0) return '';

  const customerId = rows[0]!.customerId;

  const entitlements = await database
    .select({ addonId: addonEntitlement.addonId })
    .from(addonEntitlement)
    .where(eq(addonEntitlement.customerId, customerId));

  const entitled = new Set(entitlements.map((e) => e.addonId));

  const parts: string[] = [];
  for (const row of rows) {
    if (!entitled.has(row.addonId)) continue;
    const addon = getAddon(row.addonId);
    if (!addon) continue;
    const html = addon.emitHeadScripts(row.config);
    if (html) parts.push(html);
  }

  return parts.join('\n');
}
