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

import type { EditorContext, RemoteCursorEntry } from './editor-context.js';
import { applyCustomKitCss } from './custom-kit-css.js';
import {
  COEDIT_RECONNECT_BASE_DELAY_MS,
  COEDIT_RECONNECT_MAX_ATTEMPTS,
  COEDIT_RECONNECT_MAX_DELAY_MS,
} from './editor-constants.js';
import { cssEscape } from './css-escape.js';
import { screenToWorld, worldToScreen } from './render.js';

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

// -- coEditSync --------------------------------------------------------

export function coEditSyncImpl(ctx: EditorContext): boolean {
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

function ensurePresenceLayer(ctx: EditorContext): HTMLElement {
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

export function repaintRemoteCursorsImpl(ctx: EditorContext): void {
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

// -- Outbound pointer presence (Figma-style mouse follow) -------------

// Figma-style mouse-follow: every mousemove over the canvas viewport
// publishes the pointer's WORLD-space coordinates so remote peers see
// it tracking like a real cursor. World coords (not screen pixels)
// because each peer applies its own camera transform — the same
// pointer must render correctly across different zoom levels.

function publishPointer(ctx: EditorContext): void {
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
      sel.anchorNode.nodeType === 1
        ? (sel.anchorNode as Element)
        : sel.anchorNode.parentElement;
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
      },
      ctx.presenceUserId ? { userId: ctx.presenceUserId } : {},
    ),
  );
}

function flushPointer(ctx: EditorContext): void {
  ctx.pointerPublishTimerId = null;
  ctx.pointerPublishPending = false;
  ctx.pointerPublishLastAtMs = Date.now();
  publishPointer(ctx);
}

function schedulePointer(ctx: EditorContext): void {
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
  const delay =
    elapsed >= POINTER_PUBLISH_INTERVAL_MS ? 0 : POINTER_PUBLISH_INTERVAL_MS - elapsed;
  ctx.pointerPublishTimerId = setTimeout(() => flushPointer(ctx), delay);
}

export function handleViewportMousemove(ctx: EditorContext, ev: MouseEvent): void {
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

function flushPublishLocalPresence(ctx: EditorContext): void {
  ctx.presencePublishPending = false;
  ctx.presencePublishLastAtMs = Date.now();
  if (!ctx.coEditConnection || !ctx.localPresence) return;
  const sel = window.getSelection();
  let cursor: { sectionId: string; elementId: string; offset?: number } | null = null;
  if (sel && sel.anchorNode) {
    const anchorEl =
      sel.anchorNode.nodeType === 1
        ? (sel.anchorNode as Element)
        : sel.anchorNode.parentElement;
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
      },
      ctx.presenceUserId ? { userId: ctx.presenceUserId } : {},
    ),
  );
}

export function schedulePublishLocalPresence(ctx: EditorContext): void {
  if (ctx.presencePublishPending) return;
  if (ctx.remotePeerCount === 0) return;
  ctx.presencePublishPending = true;
  const now = Date.now();
  const elapsed = now - ctx.presencePublishLastAtMs;
  const delay =
    elapsed >= POINTER_PUBLISH_INTERVAL_MS ? 0 : POINTER_PUBLISH_INTERVAL_MS - elapsed;
  setTimeout(() => flushPublishLocalPresence(ctx), delay);
}

// -- WebSocket boot ----------------------------------------------------

interface OpencanvasCoEditGlobal {
  connectCoEdit: (
    siteId: string,
    initialState: EditorContext['state'],
    options: {
      websocketUrl: string;
      reconnectDelayMs: number;
      reconnectMaxDelayMs: number;
      initialPresence: Parameters<NonNullable<EditorContext['coEditConnection']>['setPresence']>[0];
      websocketFactory: (url: string) => WebSocket;
    },
  ) => NonNullable<EditorContext['coEditConnection']>;
}

declare global {
  interface Window {
    __opencanvasCoEdit?: OpencanvasCoEditGlobal;
  }
}

export function attachCoEditImpl(ctx: EditorContext): void {
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
    return;
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
    initialPresence: Object.assign(
      {
        name: ctx.localPresence ? ctx.localPresence.name : '',
        color: ctx.localPresence ? ctx.localPresence.color : '',
        cursor: null,
        selection: null,
      },
      ctx.presenceUserId ? { userId: ctx.presenceUserId } : {},
    ),
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
}
