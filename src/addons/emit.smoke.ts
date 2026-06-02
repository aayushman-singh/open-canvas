// src/addons/emit.smoke.ts
//
// Regression gate for ADR 0046 decision 2: every visitor render re-verifies
// the Addon Entitlement against `addonEntitlement` and `siteAddon` before
// returning the configured script bytes. An entitled emit returns the
// strings; an unentitled emit returns nothing.
//
// The contract this smoke pins:
//
//   1. siteAddon enabled + addonEntitlement present  → scripts emitted.
//   2. siteAddon enabled + addonEntitlement absent   → empty string.
//   3. siteAddon enabled + UNKNOWN addon id          → throws (loud, never silent).
//
// (siteAddon disabled is handled by the WHERE filter inside fetchEntitledSiteAddons
//  and does not need its own scenario here.)
//
// Run with `bun run emit:smoke`.

import { emitAddonBodyScripts, emitAddonHeadScripts } from './emit.js';
import { addonEntitlement, site, siteAddon } from '../db/schema.js';
import type { Db } from '../db/client.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[emit:smoke] ${message}`);
}

interface FakeRows {
  siteAddons: Array<{ addonId: string; config: Record<string, string>; customerId: string }>;
  entitlements: Array<{ addonId: string }>;
}

function fakeDb(rows: FakeRows): Db {
  return {
    select() {
      return {
        from(table: unknown) {
          if (table === siteAddon) {
            return {
              innerJoin(joined: unknown) {
                if (joined !== site) {
                  throw new Error(`[emit:smoke] unexpected innerJoin table: ${String(joined)}`);
                }
                return {
                  where: () => Promise.resolve(rows.siteAddons),
                };
              },
            };
          }
          if (table === addonEntitlement) {
            return {
              where: () => Promise.resolve(rows.entitlements),
            };
          }
          throw new Error(`[emit:smoke] unexpected select.from() table: ${String(table)}`);
        },
      };
    },
  } as unknown as Db;
}

const SITE_ID = 'site-smoke-1';
const CUSTOMER_ID = 'cust-smoke-1';

// ---------------------------------------------------------------------------
// Scenario 1 — entitled site addon emits its scripts.
// ---------------------------------------------------------------------------

{
  const headSnippet = '<script src="https://example.com/widget.js"></script>';
  const bodySnippet = '<script>console.log("loaded")</script>';
  const db = fakeDb({
    siteAddons: [
      {
        addonId: 'addon_custom_scripts',
        config: { headScripts: headSnippet, bodyScripts: bodySnippet },
        customerId: CUSTOMER_ID,
      },
    ],
    entitlements: [{ addonId: 'addon_custom_scripts' }],
  });

  const head = await emitAddonHeadScripts(db, SITE_ID);
  const body = await emitAddonBodyScripts(db, SITE_ID);
  assert(head === headSnippet, `entitled head emit should pass through, got: ${head}`);
  assert(body === bodySnippet, `entitled body emit should pass through, got: ${body}`);
}

// ---------------------------------------------------------------------------
// Scenario 2 — entitlement revoked, siteAddon still enabled. Emit returns
// empty. THIS IS THE LOAD-BEARING CHECK from ADR 0046 decision 2.
// ---------------------------------------------------------------------------

{
  const db = fakeDb({
    siteAddons: [
      {
        addonId: 'addon_custom_scripts',
        config: {
          headScripts: '<script>HEAD-SHOULD-NOT-LEAK</script>',
          bodyScripts: '<script>BODY-SHOULD-NOT-LEAK</script>',
        },
        customerId: CUSTOMER_ID,
      },
    ],
    entitlements: [],
  });

  const head = await emitAddonHeadScripts(db, SITE_ID);
  const body = await emitAddonBodyScripts(db, SITE_ID);
  assert(
    head === '',
    `revoked entitlement MUST suppress head scripts (ADR 0046 dec 2). got: ${head}`,
  );
  assert(
    body === '',
    `revoked entitlement MUST suppress body scripts (ADR 0046 dec 2). got: ${body}`,
  );
}

// ---------------------------------------------------------------------------
// Scenario 3 — siteAddon references an unknown addon id. Per emit.ts header
// comment ("silently skipping them would hide registry/schema drift during
// publish") this must throw, not return empty.
// ---------------------------------------------------------------------------

{
  const db = fakeDb({
    siteAddons: [
      { addonId: 'addon_does_not_exist', config: {}, customerId: CUSTOMER_ID },
    ],
    entitlements: [{ addonId: 'addon_does_not_exist' }],
  });

  let threwHead = false;
  try {
    await emitAddonHeadScripts(db, SITE_ID);
  } catch (err) {
    threwHead =
      err instanceof Error && err.message.includes('unknown addon id: addon_does_not_exist');
  }
  assert(threwHead, 'unknown addon id MUST throw from emitAddonHeadScripts');

  let threwBody = false;
  try {
    await emitAddonBodyScripts(db, SITE_ID);
  } catch (err) {
    threwBody =
      err instanceof Error && err.message.includes('unknown addon id: addon_does_not_exist');
  }
  assert(threwBody, 'unknown addon id MUST throw from emitAddonBodyScripts');
}

// ---------------------------------------------------------------------------
// Scenario 4 — site has multiple enabled addons; only the entitled subset
// emits. Defends against a future refactor that loops over siteAddons
// without consulting the entitlement set.
// ---------------------------------------------------------------------------

{
  const entitledHead = '<script src="https://entitled.example.com/x.js"></script>';
  const db = fakeDb({
    siteAddons: [
      {
        addonId: 'addon_custom_scripts',
        config: { headScripts: entitledHead },
        customerId: CUSTOMER_ID,
      },
      {
        addonId: 'addon_google_analytics',
        config: { measurementId: 'G-REVOKED' },
        customerId: CUSTOMER_ID,
      },
    ],
    // Only custom_scripts is entitled. GA's row is enabled on the site but
    // the Owner does not currently hold the entitlement.
    entitlements: [{ addonId: 'addon_custom_scripts' }],
  });

  const head = await emitAddonHeadScripts(db, SITE_ID);
  assert(
    head === entitledHead,
    `mixed-entitlement emit should include ONLY the entitled addon. got: ${head}`,
  );
  // If the filter regressed and emitted GA anyway, the GA measurementId
  // (a distinct signal that does not appear in any other addon's emit)
  // would show up in the rendered script tag.
  assert(
    !head.includes('G-REVOKED'),
    'mixed-entitlement emit must not include the revoked GA measurementId. got: ' + head,
  );
}

console.log('✓ emit smoke passed (ADR 0046 entitlement re-verification)');
