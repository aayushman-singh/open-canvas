// src/editor-client/persist.ts
//
// ADR 0058 Phase 2m — persist + undo/redo cluster.
// canvas-client.ts:2440-2608 carries the inline twin; retires on Phase 3
// cutover. Behavioural parity is pinned by the existing editor smokes
// against the production inline path; chat-session-race:smoke guards the
// debounce timing seam this module preserves.
//
// Eight functions live here:
//
//   - scheduleSave(ctx) — debounced 500ms POST to /sites/<id>. When the
//     Yjs co-edit channel is attached, the local mutation projects into
//     the Y.Doc and the DO autosaves; otherwise this path drives the
//     HTTP PUT. Always pre-captures the pre-mutation state for undo so
//     captureForUndo is the load-bearing op even when no save fires.
//
//   - disableUndoPersistence(ctx, reason, error) — switch the undo
//     localStorage writes off after a failure. Idempotent — first call
//     logs the structured error and surfaces a status line; subsequent
//     calls no-op so a write loop doesn't spam the console.
//
//   - persistUndo(ctx) — serialise undoStack + redoStack into the
//     per-site localStorage key. Capped at UNDO_PERSIST_MAX entries so a
//     busy session can't blow the per-origin quota.
//
//   - initUndo(ctx) — restore undoStack + redoStack from localStorage at
//     boot. Only adopts persisted state when its top-of-stack JSON
//     matches the just-loaded server state exactly; any divergence
//     (cross-device edit, server migration) seeds fresh with the current
//     state so undo can't destroy invisible content.
//
//   - captureForUndo(ctx) — push state snapshot, debounced to 0ms so a
//     burst of mutations collapses into one snapshot. Skips while
//     undo/redo is replaying (undoRedoing flag) so the restore itself
//     doesn't grow the stack.
//
//   - flushPendingUndoCapture(ctx) — flush the debounced capture
//     immediately. undo/redo call this first so a fast Ctrl+Z lands the
//     pre-undo snapshot before the pop.
//
//   - undo(ctx) — pop the top of undoStack, restore via structuredClone,
//     push the previous state onto redoStack. Status flashes "Undo" /
//     "Nothing to undo" so the keyboard shortcut has visible feedback
//     regardless of which UI surface holds focus.
//
//   - redo(ctx) — symmetric inverse of undo.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';
import type { EditableSite } from '../canvas/schema.js';

// Snapshot shape mirrors the inline IIFE: undoStack entries are deep
// clones of `state` only — no selection ids, no derived UI state. The
// inline path uses `structuredClone(state)` for both push and restore,
// so a snapshot IS an EditableSite at a moment in time.
export type SiteSnapshot = EditableSite;

// Stack caps. The in-memory cap (UNDO_MAX) is generous; the persisted
// cap (UNDO_PERSIST_MAX) is tighter to keep a busy session under the
// per-origin localStorage quota. Mirror the inline twin's constants
// exactly — changing either here without the inline twin will desync
// after Phase 3 cutover.
const UNDO_MAX = 60;
const UNDO_PERSIST_MAX = 20;

function undoStorageKey(siteId: string): string {
  return 'oc:undo:' + siteId;
}

export function scheduleSave(ctx: EditorContext): void {
  captureForUndo(ctx);
  // Two save paths, picked by whether the Yjs co-edit channel is attached:
  //   1. coEditConnection present: every mutation projects into the Y.Doc
  //      and the DO autosaves to Postgres. Status reads "Synced".
  //   2. coEditConnection absent (boot before WS attach, or co-edit not
  //      enabled for this Owner): debounced 500ms HTTP PUT. Status reads
  //      "Saved" on success.
  const coEditSent = ctx.coEditSync();
  if (ctx.coEditConnection) {
    if (coEditSent) {
      ctx.setStatus('Synced', 'ok');
    } else {
      ctx.setStatus('Co-edit disconnected; changes not saved', 'error');
    }
    return;
  }
  if (ctx.saveTimer) clearTimeout(ctx.saveTimer);
  ctx.saveTimer = setTimeout(() => {
    ctx.saveTimer = null;
    void ctx.saveStateNow();
  }, 500);
}

export function disableUndoPersistence(
  ctx: EditorContext,
  reason: string,
  error: unknown,
): void {
  if (ctx.undoPersistenceFailed) return;
  ctx.undoPersistenceFailed = true;
  console.error('[opencanvas-undo] persist failed', {
    siteId: ctx.siteId,
    storageKey: undoStorageKey(ctx.siteId),
    reason: reason,
    error: error,
  });
  ctx.setStatus('Undo history could not be saved across reloads', 'error');
}

export function persistUndo(ctx: EditorContext): void {
  if (ctx.undoPersistenceFailed) return;
  try {
    if (typeof localStorage === 'undefined') {
      disableUndoPersistence(ctx, 'localStorage unavailable', null);
      return;
    }
    const truncStack =
      ctx.undoStack.length > UNDO_PERSIST_MAX
        ? ctx.undoStack.slice(ctx.undoStack.length - UNDO_PERSIST_MAX)
        : ctx.undoStack;
    const truncRedo =
      ctx.redoStack.length > UNDO_PERSIST_MAX
        ? ctx.redoStack.slice(ctx.redoStack.length - UNDO_PERSIST_MAX)
        : ctx.redoStack;
    const payload = JSON.stringify({ stack: truncStack, redo: truncRedo });
    localStorage.setItem(undoStorageKey(ctx.siteId), payload);
  } catch (err) {
    disableUndoPersistence(ctx, 'localStorage write failed', err);
    try {
      localStorage.removeItem(undoStorageKey(ctx.siteId));
    } catch (cleanupErr) {
      console.error('[opencanvas-undo] cleanup failed', {
        siteId: ctx.siteId,
        storageKey: undoStorageKey(ctx.siteId),
        error: cleanupErr,
      });
    }
  }
}

export function initUndo(ctx: EditorContext): void {
  if (!ctx.state) return;
  let restored = false;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(undoStorageKey(ctx.siteId));
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (
          parsed &&
          typeof parsed === 'object' &&
          'stack' in parsed &&
          'redo' in parsed &&
          Array.isArray((parsed as { stack: unknown }).stack) &&
          Array.isArray((parsed as { redo: unknown }).redo)
        ) {
          const stack = (parsed as { stack: SiteSnapshot[] }).stack;
          const redo = (parsed as { redo: SiteSnapshot[] }).redo;
          // Only restore if the persisted top-of-stack equals the
          // server-loaded state. Any divergence (someone edited from
          // another device, server backfilled a migration, etc.) means
          // our stored history is stale and would let undo destroy
          // content the user can't see.
          const top = stack[stack.length - 1];
          if (top && JSON.stringify(top) === JSON.stringify(ctx.state)) {
            ctx.undoStack = stack;
            ctx.redoStack = redo;
            restored = true;
          }
        }
      }
    }
  } catch (_) {
    // Corrupted JSON or storage error — fall back to a fresh seed.
    restored = false;
  }
  if (!restored) {
    ctx.undoStack = [structuredClone(ctx.state)];
    ctx.redoStack = [];
    persistUndo(ctx);
  }
}

export function captureForUndo(ctx: EditorContext): void {
  if (ctx.undoRedoing || !ctx.state) return;
  if (ctx.undoTimer) clearTimeout(ctx.undoTimer);
  ctx.undoTimer = setTimeout(function () {
    ctx.undoTimer = null;
    flushPendingUndoCapture(ctx);
  }, 0);
}

export function flushPendingUndoCapture(ctx: EditorContext): void {
  if (ctx.undoTimer) {
    clearTimeout(ctx.undoTimer);
    ctx.undoTimer = null;
  }
  if (!ctx.state) return;
  const snap = structuredClone(ctx.state);
  ctx.undoStack.push(snap);
  if (ctx.undoStack.length > UNDO_MAX) ctx.undoStack.shift();
  ctx.redoStack = [];
  persistUndo(ctx);
}

export function undo(ctx: EditorContext): void {
  // Visible no-op feedback: the keyboard handler runs globally on window,
  // so Ctrl+Z fires regardless of which UI surface has focus. Without a
  // status flash, a no-op undo looks identical to a non-firing shortcut,
  // which reads as "Ctrl+Z only works when something is selected."
  if (!ctx.state) {
    ctx.setStatus('Nothing to undo');
    return;
  }
  // Flush any pending debounced capture so a fast Ctrl+Z (e.g. delete →
  // immediate undo) sees the post-mutation state on the stack and can
  // pop back to the snapshot the next undo expects.
  if (ctx.undoTimer) flushPendingUndoCapture(ctx);
  if (ctx.undoStack.length <= 1) {
    ctx.setStatus('Nothing to undo');
    return;
  }
  ctx.undoRedoing = true;
  ctx.redoStack.push(structuredClone(ctx.state));
  ctx.undoStack.pop();
  ctx.state = structuredClone(ctx.undoStack[ctx.undoStack.length - 1]!);
  ctx.renderAll();
  ctx.scheduleSave();
  persistUndo(ctx);
  ctx.undoRedoing = false;
  ctx.setStatus('Undo', 'ok');
}

export function redo(ctx: EditorContext): void {
  if (!ctx.state) {
    ctx.setStatus('Nothing to redo');
    return;
  }
  if (ctx.undoTimer) flushPendingUndoCapture(ctx);
  if (ctx.redoStack.length === 0) {
    ctx.setStatus('Nothing to redo');
    return;
  }
  ctx.undoRedoing = true;
  ctx.undoStack.push(structuredClone(ctx.state));
  ctx.state = structuredClone(ctx.redoStack.pop()!);
  ctx.renderAll();
  ctx.scheduleSave();
  persistUndo(ctx);
  ctx.undoRedoing = false;
  ctx.setStatus('Redo', 'ok');
}
