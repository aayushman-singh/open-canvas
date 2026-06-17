// src/editor-client/co-edit.ts
//
// ADR 0058 Phase 2p.b — co-edit / presence integration cluster.
// canvas-client.ts:12801-13308 (the "Real-time co-edit via Yjs" block +
// the "Co-edit presence" sub-block: coEditSync, loadPresenceIdentity,
// presenceLayer + remoteCursors state, ensurePresenceLayer, findCaretRect,
// localPresenceTextOffset, repaintRemoteCursors, the pointer-publish loop
// (publishPointer / flushPointer / schedulePointer), the
// selectionchange-publish loop (flushPublishLocalPresence /
// schedulePublishLocalPresence), and attachCoEdit with its websocket
// handlers + Yjs onRemoteState / onRemotePresence subscribers) moves into
// this module as the Phase 3 cutover destination.
//
// Behavioural parity is pinned by the existing editor smokes against the
// production inline path; this module ships no sibling smoke (the bundle
// stays buildable but is dead code until createEditor is fleshed out).
//
// Six functions live here as public exports:
//
//   - coEditSyncImpl(ctx) — project ctx.state into ctx.coEditConnection's
//     Y.Doc. Returns true when the socket is open and the projection went
//     out; false when the channel is missing (boot before WS attach) or
//     unhealthy (mid-reconnect). The persist cluster (Phase 2m) reads the
//     boolean to choose between "Synced" and "Co-edit disconnected"
//     status lines. Bound onto ctx.coEditSync at boot; the existing
//     ctx.coEditSync declaration (Phase 2m) carries the signature.
//
//   - loadPresenceIdentity(displayName) — resolve the local editor's
//     {name, color} from (in order) the server-injected display name,
//     localStorage "opencanvas-presence-name", and a uuid-prefix fallback.
//     Persists the generated uuid to localStorage so the same browser
//     reads as the same peer across reloads. Takes the display name as a
//     direct parameter (not ctx) because it's a pure resolver — Phase 3
//     boot will call it with ctx.presenceDisplayName and stash the result
//     into ctx.localPresence.
//
//   - repaintRemoteCursorsImpl(ctx) — walk ctx.remoteCursors and reposition
//     every peer's caret + label against the current viewport. Point-based
//     (Figma-style mouse follow) cursors map world→screen via the camera
//     module's worldToScreen helper; offset-based (text caret) cursors
//     resolve their elementId + offset to a Range via findCaretRect. Peers
//     whose anchor element vanished hide; everyone else updates in place.
//     Bound onto ctx.repaintRemoteCursors inside attachCoEditImpl so the
//     camera module's applyCameraTransform typeof-check sees a live
//     function from first transform onwards.
//
//   - schedulePublishLocalPresence(ctx) — selectionchange handler. Schedules
//     a coalesced setPresence call so the local caret broadcasts to peers,
//     throttled to one publish per POINTER_PUBLISH_INTERVAL_MS and
//     suppressed entirely when ctx.remotePeerCount is zero. Called from
//     the inline `document.addEventListener("selectionchange", …)`
//     registration in canvas-client.ts; createEditor (Phase 3) will move
//     the listener registration into this module's wire-up.
//
//   - handleViewportMousemove(ctx, ev) — mousemove handler. Updates
//     ctx.lastWorldPoint via the camera's screenToWorld and schedules a
//     coalesced pointer publish. Called from the inline
//     `window.addEventListener("mousemove", …)` registration in
//     canvas-client.ts; same Phase 3 deferred-wiring note as
//     schedulePublishLocalPresence above.
//
//   - attachCoEditImpl(ctx) — boot-time entry point. No-ops when the
//     co-edit bundle global is missing (smoke / kill-switch). Otherwise
//     opens the WebSocket via window.__opencanvasCoEdit.connectCoEdit
//     with a custom websocketFactory that drives the reconnect-counter
//     UI (status line + give-up threshold + destroy on cap), wires
//     onRemoteState (replace ctx.state + render) and onRemotePresence
//     (refresh the presence pill + diff the remoteCursors set), assigns
//     the connection to ctx.coEditConnection, and registers a
//     beforeunload listener that tears the socket down cleanly. Binds
//     ctx.repaintRemoteCursors = () => repaintRemoteCursorsImpl(ctx) so
//     the camera module's typeof-check stops short-circuiting.
//
// Nine helpers stay private to this module:
//
//   - PRESENCE_PALETTE / POINTER_PUBLISH_INTERVAL_MS — constants
//     internal to the cluster. Not on editor-constants.ts because they're
//     not referenced anywhere else.
//   - ensurePresenceLayer(ctx) — lazy-create the document.body-attached
//     `.opencanvas-presence-layer` div that holds every remote caret +
//     label. Idempotent via the .isConnected probe.
//   - findCaretRect(elementId, offset) — resolve a peer's {elementId,
//     offset} to a viewport rect by walking text nodes in the wrapper
//     until cumulative length covers offset, then collapsing a Range.
//     Falls back to the wrapper's bounding box when the element is
//     non-text or the offset is stale (common during fast remote edits).
//   - localPresenceTextOffset(editable, anchorNode, anchorOffset, elementId)
//     — invert the {elementId, offset} encoding for outbound presence
//     updates. Counts characters between editable's start and the
//     anchor via Range.toString().length.
//   - publishPointer(ctx) — assemble + send the pointer presence payload
//     (point + optional anchor cursor + selection). Called from
//     flushPointer after the rAF/throttle window elapses.
//   - flushPointer(ctx) — clear the throttle bookkeeping and invoke
//     publishPointer.
//   - schedulePointer(ctx) — debounce wrapper. Suppresses outbound when
//     no peers are in the room (ctx.remotePeerCount === 0) so an empty
//     room doesn't burn DO requests on cursor moves nobody can see.
//   - flushPublishLocalPresence(ctx) — selectionchange equivalent of
//     publishPointer. Same throttle, same no-peer skip.
//
// Inline event-listener registrations (window.scroll/resize →
// repaintRemoteCursors, window.mousemove → handleViewportMousemove,
// document.selectionchange → schedulePublishLocalPresence, window.
// beforeunload → conn.destroy) stay inline in canvas-client.ts — Phase 2
// never touches the IIFE. They will move into createEditor at Phase 3
// cutover.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type {
  CoEditContext,
  DomContext,
  EditorContext,
  RemoteCursorEntry,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import { applyCustomKitCss } from './custom-kit-css.js';
import {
  COEDIT_RECONNECT_BASE_DELAY_MS,
  COEDIT_RECONNECT_MAX_ATTEMPTS,
  COEDIT_RECONNECT_MAX_DELAY_MS,
} from './editor-constants.js';
import { cssEscape } from './css-escape.js';
import { screenToWorld, worldToScreen } from './render.js';

// ADR 0064 — sync verb reads through StateContext to project ctx.state
// into the Yjs doc, and asserts CoEditContext for the connection +
// socket health flag. No DOM, no selection, no render fan-out.
export type CoEditSyncContext = CoEditContext & StateContext;

// ADR 0064 — every outbound presence publish (pointer + selectionchange
// loops, the immediate flush, and the snapshot builder) reads the same
// surface: CoEditContext for the connection + throttle bookkeeping +
// identity, plus `editingCollectionTemplate` (non-canonical, the live
// template-edit pin folded into every awareness write per ADR 0065 F1).
export type CoEditPresencePublishContext = CoEditContext &
  Pick<EditorContext, 'editingCollectionTemplate'>;

// ADR 0064 — remote-cursor repaint walks ctx.remoteCursors and projects
// each peer's world point through worldToScreen, which needs `viewport`
// (DomContext) plus `camera` (non-canonical, only the projection helpers
// touch it).
export type CoEditRepaintContext = CoEditContext &
  DomContext &
  Pick<EditorContext, 'camera'>;

// ADR 0064 — viewport mousemove reads the pointer location, projects it
// to world coords via screenToWorld (viewport + camera), updates the
// CoEdit publish bookkeeping, and forwards to the throttled pointer
// publish (CoEditPresencePublishContext).
export type CoEditMousemoveContext = CoEditPresencePublishContext &
  DomContext &
  Pick<EditorContext, 'camera'>;

// ADR 0064 — attach is the boot-time entry point and touches every
// surface in the module: the publish/repaint contexts above, the sync
// verb, selection + render for the onRemoteState callback, persistence
// identity for the websocket URL, plus three non-canonical fields
// (`saveTimer`, `editingSnapshot`, `editingCollectionTemplate`) the
// callback bookkeeping reads directly off ctx.
export type AttachCoEditContext = CoEditSyncContext &
  CoEditPresencePublishContext &
  CoEditRepaintContext &
  SelectionContext &
  RenderContext &
  StatusEmitterContext &
  Pick<EditorContext, 'siteId' | 'saveTimer' | 'editingSnapshot'>;

// -- Internal constants ------------------------------------------------

const PRESENCE_PALETTE = [
  '#ff6600',
  '#0066ff',
  '#22aa55',
  '#cc2266',
  '#aa44dd',
  '#dd9900',
  '#00aaaa',
  '#6677aa',
];

// Mousemove fires up to ~120 Hz on a modern trackpad. The previous code
// coalesced to rAF (~60 Hz) which still meant every editing session
// pushed ~3.5k awareness updates per minute of cursor movement — each
// one a billable Durable Object request. Cap to 10 Hz instead; that's
// smooth enough for remote-cursor tracking (Figma is similar) and a
// 6× cut to DO request volume during normal editing.
const POINTER_PUBLISH_INTERVAL_MS = 100;

// -- Collection template edit presence map (ADR 0065 F1-multi-collab) -

/**
 * ADR 0065 F1-multi-collab-presence — reduce an awareness peer map into
 * `<collectionId, [peerName, …]>` groups. Pure function over the
 * awareness shape: no DOM, no ctx, easy to smoke. Peers with falsy
 * `editingCollectionTemplateId` are skipped (they are not in
 * template-edit mode). Peer names are pushed in awareness-iteration
 * order, which matches the order onRemotePresence fires them.
 *
 * `localUserId` is the local Owner's Clerk user id when available.
 * Peers carrying the same `userId` are skipped — that "peer" is the
 * Owner editing in a second tab, not a distinct collaborator. Without
 * this dedupe, the indicator would show "1 other editing: Aayushman"
 * to an Owner who has two tabs of the same site open.
 *
 * Falls back to per-clientID counting when the userId is missing on
 * either side so legacy / unauthenticated peers still surface.
 */
export function computeCollectionTemplateEditors(
  peers: Map<
    number,
    {
      name: string;
      userId?: string;
      editingCollectionTemplateId?: string | null;
    }
  >,
  localUserId: string | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  peers.forEach(function (peer) {
    if (!peer) return;
    const target = peer.editingCollectionTemplateId;
    if (typeof target !== 'string' || target.length === 0) return;
    // Dedupe: a peer carrying the same userId as the local Owner is the
    // Owner's second tab. Skip — only DISTINCT collaborators surface.
    if (
      localUserId !== null &&
      localUserId.length > 0 &&
      typeof peer.userId === 'string' &&
      peer.userId === localUserId
    ) {
      return;
    }
    const name =
      typeof peer.name === 'string' && peer.name.length > 0 ? peer.name : 'Another collaborator';
    let list = out.get(target);
    if (!list) {
      list = [];
      out.set(target, list);
    }
    list.push(name);
  });
  return out;
}

/**
 * Shallow equality on the `<collectionId, peerNames[]>` shape. Cheap diff
 * that lets onRemotePresence skip the inspector re-render when nothing
 * about the editor membership actually shifted (the cursor-publish
 * cadence drives onRemotePresence orders of magnitude more often than
 * template-edit mode toggles).
 */
export function collectionTemplateEditorsEqual(
  a: Map<string, string[]>,
  b: Map<string, string[]>,
): boolean {
  if (a.size !== b.size) return false;
  let equal = true;
  a.forEach(function (namesA, collectionId) {
    if (!equal) return;
    const namesB = b.get(collectionId);
    if (!namesB || namesA.length !== namesB.length) {
      equal = false;
      return;
    }
    for (let i = 0; i < namesA.length; i++) {
      if (namesA[i] !== namesB[i]) {
        equal = false;
        return;
      }
    }
  });
  return equal;
}

// -- coEditSync --------------------------------------------------------

export function coEditSyncImpl(ctx: CoEditSyncContext): boolean {
  if (ctx.coEditConnection && ctx.state) {
    ctx.coEditConnection.applyLocalState(ctx.state);
    return ctx.coEditSocketOpen;
  }
  return false;
}

// -- Presence identity -------------------------------------------------

// The connector only ships name/color when we call setPresence — the
// count pill stayed at 1 until both initialPresence and a caret-
// following republish loop existed.
//
// Name resolution order (first non-empty wins):
//   1. presenceDisplayName — server-injected customer display name /
//      email (resolved by the editor route from the customer row tied
//      to the current Clerk session or invite acceptance).
//   2. localStorage "opencanvas-presence-name" — operator-overridable label
//      (no UI ships yet but the slot is reserved for a profile setting).
//   3. "Editor " + 4-char uuid prefix — final fallback so anonymous
//      sessions still get a stable handle.
export function loadPresenceIdentity(presenceDisplayName: string): {
  name: string;
  color: string;
} {
  let id: string | null = null;
  try {
    id = window.localStorage.getItem('opencanvas-presence-id');
  } catch (_) {
    /* localStorage unavailable */
  }
  if (!id) {
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : String(Math.random()).slice(2) + String(Date.now());
    try {
      window.localStorage.setItem('opencanvas-presence-id', id);
    } catch (_) {
      /* localStorage unavailable */
    }
  }
  let name: string | null = null;
  if (typeof presenceDisplayName === 'string' && presenceDisplayName.length > 0) {
    name = presenceDisplayName;
  }
  if (!name) {
    try {
      name = window.localStorage.getItem('opencanvas-presence-name');
    } catch (_) {
      /* localStorage unavailable */
    }
  }
  if (!name) name = 'Editor ' + String(id).slice(0, 4);
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) | 0;
  const color = PRESENCE_PALETTE[Math.abs(sum) % PRESENCE_PALETTE.length]!;
  return { name: name, color: color };
}

// -- Remote-cursor rendering ------------------------------------------

function ensurePresenceLayer(ctx: CoEditContext): HTMLElement {
  if (ctx.presenceLayer && ctx.presenceLayer.isConnected) return ctx.presenceLayer;
  const layer = document.createElement('div');
  layer.className = 'opencanvas-presence-layer';
  document.body.appendChild(layer);
  ctx.presenceLayer = layer;
  return layer;
}

// Resolve a peer's {elementId, offset} to a viewport rect by walking
// the wrapper's text nodes until the cumulative length covers the
// offset, then collapsing a Range there. Falls back to the wrapper's
// bounding box when the element is non-text or the offset is stale
// (a common case during remote edits the peer hasn't caught up to).
function findCaretRect(
  elementId: string | undefined | null,
  offset: number | undefined,
): { left: number; top: number; height: number } | null {
  if (!elementId) return null;
  const wrapper = document.querySelector(
    '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
  );
  if (!wrapper) return null;
  const editable = wrapper.querySelector('[contenteditable]') || wrapper;
  if (typeof offset === 'number' && editable && editable.firstChild) {
    try {
      const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      let consumed = 0;
      while (node) {
        const len = node.nodeValue ? node.nodeValue.length : 0;
        if (consumed + len >= offset) {
          const range = document.createRange();
          range.setStart(node, Math.max(0, Math.min(len, offset - consumed)));
          range.collapse(true);
          const rects = range.getClientRects();
          if (rects && rects[0] && rects[0].height > 0) {
            return { left: rects[0].left, top: rects[0].top, height: rects[0].height };
          }
          break;
        }
        consumed += len;
        node = walker.nextNode();
      }
    } catch (error) {
      console.warn('[co-edit:presence] remote caret rect failed', {
        error: error,
        elementId: elementId,
        offset: offset,
      });
    }
  }
  const bb = wrapper.getBoundingClientRect();
  if (bb.height <= 0) return null;
  return { left: bb.left, top: bb.top, height: Math.min(bb.height, 22) };
}

function localPresenceTextOffset(
  editable: Element | null,
  anchorNode: Node | null,
  anchorOffset: number,
  elementId: string,
): number | null {
  if (!editable || !anchorNode) return null;
  const anchorRoot = anchorNode.nodeType === 1 ? (anchorNode as Element) : anchorNode.parentElement;
  if (!anchorRoot || !editable.contains(anchorRoot)) return null;
  try {
    const range = document.createRange();
    const maxOffset =
      anchorNode.nodeType === 3
        ? anchorNode.nodeValue
          ? anchorNode.nodeValue.length
          : 0
        : anchorNode.childNodes.length;
    const boundedOffset = Math.max(0, Math.min(maxOffset, anchorOffset | 0));
    range.setStart(editable, 0);
    range.setEnd(anchorNode, boundedOffset);
    return range.toString().length;
  } catch (error) {
    console.warn('[co-edit:presence] local text offset failed', {
      error: error,
      elementId: elementId,
      anchorNodeType: anchorNode.nodeType,
      anchorOffset: anchorOffset,
    });
    return null;
  }
}

export function repaintRemoteCursorsImpl(ctx: CoEditRepaintContext): void {
  if (!ctx.presenceLayer) return;
  ctx.remoteCursors.forEach(function (entry: RemoteCursorEntry) {
    // Free-floating pointer position wins when present (Figma-style
    // mouse follow). Fall back to the text-caret resolver when the
    // peer is editing text but the mouse isn't over the canvas — the
    // operator still wants to see WHERE in the doc the peer is typing.
    const point = entry.cursor && entry.cursor.point;
    if (point && typeof point.x === 'number' && typeof point.y === 'number') {
      const screen = worldToScreen(ctx, point.x, point.y);
      entry.caret.style.display = '';
      entry.label.style.display = '';
      entry.caret.style.left = screen.x + 'px';
      entry.caret.style.top = screen.y + 'px';
      entry.caret.style.height = '18px';
      entry.label.style.left = screen.x + 'px';
      entry.label.style.top = screen.y + 'px';
      return;
    }
    const rect = entry.cursor ? findCaretRect(entry.cursor.elementId, entry.cursor.offset) : null;
    if (!rect) {
      entry.caret.style.display = 'none';
      entry.label.style.display = 'none';
      return;
    }
    entry.caret.style.display = '';
    entry.label.style.display = '';
    entry.caret.style.left = rect.left + 'px';
    entry.caret.style.top = rect.top + 'px';
    entry.caret.style.height = rect.height + 'px';
    entry.label.style.left = rect.left + 'px';
    entry.label.style.top = rect.top + 'px';
  });
}

// -- Local presence snapshot builder (single source of truth) ----------

/**
 * ADR 0065 F2-followup — build a fresh local presence snapshot from
 * `ctx`. The shape this helper covers (name, color, userId, and the
 * F1-multi-collab-presence `editingCollectionTemplateId` pin) is read
 * LIVE from ctx, so a caller resolving the function at socket open
 * picks up the Owner's current template-edit mode regardless of how
 * many reconnects have happened since attach.
 *
 * The single non-smoke caller is `attachCoEditImpl`, which passes a
 * thunk over this helper to the connector's `initialPresence`. The
 * connector invokes the thunk at every open (including reconnect) so
 * the stale-capture bug fixed here can never reappear — the only way
 * to ship a stale value is to inline a captured object in place of the
 * thunk, which would be reviewable.
 *
 * The publish-loop sites (`publishPointer`, `flushPublishLocalPresence`)
 * do NOT route through this helper because they layer live DOM /
 * pointer state on top — `window.getSelection()` for the caret anchor,
 * `ctx.lastWorldPoint` for the Figma-style pointer trail. The
 * `cursor` / `selection` fields here are intentionally `null`; those
 * loops still inline the same `editingCollectionTemplateId` read
 * against `ctx.editingCollectionTemplate` so the pin round-trips on
 * every awareness write.
 *
 * Returns `null` when local presence identity hasn't loaded yet (boot
 * race). The connector's open handler treats `null` as "skip the
 * initial push", matching the CLAUDE.md no-fallback rule — we don't
 * ship a guess; we ship nothing until the identity is ready.
 *
 * Exported for the reopen-presence smoke — the only external caller.
 * The pure-function shape (ctx in, snapshot out) lets the smoke mutate
 * ctx between calls and assert the snapshot tracks the mutation,
 * without needing a real WebSocket.
 */
export function buildLocalPresenceSnapshot(ctx: CoEditPresencePublishContext): {
  name: string;
  color: string;
  cursor: null;
  selection: null;
  editingCollectionTemplateId: string | null;
  userId?: string;
} | null {
  if (!ctx.localPresence) return null;
  const snapshot: {
    name: string;
    color: string;
    cursor: null;
    selection: null;
    editingCollectionTemplateId: string | null;
    userId?: string;
  } = {
    name: ctx.localPresence.name,
    color: ctx.localPresence.color,
    cursor: null,
    selection: null,
    // Read FRESH from ctx — this function is called at every socket open
    // (including reconnect), so the pin reflects the Owner's current
    // template-edit mode rather than the boot-time snapshot.
    editingCollectionTemplateId: ctx.editingCollectionTemplate
      ? ctx.editingCollectionTemplate.collectionId
      : null,
  };
  if (ctx.presenceUserId) snapshot.userId = ctx.presenceUserId;
  return snapshot;
}

// -- Outbound pointer presence (Figma-style mouse follow) -------------

// Figma-style mouse-follow: every mousemove over the canvas viewport
// publishes the pointer's WORLD-space coordinates so remote peers see
// it tracking like a real cursor. World coords (not screen pixels)
// because each peer applies its own camera transform — the same
// pointer must render correctly across different zoom levels.

function publishPointer(ctx: CoEditPresencePublishContext): void {
  ctx.pointerPublishPending = false;
  if (!ctx.coEditConnection || !ctx.lastWorldPoint || !ctx.localPresence) return;
  // Reuse the selection-derived cursor anchor if there is one — text
  // editors still benefit from the offset-aware caret while the
  // pointer trail rides on top. Strictly free-floating (no anchor)
  // is the common case for someone mousing around an inactive area.
  const sel = window.getSelection();
  let anchorCursor: { sectionId: string; elementId: string; offset?: number } | null = null;
  if (sel && sel.anchorNode) {
    const anchorEl =
      sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement;
    const wrapper = anchorEl ? anchorEl.closest('[data-opencanvas-element]') : null;
    const sectionNode = anchorEl ? anchorEl.closest('[data-opencanvas-section]') : null;
    if (wrapper && sectionNode) {
      const elementId = wrapper.getAttribute('data-opencanvas-element');
      const sectionId = sectionNode.getAttribute('data-opencanvas-section');
      if (elementId && sectionId) {
        const editable = wrapper.querySelector('[contenteditable]') || wrapper;
        const textOffset = localPresenceTextOffset(
          editable,
          sel.anchorNode,
          sel.anchorOffset,
          elementId,
        );
        anchorCursor = { sectionId: sectionId, elementId: elementId };
        if (typeof textOffset === 'number') anchorCursor.offset = textOffset;
      }
    }
  }
  // PresenceState's declared cursor shape is { sectionId, elementId,
  // offset? } — but every peer also reads cursor.point if present (the
  // Figma-style free-floating pointer trail). The inline twin writes a
  // richer cursor than PresenceState declares; the awareness layer
  // accepts arbitrary record fields so the extra `point` round-trips
  // cleanly. Cast through unknown so the under-typed receive shape
  // doesn't reject the over-shipped send shape.
  const cursor = { point: { x: ctx.lastWorldPoint.x, y: ctx.lastWorldPoint.y } } as {
    point: { x: number; y: number };
    sectionId?: string;
    elementId?: string;
    offset?: number;
  };
  if (anchorCursor) {
    cursor.sectionId = anchorCursor.sectionId;
    cursor.elementId = anchorCursor.elementId;
    if (typeof anchorCursor.offset === 'number') cursor.offset = anchorCursor.offset;
  }
  ctx.coEditConnection.setPresence(
    Object.assign(
      {
        name: ctx.localPresence.name,
        color: ctx.localPresence.color,
        cursor: cursor as unknown as { sectionId: string; elementId: string; offset?: number },
        selection: anchorCursor
          ? { sectionId: anchorCursor.sectionId, elementId: anchorCursor.elementId }
          : null,
        // ADR 0065 F1-multi-collab-presence — fold the active template-edit
        // pin into every awareness write so peers always see the live value.
        // Bundling it here avoids a separate setPresence channel; the
        // protocol fans the whole record out atomically and the receive
        // side reads `editingCollectionTemplateId` from the same map.
        editingCollectionTemplateId: ctx.editingCollectionTemplate
          ? ctx.editingCollectionTemplate.collectionId
          : null,
      },
      ctx.presenceUserId ? { userId: ctx.presenceUserId } : {},
    ),
  );
}

function flushPointer(ctx: CoEditPresencePublishContext): void {
  ctx.pointerPublishTimerId = null;
  ctx.pointerPublishPending = false;
  ctx.pointerPublishLastAtMs = Date.now();
  publishPointer(ctx);
}

function schedulePointer(ctx: CoEditPresencePublishContext): void {
  if (ctx.pointerPublishPending) return;
  // Skip outbound publishes when nobody else can see the cursor. Local
  // self-cursor is rendered straight from the live mouse position, not
  // from awareness, so suppressing this round-trip costs nothing
  // visible to the operator. remotePeerCount is set inside the
  // onRemotePresence callback below.
  if (ctx.remotePeerCount === 0) return;
  ctx.pointerPublishPending = true;
  const now = Date.now();
  const elapsed = now - ctx.pointerPublishLastAtMs;
  const delay = elapsed >= POINTER_PUBLISH_INTERVAL_MS ? 0 : POINTER_PUBLISH_INTERVAL_MS - elapsed;
  ctx.pointerPublishTimerId = setTimeout(() => flushPointer(ctx), delay);
}

export function handleViewportMousemove(ctx: CoEditMousemoveContext, ev: MouseEvent): void {
  if (typeof ev.clientX !== 'number') return;
  if (!ctx.viewport) return;
  const target = ev.target;
  if (!(target instanceof Element) || !ctx.viewport.contains(target)) return;
  ctx.lastWorldPoint = screenToWorld(ctx, ev.clientX, ev.clientY);
  schedulePointer(ctx);
}

// -- Outbound selection presence (text caret broadcast) --------------

// Coalesce selectionchange (fires per keystroke and per mouse-tick
// during drag-select). Same throttle + no-peer skip as the pointer
// publish above — keystroke typing alone fires this 5-10×/sec, and
// each publish is a billable DO request.

function flushPublishLocalPresence(ctx: CoEditPresencePublishContext): void {
  ctx.presencePublishPending = false;
  ctx.presencePublishLastAtMs = Date.now();
  if (!ctx.coEditConnection || !ctx.localPresence) return;
  const sel = window.getSelection();
  let cursor: { sectionId: string; elementId: string; offset?: number } | null = null;
  if (sel && sel.anchorNode) {
    const anchorEl =
      sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement;
    const wrapper = anchorEl ? anchorEl.closest('[data-opencanvas-element]') : null;
    const sectionNode = anchorEl ? anchorEl.closest('[data-opencanvas-section]') : null;
    if (wrapper && sectionNode) {
      const elementId = wrapper.getAttribute('data-opencanvas-element');
      const sectionId = sectionNode.getAttribute('data-opencanvas-section');
      if (elementId && sectionId) {
        const editable = wrapper.querySelector('[contenteditable]') || wrapper;
        const textOffset = localPresenceTextOffset(
          editable,
          sel.anchorNode,
          sel.anchorOffset,
          elementId,
        );
        cursor = {
          sectionId: sectionId,
          elementId: elementId,
        };
        if (typeof textOffset === 'number') cursor.offset = textOffset;
      }
    }
  }
  ctx.coEditConnection.setPresence(
    Object.assign(
      {
        name: ctx.localPresence.name,
        color: ctx.localPresence.color,
        cursor: cursor,
        selection: cursor ? { sectionId: cursor.sectionId, elementId: cursor.elementId } : null,
        // ADR 0065 F1-multi-collab-presence — same rationale as in
        // publishPointer: fold the active template-edit pin into every
        // awareness write so peers see the live value as soon as the
        // selectionchange-driven loop fires.
        editingCollectionTemplateId: ctx.editingCollectionTemplate
          ? ctx.editingCollectionTemplate.collectionId
          : null,
      },
      ctx.presenceUserId ? { userId: ctx.presenceUserId } : {},
    ),
  );
}

/**
 * ADR 0065 F1-multi-collab-presence — flush the local presence payload
 * immediately, BYPASSING the throttle gate AND the `remotePeerCount === 0`
 * skip. Called by the Collection template-edit enter/exit verbs so the
 * editingCollectionTemplateId field on the local awareness state reflects
 * the Owner's actual mode within one tick — both for peers already in the
 * room (so the "<peer> is also editing" indicator lights up without
 * waiting for the next cursor move) AND for peers that join later (so
 * their awareness snapshot picks up the live value).
 *
 * The no-peer skip is intentional in the cursor-tracking path (mousemove +
 * selectionchange fire orders of magnitude more often than peer arrivals,
 * and skipping the DO request when nobody can see saves billable writes),
 * but the template-edit toggle is a discrete, rare event — the per-edit
 * DO cost is one write, regardless of who is listening. Bypassing the
 * gate keeps the local awareness state truthful for a future peer.
 */
export function publishLocalPresenceImmediate(ctx: CoEditPresencePublishContext): void {
  if (!ctx.coEditConnection || !ctx.localPresence) return;
  flushPublishLocalPresence(ctx);
}

export function schedulePublishLocalPresence(ctx: CoEditPresencePublishContext): void {
  if (ctx.presencePublishPending) return;
  if (ctx.remotePeerCount === 0) return;
  ctx.presencePublishPending = true;
  const now = Date.now();
  const elapsed = now - ctx.presencePublishLastAtMs;
  const delay = elapsed >= POINTER_PUBLISH_INTERVAL_MS ? 0 : POINTER_PUBLISH_INTERVAL_MS - elapsed;
  setTimeout(() => flushPublishLocalPresence(ctx), delay);
}

// -- WebSocket boot ----------------------------------------------------

type CoEditPresenceArg = Parameters<
  NonNullable<EditorContext['coEditConnection']>['setPresence']
>[0];

interface OpencanvasCoEditGlobal {
  connectCoEdit: (
    siteId: string,
    initialState: EditorContext['state'],
    options: {
      websocketUrl: string;
      reconnectDelayMs: number;
      reconnectMaxDelayMs: number;
      /**
       * ADR 0065 F2-followup — function form so the connector resolves the
       * snapshot AT EVERY OPEN (including reconnect), not from a stale
       * capture taken at attach time. A literal value here would freeze
       * `editingCollectionTemplateId` at its boot-time `null` and silently
       * overwrite the live pin after every socket reopen.
       */
      initialPresence: () => CoEditPresenceArg;
      websocketFactory: (url: string) => WebSocket;
    },
  ) => NonNullable<EditorContext['coEditConnection']>;
}

declare global {
  interface Window {
    __opencanvasCoEdit?: OpencanvasCoEditGlobal;
  }
}

export function attachCoEditImpl(ctx: AttachCoEditContext): boolean {
  if (
    typeof window.__opencanvasCoEdit === 'undefined' ||
    !window.__opencanvasCoEdit ||
    typeof window.__opencanvasCoEdit.connectCoEdit !== 'function'
  ) {
    // Cannot throw here or the rest of editor boot dies; surface loudly
    // via persistent error toast + console so the Owner sees that saves
    // are local-only and concurrent editing is silently disabled.
    ctx.setStatus('Co-edit unavailable — please reload the page', 'error');
    console.error(
      '[co-edit] window.__opencanvasCoEdit not registered — CO_EDIT_BUNDLE failed to load or was blocked. Concurrent editing is disabled until reload.',
    );
    return false;
  }

  // Bind the repaint hook before the first remote presence event fires so
  // the camera module's applyCameraTransform typeof-check sees a live
  // function from this point onwards. Phase 3 boot wires this; Phase 2
  // never touches the IIFE.
  ctx.repaintRemoteCursors = () => repaintRemoteCursorsImpl(ctx);

  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl =
    scheme +
    '//' +
    location.host +
    '/__live?siteId=' +
    encodeURIComponent(ctx.siteId) +
    (ctx.wsToken ? '&wsToken=' + encodeURIComponent(ctx.wsToken) : '');

  // Consecutive failed reconnect attempts since the last successful open.
  // The "open" handler resets this so a long-stable connection that later
  // drops restarts retries at the base delay rather than the last cap.
  // When this crosses COEDIT_RECONNECT_MAX_ATTEMPTS, we stop retrying and
  // call destroy() on the connection so the underlying client.ts no longer
  // schedules further reconnects; the user must reload to recover.
  let reconnectAttempt = 0;
  let givenUp = false;

  ctx.coEditSocketOpen = false;
  const conn = window.__opencanvasCoEdit.connectCoEdit(ctx.siteId, ctx.state, {
    websocketUrl: wsUrl,
    // Mirrors src/live/co-edit/client.ts defaults so the curve advertised
    // here matches what the connector actually applies. Passed explicitly
    // (instead of relying on defaults) so the editor host's reconnect
    // behaviour is self-documenting at this call site.
    reconnectDelayMs: COEDIT_RECONNECT_BASE_DELAY_MS,
    reconnectMaxDelayMs: COEDIT_RECONNECT_MAX_DELAY_MS,
    // Without this, the awareness filter on the receive side drops every
    // peer (name/color required) — the "N editing" pill stays at 1 and
    // remote-cursor rendering has nothing to draw.
    //
    // ADR 0065 F2-followup — pass a THUNK, not a captured snapshot. The
    // connector resolves the function at every socket open (including
    // reconnect). A literal value here would freeze
    // `editingCollectionTemplateId` at its boot-time `null` and silently
    // overwrite the live pin every time the WS reopens — the Owner could
    // enter template-edit mode while the socket was flapping and the
    // reopen would publish a stale `null` to every peer.
    initialPresence: () => buildLocalPresenceSnapshot(ctx),
    websocketFactory: function (url: string): WebSocket {
      const socket = new WebSocket(url);
      socket.addEventListener('open', function () {
        // Successful re-handshake — reset the attempt counter so any future
        // outage starts retries fresh instead of continuing the escalation.
        reconnectAttempt = 0;
        ctx.coEditSocketOpen = true;
        ctx.coEditSync();
        ctx.setStatus('Synced', 'ok');
      });
      socket.addEventListener('close', function () {
        ctx.coEditSocketOpen = false;
        if (givenUp) return;
        reconnectAttempt += 1;
        if (reconnectAttempt > COEDIT_RECONNECT_MAX_ATTEMPTS) {
          givenUp = true;
          // Stop the underlying client.ts reconnect loop so it doesn't keep
          // scheduling timers behind a UI that has already given up.
          if (ctx.coEditConnection) {
            try {
              ctx.coEditConnection.destroy();
            } catch (_) {
              /* noop */
            }
          }
          console.error(
            '[co-edit] reconnect gave up after ' +
              COEDIT_RECONNECT_MAX_ATTEMPTS +
              ' attempts; user must reload',
          );
          ctx.setStatus('Co-edit lost — refresh the page to reconnect', 'error');
          return;
        }
        ctx.setStatus(
          'Co-edit disconnected; reconnecting (' +
            reconnectAttempt +
            '/' +
            COEDIT_RECONNECT_MAX_ATTEMPTS +
            ')',
          'error',
        );
      });
      socket.addEventListener('error', function () {
        ctx.coEditSocketOpen = false;
        // Let the close handler drive the reconnect counter — error+close
        // both fire on some browsers and we want one increment per failure.
      });
      return socket;
    },
  });

  conn.onRemoteState(function (newState) {
    if (ctx.saveTimer) {
      clearTimeout(ctx.saveTimer);
      ctx.saveTimer = null;
    }
    ctx.state = newState;
    if (ctx.selectedElementId && !ctx.findElement(ctx.selectedElementId)) {
      ctx.selectedElementId = null;
      ctx.editingElementId = null;
      ctx.editingSnapshot = null;
    }
    if (ctx.selectedSectionId && !ctx.findSection(ctx.selectedSectionId)) {
      ctx.selectedSectionId = null;
    }
    if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
      ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
    }
    applyCustomKitCss(ctx.state);
    ctx.renderAll();
    // renderAll replaces element wrappers, invalidating cached caret
    // rects. Re-resolve them against the fresh DOM so remote cursors
    // don't lag a frame behind the new positions.
    repaintRemoteCursorsImpl(ctx);
  });

  conn.onRemotePresence(function (peers) {
    // Refresh the pointer-publish gate. peers is the Yjs awareness map
    // minus the local clientID, so .size > 0 means there's at least one
    // remote eyeball that would see our cursor.
    ctx.remotePeerCount = peers.size;
    const pill = document.querySelector('[data-opencanvas-presence]');
    const counter = document.querySelector('[data-opencanvas-presence-count]');
    if (pill && counter) {
      // Dedupe by stable user identity instead of Yjs clientID so the
      // same user editing in two tabs reads as "1 editing", not "2".
      // ctx.presenceUserId is the local editor's Clerk user id when
      // available; peers carry the same field on their presence
      // state (see initialPresence / setPresence sites above). Falls
      // back to per-client counting when the field is missing on
      // either side so legacy / unauthenticated peers don't silently
      // collapse to zero.
      const seenUsers = new Set<string>();
      let distinctClients = 0;
      peers.forEach(function (peer) {
        if (peer && typeof peer.userId === 'string' && peer.userId.length > 0) {
          seenUsers.add(peer.userId);
        } else {
          distinctClients += 1;
        }
      });
      let selfCount = 0;
      if (ctx.presenceUserId && ctx.presenceUserId.length > 0) {
        if (!seenUsers.has(ctx.presenceUserId)) selfCount = 1;
      } else {
        selfCount = 1;
      }
      counter.textContent = String(seenUsers.size + distinctClients + selfCount);
      (pill as HTMLElement).hidden = false;
    }
    // Diff the rendered cursor set against the active peers: add DOM
    // for new arrivals, refresh color/name/cursor for known peers,
    // drop nodes for departed clients.
    const presenceLayer = ensurePresenceLayer(ctx);
    const seen = new Set<number>();
    peers.forEach(function (peer, clientId) {
      seen.add(clientId);
      let entry = ctx.remoteCursors.get(clientId);
      if (!entry) {
        const caret = document.createElement('div');
        caret.className = 'opencanvas-remote-caret';
        const label = document.createElement('div');
        label.className = 'opencanvas-remote-caret-label';
        presenceLayer.appendChild(caret);
        presenceLayer.appendChild(label);
        entry = { caret: caret, label: label, cursor: null };
        ctx.remoteCursors.set(clientId, entry);
      }
      entry.caret.style.background = peer.color;
      entry.label.style.background = peer.color;
      entry.label.textContent = peer.name;
      entry.cursor = (peer.cursor as RemoteCursorEntry['cursor']) || null;
    });
    ctx.remoteCursors.forEach(function (entry, clientId) {
      if (!seen.has(clientId)) {
        entry.caret.remove();
        entry.label.remove();
        ctx.remoteCursors.delete(clientId);
      }
    });
    repaintRemoteCursorsImpl(ctx);

    // ADR 0065 F1-multi-collab-presence — rebuild
    // ctx.collectionTemplateEditors from the active peers' awareness
    // payloads. The map is refreshed in full on every presence tick
    // (cheap — O(peers) per tick, and peer count rarely exceeds single
    // digits) so a peer entering or exiting template-edit mode lands
    // within one awareness tick of the change. The inspector reads the
    // map at render time; we call renderInspector when the membership
    // actually shifted so the indicator updates without a manual
    // re-select.
    const nextEditors = computeCollectionTemplateEditors(peers, ctx.presenceUserId ?? null);
    if (!collectionTemplateEditorsEqual(ctx.collectionTemplateEditors, nextEditors)) {
      ctx.collectionTemplateEditors = nextEditors;
      ctx.renderInspector();
    }
  });

  ctx.coEditConnection = conn;

  window.addEventListener('beforeunload', function () {
    // Mark as given-up so any in-flight close event on the way out doesn't
    // try to setStatus or schedule another retry while the page is tearing
    // down. destroy() cancels the connector's pending reconnect timer too.
    givenUp = true;
    ctx.coEditSocketOpen = false;
    conn.destroy();
  });
  return true;
}
