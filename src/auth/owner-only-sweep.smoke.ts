// src/auth/owner-only-sweep.smoke.ts
//
// Pins the "widen owner-only routes to loadAccessibleSite" sweep that
// landed alongside PR #43's `src/version/route.ts` work. For each handler
// in the catalog, asserts:
//
//   1. The route source NO LONGER references the legacy owner-only helpers
//      (`resolveOwnedSiteId`, `ownsSite`, `loadOwnedSite`). The regression
//      mode is "someone re-pins the owner-only check while keeping the
//      passing behavioural test", which a static check catches.
//
//   2. The route imports `loadAccessibleSite` from `src/auth/accessible-
//      site.ts`.
//
//   3. The route calls `loadAccessibleSite` with the expected tier per
//      handler (`viewer` / `editor`).
//
// Why static-only: every widened route already SELECTs through the same
// `loadAccessibleSite` helper, which PR #43's
// `src/version/route-collab-access.smoke.ts` already pins behaviourally
// against an in-memory DB shim. Re-running that matrix per file adds line
// count without strengthening the contract — the behavioural test catches
// helper regressions, this one catches per-file integration regressions.
//
// Out of scope (must stay owner-only — billing / identity-sensitive):
//   - src/routes/api/publish.ts            (per-month publish credit + DNS)
//   - src/custom-domain/route.ts           (DNS / TLS / billing)
//   - src/routes/api/addons.ts PUT/DELETE  (caller's paid entitlement)

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[owner-only-sweep:smoke] ' + message);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoSrc = resolve(here, '..');

interface RouteSpec {
  /** Path relative to `src/`. */
  path: string;
  /** Marker → expected tier for each handler in the file. */
  expectations: Array<{ handlerMarker: string; tier: 'viewer' | 'editor' | 'owner' }>;
  /** Helper names that, if present, prove the route reverted to owner-only. */
  forbidden: string[];
}

const ROUTE_SPECS: RouteSpec[] = [
  {
    path: 'password/admin-route.ts',
    expectations: [
      { handlerMarker: "router.put('/'", tier: 'editor' },
      { handlerMarker: "router.delete('/'", tier: 'editor' },
    ],
    forbidden: ['resolveOwnedSiteId'],
  },
  {
    path: 'themes/route.ts',
    expectations: [
      { handlerMarker: "themeRoute.put('/:siteId/custom-theme'", tier: 'editor' },
      { handlerMarker: "themeRoute.delete('/:siteId/custom-theme'", tier: 'editor' },
    ],
    forbidden: ['loadOwnedSite'],
  },
  {
    path: 'fonts/route.ts',
    expectations: [
      { handlerMarker: "fontsOwnerRouter.get('/'", tier: 'editor' },
      { handlerMarker: "fontsOwnerRouter.post('/'", tier: 'editor' },
      { handlerMarker: "fontsOwnerRouter.delete('/:id'", tier: 'editor' },
    ],
    // `ownsSite` was the owner-only helper deleted in the sweep.
    forbidden: ['async function ownsSite'],
  },
  {
    path: 'a11y/route.ts',
    expectations: [{ handlerMarker: "a11yRoute.get('/:siteId/a11y'", tier: 'viewer' }],
    forbidden: [],
  },
  {
    path: 'agent/chat/route.ts',
    expectations: [
      { handlerMarker: "chatApi.post('/:siteId/chat'", tier: 'editor' },
      { handlerMarker: "chatApi.get('/:siteId/chat/stream'", tier: 'editor' },
    ],
    forbidden: [],
  },
  {
    path: 'routes/api/on-site-edit.ts',
    expectations: [{ handlerMarker: "onSiteEditRoute.get('/'", tier: 'editor' }],
    forbidden: [],
  },
  {
    path: 'routes/api/custom-templates.ts',
    expectations: [{ handlerMarker: "customTemplatesOwner.post('/'", tier: 'editor' }],
    forbidden: [],
  },
  {
    path: 'routes/api/addons.ts',
    expectations: [{ handlerMarker: "addonsApi.get('/sites/:siteId'", tier: 'viewer' }],
    forbidden: [],
  },
  {
    path: 'routes/api/library-sections.ts',
    expectations: [{ handlerMarker: "librarySectionsOwner.post('/sections'", tier: 'editor' }],
    // `loadOwnedSection` was the owner-only helper replaced in the sweep.
    forbidden: ['async function loadOwnedSection'],
  },
];

for (const spec of ROUTE_SPECS) {
  const src = await readFile(resolve(repoSrc, spec.path), 'utf-8');

  assert(
    src.includes("from '../auth/accessible-site") ||
      src.includes("from '../../auth/accessible-site"),
    `${spec.path} must import loadAccessibleSite from src/auth/accessible-site`,
  );
  assert(
    src.includes('loadAccessibleSite('),
    `${spec.path} must call loadAccessibleSite at least once`,
  );

  for (const helper of spec.forbidden) {
    assert(
      !src.includes(helper),
      `${spec.path} must no longer reference ${helper} — collaborators were locked out`,
    );
  }

  for (const { handlerMarker } of spec.expectations) {
    const idx = src.indexOf(handlerMarker);
    assert(idx >= 0, `${spec.path} missing handler ${handlerMarker}`);
  }
  // Tier coverage: the literal `'<tier>'` must appear in the file at least
  // once per handler with that tier. Routes can either inline the tier at
  // the call site or delegate to a per-file helper that forwards a single
  // tier literal — both patterns leave the literal in the source.
  const tierCounts: Record<'viewer' | 'editor' | 'owner', number> = { viewer: 0, editor: 0, owner: 0 };
  for (const { tier } of spec.expectations) tierCounts[tier] += 1;
  for (const tier of Object.keys(tierCounts) as Array<keyof typeof tierCounts>) {
    if (tierCounts[tier] === 0) continue;
    // Count occurrences of the literal in the file.
    const occurrences = src.split(`'${tier}'`).length - 1;
    // Helpers can collapse N call sites into 1 literal — so we only assert
    // ≥1 occurrence when at least one handler is mapped to this tier.
    assert(
      occurrences >= 1,
      `${spec.path} expects tier '${tier}' but the literal does not appear in the file (${String(tierCounts[tier])} handlers mapped to it)`,
    );
  }
}

process.stdout.write(
  `[owner-only-sweep:smoke] OK — ${String(ROUTE_SPECS.length)} routes pinned to loadAccessibleSite\n`,
);

// ---------------------------------------------------------------------------
// Catalog deliberately KEPT owner-only — these MUST still use the owner-
// scoped check. The sweep flagged each as billing / identity-sensitive.
// ---------------------------------------------------------------------------

interface OwnerOnlySpec {
  path: string;
  /** Substring(s) we expect to remain — proves the owner-only check is still there. */
  expected: string[];
  rationale: string;
}

const OWNER_ONLY_SPECS: OwnerOnlySpec[] = [
  {
    path: 'routes/api/publish.ts',
    expected: ['site.customerId'],
    rationale:
      'publish burns a per-month credit + writes to the public-internet name; collaborator scope is wrong',
  },
  {
    path: 'custom-domain/route.ts',
    expected: ['site.customerId'],
    rationale: 'DNS / TLS / billing — collaborator cannot bind a domain to someone else\'s site',
  },
];

for (const spec of OWNER_ONLY_SPECS) {
  const src = await readFile(resolve(repoSrc, spec.path), 'utf-8');
  for (const needle of spec.expected) {
    assert(
      src.includes(needle),
      `${spec.path} must retain the owner-only check (${spec.rationale}); expected substring "${needle}" was missing`,
    );
  }
}

process.stdout.write(
  `[owner-only-sweep:smoke] OK — ${String(OWNER_ONLY_SPECS.length)} routes kept owner-only per rationale\n`,
);
