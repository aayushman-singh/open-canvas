// src/live/co-edit/awareness.ts
//
// Awareness layer — presence (cursor, selection, name colour) over a
// Yjs `Y.Doc`. Wraps `y-protocols/awareness` so the rest of the co-edit
// subsystem never touches that submodule directly.
//
// Protocol shape on the wire (mirrors the `AwarenessUpdateEnvelope` defined
// in `src/live/site-room.ts`):
//
//   { type: 'awareness-update', update: base64(Uint8Array) }
//
// The encoded `Uint8Array` is the output of
// `awarenessProtocol.encodeAwarenessUpdate(awareness, [clientID, …])`. The
// peer that receives it calls `applyAwarenessUpdate` on its own Awareness
// instance.
//
// Why a separate channel from `y-update`? Awareness state is **non-persistent**
// — cursor positions, selections, presence names. We deliberately don't
// merge it into the Yjs document because:
//   1. The autosave projection would persist transient cursor state into
//      Postgres, which is pure noise.
//   2. The Awareness protocol carries timestamps + a 30-second outdated
//      timeout, so peers age out cleanly when a socket closes uncleanly.
//   3. Version-history snapshots stay free of presence data.

import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

/**
 * Local presence state shape published into the Awareness map. Free-form
 * by Yjs convention; we anchor a documented shape here so editor + presence
 * UI agree on field names without re-discovering them per call site.
 *
 * `clientId` is implicit (Awareness keyes states by `Y.Doc.clientID`); the
 * fields below are everything ELSE a peer needs to render presence for us.
 */
export interface PresenceState {
  /** Display name for the presence pill / cursor label. */
  name: string;
  /** CSS colour token used for cursor + selection outline. */
  color: string;
  /** Optional caret position — `null` when the peer has no active cursor. */
  cursor?: { sectionId: string; elementId: string; offset: number } | null;
  /** Optional selection range — `null` when nothing is selected. */
  selection?: { sectionId: string; elementId: string } | null;
}

/**
 * Create a new Awareness instance bound to a doc. Thin wrapper so callers
 * never import `y-protocols/awareness` directly.
 */
export function createAwareness(doc: Y.Doc): Awareness {
  return new Awareness(doc);
}

/**
 * Encode an awareness-update payload for the given client ids. Pass the
 * single local clientID to broadcast the local state; pass the list of
 * every known clientID to ship a full snapshot to a freshly-connected peer.
 */
export function encodeAwareness(awareness: Awareness, clientIds: number[]): Uint8Array {
  return encodeAwarenessUpdate(awareness, clientIds);
}

/**
 * Apply an inbound awareness-update payload. The `origin` argument is
 * forwarded to Awareness observers so peers can distinguish wire-arrived
 * from local-set state.
 */
export function applyAwareness(
  awareness: Awareness,
  update: Uint8Array,
  origin: unknown,
): void {
  applyAwarenessUpdate(awareness, update, origin);
}

/**
 * Set the local presence state. Bumps the Awareness clock + emits a
 * change event observed by `awareness.on('update', …)` for fan-out.
 */
export function setLocalPresence(awareness: Awareness, state: PresenceState | null): void {
  awareness.setLocalState(state);
}

/**
 * Snapshot every known peer's presence state as a plain map. Used by UI
 * code that wants to render the current presence indicator without
 * subscribing to the Awareness `change` event.
 */
export function snapshotPresence(awareness: Awareness): Map<number, PresenceState> {
  const out = new Map<number, PresenceState>();
  for (const [clientId, raw] of awareness.getStates()) {
    if (raw === null) continue;
    if (typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.name !== 'string' || typeof candidate.color !== 'string') continue;
    const presence: PresenceState = { name: candidate.name, color: candidate.color };
    // `cursor` and `selection` are optional; we only attach when the shape
    // matches so a malformed peer can't poison the local map.
    if (candidate.cursor !== undefined) {
      presence.cursor = candidate.cursor as NonNullable<PresenceState['cursor']> | null;
    }
    if (candidate.selection !== undefined) {
      presence.selection = candidate.selection as NonNullable<PresenceState['selection']> | null;
    }
    out.set(clientId, presence);
  }
  return out;
}

// Re-export the Awareness type so callers can annotate variables without
// pulling y-protocols into their import surface.
export type { Awareness };
