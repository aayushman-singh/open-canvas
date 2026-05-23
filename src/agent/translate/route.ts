// src/agent/translate/route.ts
//
// Wishlist #24 — Hono router for the auto-translate batch op.
//
//   POST /:siteId/translate
//     Body: { from: string, to: string, mode?: 'replace' | 'sibling' }
//     Returns: { ops, preview, changes }
//
// The router is intentionally THIN — it does not own auth, DB writes, or
// site loading. The main thread mounts this router under
// `/api/sites/:siteId/translate` and provides the loaded `editableState`
// plus the translator instance via a Hono `Variables` binding:
//
//   import translateRouter from './agent/translate/route';
//   app.route('/api/sites/:siteId/translate', translateRouter);
//
// Wiring the editable state + translator is the main thread's concern; the
// router reads them off the context via `c.get('state')` / `c.get('translator')`.
// This keeps the translate subsystem free of `drizzle-orm` and `@clerk/backend`
// imports — exactly the rule the brief lays out under "Files forbidden".
//
// The translateSite function is also exported as a plain async function
// (re-exported from `./apply`) so #23's chat agent can dispatch to it
// directly without going through HTTP.

import { Hono } from 'hono';
import type { CanvasSiteState } from '../../canvas/schema.js';
import { translateSite, type TranslateMode, type TranslateResult } from './apply.js';
import type { Translator } from './llm.js';

export interface TranslateRouteVariables {
  /** The freshly-loaded editable state for the site. The main thread sets this. */
  translateSiteState: CanvasSiteState;
  /** The translator the route will call. The main thread sets this. */
  translateTranslator: Translator;
}

type RouteEnv = { Variables: TranslateRouteVariables };

const router = new Hono<RouteEnv>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMode(value: unknown): value is TranslateMode {
  return value === 'replace' || value === 'sibling';
}

router.post('/', async (c) => {
  // Pull state + translator from the request scope. The main thread is
  // responsible for setting these; missing values are a programmer error and
  // surface as a loud 500.
  const state = c.get('translateSiteState');
  const translator = c.get('translateTranslator');
  if (state === undefined || translator === undefined) {
    return c.json(
      {
        error:
          'translate route reached without translateSiteState / translateTranslator — main thread must populate Hono variables before delegating',
      },
      500,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json body' }, 400);
  }
  if (!isRecord(body)) {
    return c.json({ error: 'body must be a JSON object' }, 400);
  }
  if (typeof body.from !== 'string' || body.from.length === 0) {
    return c.json({ error: 'body.from must be a non-empty string' }, 400);
  }
  if (typeof body.to !== 'string' || body.to.length === 0) {
    return c.json({ error: 'body.to must be a non-empty string' }, 400);
  }
  // Default mode is sibling (non-destructive) per the brief.
  const rawMode: unknown = body.mode;
  let mode: TranslateMode;
  if (rawMode === undefined) {
    mode = 'sibling';
  } else if (isMode(rawMode)) {
    mode = rawMode;
  } else {
    return c.json(
      { error: `body.mode must be 'replace' or 'sibling' (got ${JSON.stringify(rawMode)})` },
      400,
    );
  }

  let result: TranslateResult;
  try {
    result = await translateSite(state, { from: body.from, to: body.to, mode }, translator);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `translate failed: ${message}` }, 500);
  }

  return c.json({
    ops: result.ops,
    preview: result.preview,
    changes: result.changes,
  });
});

export default router;

// Re-exports so callers (chat agent, smoke) can use the pure function directly.
export { translateSite } from './apply.js';
export type { TranslateOptions, TranslateResult, TranslateOp, TranslateMode } from './apply.js';
export type { Translator, TranslateBatchInput } from './llm.js';
