// src/addons/emit.ts
//
// Compose enabled addon scripts for a published site.
//
// Addon rows are site-scoped, but entitlement is customer-scoped. Every emit
// pass verifies that the site Owner still owns the addon before including its
// scripts. Unknown addon ids throw because silently skipping them would hide
// registry/schema drift during publish.

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
    if (!addon) {
      throw new Error(`[addons/emit] siteAddon references unknown addon id: ${row.addonId}`);
    }
    const html = addon.emitHeadScripts(row.config);
    if (html) parts.push(html);
  }

  return parts.join('\n');
}

export async function emitAddonBodyScripts(
  database: Db,
  siteId: string,
): Promise<string> {
  const rows = await fetchEntitledSiteAddons(database, siteId);

  const parts: string[] = [];
  for (const row of rows) {
    const addon = getAddon(row.addonId);
    if (!addon) {
      throw new Error(`[addons/emit] siteAddon references unknown addon id: ${row.addonId}`);
    }
    if (!addon.emitBodyScripts) continue;
    const html = addon.emitBodyScripts(row.config);
    if (html) parts.push(html);
  }

  return parts.join('\n');
}
