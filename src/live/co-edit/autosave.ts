// src/live/co-edit/autosave.ts
//
// Debounced projection-to-Postgres autosave. Consumed only inside SiteRoom.
//
// Flow:
//   1. `attachAutosaveToDO(doc, env, siteId)` wires `attachAutosave` (from
//      `src/canvas/yjs-projection`) to a persistence function that updates
//      `site.editableState` for the given site id.
//   2. On every Yjs update — whether local-from-decode or remote-from-wire —
//      the projection is debounced 750ms (default), then the projected
//      `EditableSite` is written via Drizzle.
//   3. The detach function returned can be called from `webSocketClose` /
//      `alarm()` to cancel pending timers when the DO winds down.
//
// Failure posture (per the project's "fail loudly" rule):
//   * A Postgres write rejection logs with the site id and the inferred
//     pages-count so it's debuggable from logs alone — and re-throws on
//     the inner promise. We do NOT swallow; the outer `attachAutosave` logs
//     the projected-state context and re-throws asynchronously so the host
//     runtime surfaces the failed write.
//   * No retry, no exponential backoff, no shadow-write — the next edit
//     re-triggers the debounce, so a transient outage self-heals when
//     connectivity returns. A persistent outage surfaces as escalating
//     log noise rather than a silent stale state.

import { eq } from 'drizzle-orm';
import * as Y from 'yjs';

import type { EditableSite } from '../../canvas/schema.js';
import { attachAutosave } from '../../canvas/yjs-projection.js';
import { db, type Db } from '../../db/client.js';
import { site } from '../../db/schema.js';

export interface AutosaveEnv {
  DATABASE_URL: string;
}

export interface AttachAutosaveToDOOptions {
  /** Debounce window forwarded to `attachAutosave`. Defaults to 750ms. */
  debounceMs?: number;
  /**
   * Override the persistence sink. Default writes to Postgres `site.editableState`.
   * Tests / smokes inject a stub here to capture the persisted payload.
   */
  onPersist?: (state: EditableSite) => void | Promise<void>;
  /**
   * Override the db builder. Defaults to the project's Drizzle/Neon client.
   * Smokes pass a stub `Db` so no network round-trip is required.
   */
  dbFactory?: (env: AutosaveEnv) => Db;
}

/**
 * Wire a debounced Postgres write for the given Y.Doc. Returns a detach
 * function that unsubscribes the autosave observer and clears any pending
 * timer.
 *
 * The persistence implementation runs `decodeYDoc(doc)` (already done inside
 * `attachAutosave`) to project the doc into JSON, then issues an
 * `UPDATE site SET editable_state = $1 WHERE id = $2`.
 */
export function attachAutosaveToDO(
  doc: Y.Doc,
  env: AutosaveEnv,
  siteId: string,
  options?: AttachAutosaveToDOOptions,
): () => void {
  const persist = options?.onPersist ?? defaultPostgresPersist(env, siteId, options?.dbFactory);
  return attachAutosave(doc, persist, { debounceMs: options?.debounceMs ?? 750 });
}

function defaultPostgresPersist(
  env: AutosaveEnv,
  siteId: string,
  dbFactory?: (env: AutosaveEnv) => Db,
): (state: EditableSite) => Promise<void> {
  return async (state: EditableSite) => {
    const client = (dbFactory ?? db)(env);
    try {
      await client
        .update(site)
        .set({ editableState: state, updatedAt: new Date() })
        .where(eq(site.id, siteId));
    } catch (error) {
      // Loud failure — surface the site id and a page-count hint so log
      // grep finds it without needing to dig into the doc bytes.
      console.error(
        `[co-edit:autosave] persist failed for site=${siteId} pages=${String(state.pages.length)}`,
        error,
      );
      throw error;
    }
  };
}
