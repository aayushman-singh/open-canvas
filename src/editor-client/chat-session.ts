// src/editor-client/chat-session.ts
//
// ADR 0058 Phase 2k.b + 2q.l — chat session form + SSE streaming + suggestion
// chips + chat-message helpers. canvas-client.ts:14084-14400 carries the
// inline twin (chat session init block + chat-form submit handler, nested
// inside the boot-time try-catch inside the main IIFE). The twin retires
// on ADR 0015 Phase 3 atomic cutover; until then, the inline IIFE is the
// production source-of-truth and this module is dead code.
//
// Four exports:
//
//   - setupChatSession(ctx) — the init block. Reads cached DOM refs into
//     ctx (chatForm/chatInput/chatMessages/chatWelcome/chatAcceptAllBtn),
//     resets chatSessionId+chatBusy, wires the suggestion-chip clicks
//     (which call ctx.chatForm.requestSubmit() to reuse the submit
//     handler), then delegates to attachChatSubmitImpl for the submit
//     listener wiring.
//
//   - attachChatSubmitImpl(ctx) — Phase 2q.l: attach the chat-form submit
//     listener that POSTs to /sites/<id>/chat and SSE-streams the response.
//     Owns ensureAssistantBubble, readChunk, removeThinking — closure-
//     captured per turn so they share msgDiv / buffer / assistantText /
//     thinkingEl / submitBtn across the SSE callback boundary. Lifting
//     them to module-level would require passing 5+ parameters per call;
//     keeping them inner keeps the lift mechanical. Safe to call when
//     ctx.chatForm is null — exits early so boot ordering (DOM caching
//     runs before the submit can fire) doesn't have to assert mount
//     completion. Bound in setupChatSession; ctx-method-bind exposed for
//     symmetry with sibling modules' *Impl extractions.
//
//   - appendChatMessageImpl(ctx, role, text) — append a styled message
//     bubble to ctx.chatMessages. role drives the CSS class; text becomes
//     the bubble's textContent (NOT innerHTML — caller doesn't have to
//     sanitise). No-op when ctx.chatMessages is null. createEditor wiring
//     binds ctx.appendChatMessage = (role, text) => appendChatMessageImpl(
//     ctx, role, text) at boot — the ctx interface (Phase 2k.b section)
//     already declares the signature.
//
//   - hideChatWelcomeImpl(ctx) — hide the welcome blurb so the first
//     message makes way for the conversation. No-op when ctx.chatWelcome
//     is null or already hidden. createEditor wiring binds ctx.hideChatWelcome
//     = () => hideChatWelcomeImpl(ctx) at boot.
//
// Phase 2n owns the AI integration cluster — pendingAiSuggestions, the
// SSE op-preview branch's accept/reject/revert dispatch, the inline
// applyAgentOps/refreshAcceptAllButton/findCanvasNodeForOp/focusCanvasOnNode/
// describeOp/revertAgentEntry/showAcceptAllSummary implementations all
// stay inline in canvas-client.ts (line 10783-10812+ and beyond). The
// extracted SSE branch invokes them via ctx forward declarations so the
// module typechecks while Phase 2n still owns the implementation.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { CanvasSection } from '../canvas/schema.js';
import type {
  AiContext,
  ChatContext,
  EditorContext,
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';

// ADR 0064 — chat-session.ts carve. The four exports share a chat-shaped
// surface (ChatContext + AiContext lazy clusters) that's amplified by the
// SSE branch's reach into canvas state/render/persist. Each function takes
// the smallest type it needs; setup composes from the submit-handler
// surface so callers can pass a single context object through.

// ADR 0064 — `appendChatMessageImpl` only writes to the chat-messages DOM
// container. A single-field `Pick` keeps the surface honest — pulling in
// the full `ChatContext` would imply the helper reads every chat verb.
export type AppendChatMessageContext = Pick<EditorContext, 'chatMessages'>;

// ADR 0064 — `hideChatWelcomeImpl` only flips the welcome blurb's hidden
// flag. Same rationale as `AppendChatMessageContext` — one DOM ref, one
// `Pick`, no implicit reach into other chat verbs.
export type HideChatWelcomeContext = Pick<EditorContext, 'chatWelcome'>;

// ADR 0064 — chat-form submit listener surface. The SSE branch composes
// the ChatContext lazy cluster (chat verbs + non-DOM state), the AiContext
// lazy cluster (sidecar verbs the op-preview branch dispatches into), the
// canonical Persist/State/Selection/Render/StatusEmitter aliases, plus
// `siteBase` for the replaceMedia ghost URL and `root` + `viewport` for
// the focus-fallback diagnostic log. No inline EditorContext casts —
// every member access lives on a named cluster or this `Pick`.
export type AttachChatSubmitContext = ChatContext &
  AiContext &
  PersistContext &
  SelectionContext &
  StateContext &
  RenderContext &
  StatusEmitterContext &
  Pick<EditorContext, 'siteBase' | 'root' | 'viewport'>;

// ADR 0064 — boot-time init for the chat panel. Caches the chat DOM refs
// onto ctx, resets the per-session state, wires suggestion chips, then
// delegates to `attachChatSubmitImpl`. Adopts the submit-handler surface
// so the delegation is type-clean; no extra members beyond the assignment
// targets the function captures.
export type SetupChatSessionContext = AttachChatSubmitContext;

/**
 * Loose shape of the SSE events the chat endpoint streams back. All fields
 * optional — the runtime branches on `kind`/`event` and reads only the
 * fields relevant to that kind. The parse site narrows JSON.parse's `any`
 * output through this interface so downstream member accesses are typed.
 */
interface ChatSseEvent {
  kind?: string;
  event?: string;
  sessionId?: string;
  text?: string;
  token?: string;
  name?: string;
  args?: unknown;
  arguments?: unknown;
  op?: unknown;
  toolName?: string;
  error?: string;
  message?: string;
  /** Op-preview correlation id — the LLM tool_call id the orchestrator
   *  minted for this proposal. Used by the ghost-preview layer to associate
   *  a suggestion entry with its ghost in ctx.ghostSections. */
  id?: string;
  /** Server-resolved section for additive section ops so the editor can
   *  ghost-render it in place between existing sections. Present only for
   *  insertSection / designSection / duplicateSection; omitted otherwise. */
  previewSection?: CanvasSection;
}

/**
 * Read the additive-section ghost target from an op-preview event. Returns
 * null when the op is not one of insertSection / designSection /
 * duplicateSection, the server-resolved previewSection is missing, or the
 * op shape is malformed. The caller filters non-null results into
 * ctx.ghostSections.
 */
export function resolveGhostPageIdForPreview(
  pages: readonly { id: string; sections: readonly { id: string }[] }[],
  opPageId: string | null | undefined,
  afterSectionId: string | null,
): string {
  const firstPage = pages[0];
  if (!firstPage) {
    throw new Error('ghost preview: state must have at least one page');
  }
  if (typeof opPageId === 'string' && opPageId.length > 0) {
    const target = pages.find((p) => p.id === opPageId);
    if (!target) {
      throw new Error(
        `ghost preview: pageId not found: ${opPageId}. Known pages: ${pages
          .map((p) => p.id)
          .join(', ')}`,
      );
    }
    if (
      typeof afterSectionId === 'string' &&
      afterSectionId.length > 0 &&
      !target.sections.some((s) => s.id === afterSectionId)
    ) {
      throw new Error(
        `ghost preview: afterSectionId ${afterSectionId} does not exist on page ${opPageId}`,
      );
    }
    return target.id;
  }
  if (typeof afterSectionId === 'string' && afterSectionId.length > 0) {
    const target = pages.find((p) => p.sections.some((s) => s.id === afterSectionId));
    if (!target) {
      throw new Error(`ghost preview: afterSectionId not found on any page: ${afterSectionId}`);
    }
    return target.id;
  }
  return firstPage.id;
}

function extractGhostFromOpPreview(
  opSnapshot: unknown,
  previewSection: CanvasSection | undefined,
  suggestionId: string,
  pages: readonly { id: string; sections: readonly { id: string }[] }[],
): { id: string; pageId: string; afterSectionId: string | null; section: CanvasSection } | null {
  if (!previewSection || !opSnapshot || typeof opSnapshot !== 'object') return null;
  const op = opSnapshot as {
    kind?: string;
    pageId?: string | null;
    afterSectionId?: string | null;
    sectionId?: string;
  };
  if (
    op.kind !== 'insertSection' &&
    op.kind !== 'designSection' &&
    op.kind !== 'duplicateSection'
  ) {
    return null;
  }
  // duplicateSection inserts the clone after the original by default in
  // applyCanvasAgentOp — mirror that so the ghost lands where the real op
  // would land. For insertSection / designSection the op carries
  // afterSectionId verbatim.
  const afterSectionId =
    op.kind === 'duplicateSection'
      ? typeof op.sectionId === 'string' ? op.sectionId : null
      : op.afterSectionId === undefined
        ? null
        : op.afterSectionId;
  const pageId = resolveGhostPageIdForPreview(
    pages,
    op.pageId === undefined ? null : op.pageId,
    afterSectionId,
  );
  return { id: suggestionId, pageId, afterSectionId, section: previewSection };
}

/**
 * Inline IIFE twin reads `err.message || String(err)` — untyped JS. The
 * extracted module catches err as `unknown` (no declared shape on the
 * promise reject branch) and routes it through this helper so member
 * access is narrowed first. Preserves the inline twin's surface: Error
 * messages come through verbatim, plain strings pass through, everything
 * else falls back to "unknown" rather than risking "[object Object]".
 */
function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown';
}

export function appendChatMessageImpl(
  ctx: AppendChatMessageContext,
  role: string,
  text: string,
): void {
  if (!ctx.chatMessages) return;
  const div = document.createElement('div');
  div.className = 'opencanvas-chat-msg ' + role;
  div.textContent = text;
  ctx.chatMessages.appendChild(div);
  ctx.chatMessages.scrollTop = ctx.chatMessages.scrollHeight;
}

export function hideChatWelcomeImpl(ctx: HideChatWelcomeContext): void {
  if (ctx.chatWelcome && !ctx.chatWelcome.hidden) ctx.chatWelcome.hidden = true;
}

// Size the chat <textarea> to its content: collapse to the one-row base
// (height:auto + the CSS min-height), then grow to fit. The extra
// (offsetHeight - clientHeight) term restores the borders, which scrollHeight
// excludes — without it the box loses a pixel each keystroke. The CSS
// max-height caps growth and switches on the scrollbar past that point.
export function autoGrowChatInput(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + (el.offsetHeight - el.clientHeight) + 'px';
}

export function setupChatSession(ctx: SetupChatSessionContext): void {
  // -- Chat panel form submission -----------------------------------------
  ctx.chatForm = document.getElementById('canvas-chat-form') as HTMLFormElement | null;
  ctx.chatInput = document.getElementById('canvas-chat-input') as HTMLTextAreaElement | null;
  ctx.chatMessages = document.getElementById('canvas-chat-messages');
  ctx.chatWelcome = document.getElementById('canvas-chat-welcome');
  // Bind the Accept-all banner to the module-scope handle so the
  // suggestion tracker can hide/show it as ops drain. Pin the
  // initial-hidden state on bind so the banner is invisible from
  // first paint regardless of how the route emitted the hidden
  // attribute or what the user's cached stylesheet looks like.
  ctx.chatAcceptAllBtn = document.getElementById('canvas-chat-accept-all');
  if (ctx.chatAcceptAllBtn) {
    ctx.chatAcceptAllBtn.hidden = true;
    ctx.chatAcceptAllBtn.style.display = 'none';
    ctx.chatAcceptAllBtn.addEventListener('click', function () {
      ctx.showAcceptAllSummary();
    });
  }
  ctx.chatSessionId = null;
  ctx.chatBusy = false;

  // The chat box is a <textarea> so a multi-line prompt grows the field
  // instead of scrolling off as one long line. Mirror the content height on
  // every input, and submit on Enter (Shift+Enter inserts a newline) so the
  // single-line ergonomics of the old <input> survive the upgrade.
  const chatInput = ctx.chatInput;
  if (chatInput) {
    chatInput.addEventListener('input', function () {
      autoGrowChatInput(chatInput);
    });
    chatInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        const form = ctx.chatForm;
        if (!form) return;
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }
    });
  }

  // Suggestion chips: clicking pre-fills the input AND submits, so the
  // chat does the work without the Owner having to retype. We rely on
  // requestSubmit() so the existing submit listener fires its full flow
  // (busy state, payload assembly, SSE stream) rather than re-implementing.
  const chatChips = document.querySelectorAll('.opencanvas-chat-chip');
  for (let ci = 0; ci < chatChips.length; ci++) {
    (function (chip: Element) {
      chip.addEventListener('click', function () {
        if (ctx.chatBusy || !ctx.chatInput || !ctx.chatForm) return;
        const prompt = chip.getAttribute('data-chip-prompt') || chip.textContent || '';
        if (!prompt) return;
        ctx.chatInput.value = prompt;
        autoGrowChatInput(ctx.chatInput);
        if (typeof ctx.chatForm.requestSubmit === 'function') {
          ctx.chatForm.requestSubmit();
        } else {
          ctx.chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      });
    })(chatChips[ci]!);
  }

  attachChatSubmitImpl(ctx);
}

export function attachChatSubmitImpl(ctx: AttachChatSubmitContext): void {
  if (!ctx.chatForm) return;
  ctx.chatForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (ctx.chatBusy || !ctx.chatInput) return;
    const msg = ctx.chatInput.value.trim();
    if (msg.length === 0) return;
    ctx.chatInput.value = '';
    autoGrowChatInput(ctx.chatInput);
    ctx.hideChatWelcome();
    ctx.appendChatMessage('user', msg);
    ctx.chatBusy = true;
    // TS infers `Element | null` from this querySelector; cast to
    // HTMLButtonElement | null so the .disabled toggles typecheck.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- TS infers Element, not HTMLButtonElement, despite the literal "button..." selector
    const submitBtn = ctx.chatForm!.querySelector('button[type=submit]') as
      | HTMLButtonElement
      | null;
    if (submitBtn) submitBtn.disabled = true;

    // Thinking bubble: lightbulb + "Thinking…" placeholder shown
    // immediately so the panel does not sit dead while the model warms
    // up. Removed as soon as the first SSE event lands (any kind) so
    // the real streaming bubble can take its place.
    let thinkingEl: HTMLDivElement | null = document.createElement('div');
    thinkingEl.className = 'opencanvas-chat-thinking';
    const bulb = document.createElement('span');
    bulb.className = 'opencanvas-chat-thinking-bulb';
    bulb.textContent = '💡';
    const label = document.createElement('span');
    label.className = 'opencanvas-chat-thinking-label';
    label.textContent = 'Thinking…';
    thinkingEl.appendChild(bulb);
    thinkingEl.appendChild(label);
    ctx.chatMessages!.appendChild(thinkingEl);
    ctx.chatMessages!.scrollTop = ctx.chatMessages!.scrollHeight;
    function removeThinking(): void {
      if (thinkingEl && thinkingEl.parentNode) {
        thinkingEl.parentNode.removeChild(thinkingEl);
        thinkingEl = null;
      }
    }

    const payload: { message: string; sessionId?: string; selectedElementId?: string } = {
      message: msg,
    };
    if (ctx.chatSessionId) payload.sessionId = ctx.chatSessionId;
    if (ctx.selectedElementId && !ctx.chatSelectionDropped) {
      payload.selectedElementId = ctx.selectedElementId;
    }
    // The X drops selection for one send only; re-arm so the next
    // message picks up the current canvas selection again.
    ctx.chatSelectionDropped = false;
    ctx.updateChatSelectionChip();

    void ctx
      .authFetch(ctx.apiBase + '/sites/' + ctx.siteId + '/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      .then(function (response) {
        if (!response.ok) {
          removeThinking();
          ctx.appendChatMessage('error', 'Chat request failed: ' + response.status);
          ctx.chatBusy = false;
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantText = '';
        let msgDiv: HTMLDivElement | null = null;
        function ensureAssistantBubble(): HTMLDivElement {
          removeThinking();
          if (msgDiv) return msgDiv;
          msgDiv = document.createElement('div');
          msgDiv.className = 'opencanvas-chat-msg assistant';
          ctx.chatMessages!.appendChild(msgDiv);
          return msgDiv;
        }

        function readChunk(): void {
          reader
            .read()
            .then(function (result) {
              if (result.done) {
                removeThinking();
                ctx.chatBusy = false;
                if (submitBtn) submitBtn.disabled = false;
                return;
              }
              buffer += decoder.decode(result.value, { stream: true });
              const lines = buffer.split(String.fromCharCode(10));
              buffer = lines.pop() || '';
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i]!;
                if (line.indexOf('data: ') === 0) {
                  const dataStr = line.slice(6);
                  try {
                    // JSON.parse returns `any`; cast to unknown then narrow
                    // through ChatSseEvent so member access is typed. The
                    // SSE event shape is loose by design (every kind reads
                    // only the fields relevant to that branch). Mirrors the
                    // persist.ts pattern for parsed-then-narrowed input.
                    const parsed = JSON.parse(dataStr) as ChatSseEvent | null;
                    const data: ChatSseEvent = parsed ?? {};
                    const kind = data.kind || data.event || '';
                    if (kind === 'session') {
                      ctx.chatSessionId = data.sessionId || ctx.chatSessionId;
                    } else if (kind === 'token') {
                      assistantText += data.text || data.token || '';
                      const bubble = ensureAssistantBubble();
                      bubble.textContent = assistantText;
                      ctx.chatMessages!.scrollTop = ctx.chatMessages!.scrollHeight;
                    } else if (kind === 'tool-call') {
                      // Tool calls are internal plumbing — the user only
                      // cares about the resulting suggestion card. Keep
                      // them in the devtools log for debugging but don't
                      // pollute the chat transcript. DO NOT remove the
                      // thinking bubble here — a tool-call fires the
                      // moment the model decides to invoke a tool, often
                      // seconds before the op-preview card lands. Dropping
                      // the indicator at that point leaves the user
                      // staring at an empty chat panel while the tool
                      // actually runs. The bubble is removed when
                      // user-visible content arrives (text token, op-
                      // preview, error, or stream done).
                      if (window.console && console.debug) {
                        console.debug('[chat tool-call]', data.name, data.args || data.arguments);
                      }
                    } else if (kind === 'op-preview') {
                      // IIFE-scope the op + toolName snapshots so each
                      // suggestion card captures THIS event's op, not
                      // whatever the function-scoped data happens to
                      // hold at click time (the SSE callback re-fires
                      // and would otherwise alias the same reference).
                      (function (
                        opSnapshot: unknown,
                        toolNameSnapshot: string,
                        previewSectionSnapshot: CanvasSection | undefined,
                        suggestionIdSnapshot: string,
                      ) {
                        const card = document.createElement('div');
                        card.className = 'opencanvas-chat-msg opencanvas-chat-suggestion';
                        card.setAttribute('data-status', 'pending');

                        const titleSpan = document.createElement('div');
                        titleSpan.className = 'opencanvas-chat-suggestion-title';
                        titleSpan.textContent = 'Proposed ' + (toolNameSnapshot || 'edit');
                        card.appendChild(titleSpan);

                        const body = document.createElement('div');
                        body.className = 'opencanvas-chat-suggestion-body';
                        body.textContent = ctx.describeOp(opSnapshot);
                        card.appendChild(body);

                        // Resolve + paint an overlay on the target canvas
                        // node so the owner sees which block the change
                        // affects. The node reference is kept on the
                        // suggestion entry so the focus click + the
                        // reject button can clear it later.
                        const targetNode = ctx.findCanvasNodeForOp(opSnapshot);
                        if (targetNode) {
                          targetNode.setAttribute('data-ai-overlay-status', 'proposed');
                          // Media-replacement ghost: when the AI proposes a
                          // new image on an existing media element, overlay
                          // the proposed asset on top of the live one so the
                          // owner can actually see what they'd be applying
                          // before clicking Accept. The dashed outline alone
                          // tells them *which* element is targeted but not
                          // *what* changes. Image-only for now; videos would
                          // need a separate <video> overlay path.
                          const proposalSnapshot = opSnapshot as {
                            kind?: string;
                            mediaKind?: string;
                            assetId?: string;
                            dataUrl?: string;
                            mediaType?: string;
                            target?: {
                              mode?: string;
                              box?: { x: number; y: number; w: number; h: number };
                            };
                          };
                          // Three flavours of ghost overlay:
                          //   - replaceMedia: existing Owner Asset id rendered
                          //     via the owner-gated /assets/<id> route. Ghost
                          //     fills the target media element (inset:0).
                          //   - placeGeneratedImage REPLACE mode: bytes ride
                          //     inline as a data URL so the asset row isn't
                          //     created until Accept (ADR 0004 D2). Same
                          //     inset:0 fill over the existing media element.
                          //   - placeGeneratedImage ADD mode: there is no
                          //     element yet, so the ghost is absolutely
                          //     positioned inside the SECTION at op.target.box
                          //     (the same slot the eventual addElement will
                          //     land in). Inline top/left/width/height +
                          //     inset:auto override the .opencanvas-ai-media-
                          //     ghost class's default inset:0.
                          let ghostSrc: string | null = null;
                          let addModeBox: { x: number; y: number; w: number; h: number } | null = null;
                          if (
                            proposalSnapshot.kind === 'replaceMedia' &&
                            proposalSnapshot.mediaKind === 'image' &&
                            typeof proposalSnapshot.assetId === 'string' &&
                            proposalSnapshot.assetId.length > 0
                          ) {
                            ghostSrc =
                              ctx.siteBase +
                              '/assets/' +
                              encodeURIComponent(proposalSnapshot.assetId);
                          } else if (
                            proposalSnapshot.kind === 'placeGeneratedImage' &&
                            proposalSnapshot.target &&
                            typeof proposalSnapshot.dataUrl === 'string' &&
                            proposalSnapshot.dataUrl.length > 0
                          ) {
                            if (proposalSnapshot.target.mode === 'replace') {
                              ghostSrc = proposalSnapshot.dataUrl;
                            } else if (
                              proposalSnapshot.target.mode === 'add' &&
                              proposalSnapshot.target.box &&
                              typeof proposalSnapshot.target.box.x === 'number' &&
                              typeof proposalSnapshot.target.box.y === 'number' &&
                              typeof proposalSnapshot.target.box.w === 'number' &&
                              typeof proposalSnapshot.target.box.h === 'number'
                            ) {
                              ghostSrc = proposalSnapshot.dataUrl;
                              addModeBox = proposalSnapshot.target.box;
                            }
                          }
                          if (ghostSrc) {
                            const mediaGhost = document.createElement('div');
                            mediaGhost.className = 'opencanvas-ai-media-ghost';
                            mediaGhost.setAttribute(
                              'data-ai-media-ghost-for',
                              suggestionIdSnapshot,
                            );
                            if (addModeBox) {
                              // ADD-mode ghost: positioned inside the section
                              // at the proposed box so the Owner sees the new
                              // image in its eventual slot. inset:auto
                              // discards the class's inset:0; top/left/width/
                              // height pin the box.
                              mediaGhost.style.cssText =
                                'inset: auto; top: ' +
                                String(addModeBox.y) +
                                'px; left: ' +
                                String(addModeBox.x) +
                                'px; width: ' +
                                String(addModeBox.w) +
                                'px; height: ' +
                                String(addModeBox.h) +
                                'px;';
                            }
                            const ghostImg = document.createElement('img');
                            ghostImg.src = ghostSrc;
                            ghostImg.alt = '';
                            mediaGhost.appendChild(ghostImg);
                            const ghostBadge = document.createElement('span');
                            ghostBadge.className = 'opencanvas-ai-media-ghost-badge';
                            ghostBadge.textContent = '💡 Proposed';
                            mediaGhost.appendChild(ghostBadge);
                            targetNode.appendChild(mediaGhost);
                          }
                        }

                        const entry = {
                          op: opSnapshot,
                          toolName: toolNameSnapshot,
                          status: 'pending',
                          cardEl: card,
                          targetNode: targetNode,
                          inverseOp: null as unknown,
                          suggestionId: suggestionIdSnapshot,
                        };
                        ctx.pendingAiSuggestions.push(entry);

                        // Ghost preview: for additive section ops the server
                        // shipped a resolved CanvasSection; materialise it in
                        // ctx.ghostSections and re-render so the Owner sees
                        // the proposal in place at lower opacity. Non-additive
                        // op kinds (rewriteText, updateElement, deleteSection
                        // etc.) fall through with no ghost — the existing
                        // overlay-chip on the target node carries that signal.
                        const ghost = extractGhostFromOpPreview(
                          opSnapshot,
                          previewSectionSnapshot,
                          suggestionIdSnapshot,
                          ctx.state!.pages,
                        );
                        if (ghost) {
                          ctx.ghostSections.push(ghost);
                          // Attach a blueprint for revert: when an accepted
                          // op is rolled back the suggestion returns to
                          // pending and the ghost should reappear.
                          (entry as { ghostBlueprint?: typeof ghost }).ghostBlueprint = ghost;
                          ctx.renderAll();
                        }

                        const actions = document.createElement('div');
                        actions.className = 'opencanvas-chat-suggestion-actions';
                        const acceptBtn = document.createElement('button');
                        acceptBtn.type = 'button';
                        acceptBtn.className = 'accept';
                        acceptBtn.textContent = 'Accept';
                        acceptBtn.addEventListener('click', function (ev) {
                          ev.stopPropagation();
                          if (entry.status !== 'pending') return;
                          acceptBtn.disabled = true;
                          rejectBtn.disabled = true;
                          // Ghost cleanup lives in applyAgentOpsImpl's
                          // success branch (drop by suggestionId before its
                          // own renderAll). That keeps Accept / Apply-all
                          // paths converged on one removal site instead of
                          // each entry button writing its own filter.
                          // placeGeneratedImage ops are materialised inside
                          // applyAgentOpsImpl (bytes → Owner Asset → real
                          // replaceMedia/addElement op) before the /apply
                          // POST, so the Accept path stays uniform.
                          void ctx.applyAgentOps([entry.op], [entry]);
                        });
                        const rejectBtn = document.createElement('button');
                        rejectBtn.type = 'button';
                        rejectBtn.className = 'reject';
                        rejectBtn.textContent = 'Reject';
                        rejectBtn.addEventListener('click', function (ev) {
                          ev.stopPropagation();
                          if (entry.status !== 'pending') return;
                          entry.status = 'rejected';
                          card.setAttribute('data-status', 'rejected');
                          acceptBtn.disabled = true;
                          rejectBtn.disabled = true;
                          entry.targetNode = ctx.findCanvasNodeForOp(entry.op);
                          if (entry.targetNode) {
                            entry.targetNode.removeAttribute('data-ai-overlay-status');
                            // Strip any replaceMedia ghost overlay we
                            // attached above when the proposal landed.
                            const mediaGhost = entry.targetNode.querySelector(
                              '[data-ai-media-ghost-for="' + suggestionIdSnapshot + '"]',
                            );
                            if (mediaGhost) mediaGhost.remove();
                          }
                          // Remove the ghost from the canvas — the Owner
                          // said no, so the proposal preview goes away.
                          if (ghost) {
                            ctx.ghostSections = ctx.ghostSections.filter(
                              (g) => g.id !== ghost.id,
                            );
                            ctx.renderAll();
                          }
                          ctx.refreshAcceptAllButton();
                        });
                        // Revert button — hidden until /apply succeeds
                        // AND a per-op inverse was captured. Destructive
                        // ops (deleteElement/Section/Page) leave it hidden
                        // because the CanvasAgentOp union has no clean
                        // reconstructor for them.
                        const revertBtn = document.createElement('button');
                        revertBtn.type = 'button';
                        revertBtn.className = 'revert';
                        revertBtn.textContent = 'Revert';
                        revertBtn.hidden = true;
                        revertBtn.addEventListener('click', function (ev) {
                          ev.stopPropagation();
                          if (entry.status !== 'accepted' || !entry.inverseOp) return;
                          ctx.revertAgentEntry(entry);
                        });
                        (entry as { acceptBtn?: HTMLButtonElement }).acceptBtn = acceptBtn;
                        (entry as { rejectBtn?: HTMLButtonElement }).rejectBtn = rejectBtn;
                        (entry as { revertBtn?: HTMLButtonElement }).revertBtn = revertBtn;
                        actions.appendChild(acceptBtn);
                        actions.appendChild(rejectBtn);
                        actions.appendChild(revertBtn);
                        card.appendChild(actions);

                        // Whole-card click pans the camera onto the
                        // target node and pulse-rings it. Action buttons
                        // stopPropagation so clicking Accept/Reject/Revert
                        // never triggers an unwanted pan. Re-resolve every
                        // click — entry.targetNode goes stale across any
                        // ctx.renderAll() (co-edit, accept of a sibling
                        // op) and a detached node silently no-ops.
                        card.style.cursor = 'pointer';
                        card.addEventListener('click', function () {
                          entry.targetNode = ctx.findCanvasNodeForOp(entry.op);
                          if (entry.targetNode) {
                            entry.targetNode.setAttribute(
                              'data-ai-overlay-status',
                              entry.status === 'accepted' ? 'accepted' : 'proposed',
                            );
                            ctx.focusCanvasOnNode(entry.targetNode);
                            return;
                          }
                          const opForLog = entry.op as { kind?: string; elementId?: string; sectionId?: string; afterSectionId?: string; pageId?: string };
                          const opKind = (opForLog && opForLog.kind) || '(unknown)';
                          const opElementId = opForLog && opForLog.elementId;
                          const opSectionId = (opForLog && opForLog.sectionId) || (opForLog && opForLog.afterSectionId);
                          const opCreatesTarget =
                            opKind === 'addElement' ||
                            opKind === 'addPage' ||
                            opKind === 'insertSection' ||
                            opKind === 'addSection';
                          if (opCreatesTarget && entry.status !== 'accepted') {
                            ctx.setStatus(
                              'This suggestion adds new content — accept it to preview on canvas',
                              'info',
                            );
                            return;
                          }
                          ctx.setStatus(
                            'Cannot focus suggestion: target ' + opKind + ' not on canvas',
                            'error',
                          );
                          if (window.console && console.error) {
                            console.error('[chat suggestion click] no canvas node for op', {
                              opKind: opKind,
                              elementId: opElementId,
                              sectionId: opSectionId,
                              status: entry.status,
                              hasRoot: !!ctx.root,
                              hasViewport: !!ctx.viewport,
                              op: entry.op,
                            });
                          }
                        });

                        ctx.chatMessages!.appendChild(card);
                        ctx.chatMessages!.scrollTop = ctx.chatMessages!.scrollHeight;
                        ctx.refreshAcceptAllButton();
                      })(
                        data.op,
                        data.toolName || '',
                        data.previewSection,
                        // Fall back to a synthetic id when the server didn't
                        // ship one (pre-ghost-preview servers, future event
                        // shapes). Anchored to a counter + Date.now so two
                        // events landing in the same ms still get unique ids.
                        data.id ||
                          'ghost-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8),
                      );
                      removeThinking();
                    } else if (kind === 'error') {
                      removeThinking();
                      ctx.appendChatMessage(
                        'error',
                        data.error || data.message || 'Agent error',
                      );
                    } else if (kind === 'done') {
                      removeThinking();
                      ctx.chatBusy = false;
                      if (submitBtn) submitBtn.disabled = false;
                    }
                  } catch (sseErr: unknown) {
                    // Only swallow JSON.parse SyntaxError (the documented
                    // partial-frame case). Every other failure inside the
                    // event branches must surface loudly — the prior
                    // catch-all is how the suggestion-click regression
                    // hid. Surface but keep draining the stream so a
                    // crashed op-preview does not strand the chat.
                    if (sseErr instanceof SyntaxError) {
                      if (window.console && console.warn) {
                        console.warn(
                          '[chat sse] dropped malformed line: ' + errorToString(sseErr),
                        );
                      }
                    } else {
                      removeThinking();
                      if (window.console && console.error) {
                        console.error('[chat sse] handler threw', sseErr, {
                          line: line,
                        });
                      }
                      ctx.appendChatMessage(
                        'error',
                        'Chat event handler crashed: ' + errorToString(sseErr),
                      );
                    }
                  }
                }
              }
              readChunk();
            })
            .catch(function (err: unknown) {
              removeThinking();
              ctx.appendChatMessage('error', 'Stream error: ' + errorToString(err));
              ctx.chatBusy = false;
              if (submitBtn) submitBtn.disabled = false;
            });
        }
        readChunk();
      })
      .catch(function (err: unknown) {
        ctx.appendChatMessage('error', 'Network error: ' + errorToString(err));
        ctx.chatBusy = false;
        if (submitBtn) submitBtn.disabled = false;
      });
  });
}
