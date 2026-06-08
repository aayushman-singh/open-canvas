// src/editor-client/ai-preview-panel.ts
//
// ADR 0058 Phase 2q.f — AI preview panel (OLD single-shot flow).
// canvas-client.ts:10334-10340 (closeAiPanel) + canvas-client.ts:11021-11277
// (applyPreview, buildAiPanel, runAiPreview, aiRewriteText,
// aspectRatioToBox, aiReplaceMedia, aiCreateSection) carry the inline
// twins; they retire on Phase 3 cutover.
//
// THIS MODULE IS DISTINCT FROM src/editor-client/ai-integration.ts
// (Phase 2n). That sibling owns the chat-driven suggestion-card cluster
// — per-op revert, deferred-id resolution, suggestion DOM. This module
// owns the OLDER single-shot preview surfaced from inspector buttons
// ("AI rewrite" on text, "Replace media" on image, "Generate with AI"
// on section). Two surfaces, two cutover destinations.
//
// Eight functions live here:
//
//   - closeAiPanelImpl(ctx) — detach the live <aside> and release
//     ctx.aiBusy. Every exit path through applyPreview / runAiPreview /
//     the Dismiss button must funnel here, otherwise [data-ai-button]
//     elements stay disabled and the editor freezes after one failed
//     apply.
//
//   - applyPreview(ctx, ops) — POST the op list to
//     /canvas-agent/sites/<id>/apply, replace ctx.state with the
//     response's editableState, then closeAiPanel. Pre-flushes the
//     pending save so the server applies on top of the latest local
//     edits. Every error path closes the panel — there is no "partially
//     applied" UI state.
//
//   - buildAiPanel(ctx, payload) — mount the AI preview <aside> with
//     Accept/Dismiss. Accept invokes applyPreview(ops); Dismiss invokes
//     closeAiPanel + flashes "AI preview dismissed". The op list comes
//     from payload.ops; payload.text is an optional explanatory blurb
//     the assistant sometimes returns alongside the ops.
//
//   - runAiPreviewImpl(ctx, prompt) — POST the Owner prompt to
//     /canvas-agent/sites/<id>/preview, build the panel from the
//     response. Surfaces server errors via openAlertModal (status-line
//     alone is too easy to miss) AND the status line.
//
//   - aiRewriteTextImpl(ctx, elementId) — inspector "AI rewrite"
//     handler. Prompts the Owner for a brief via openTextModal, then
//     routes through runAiPreview with a prompt that names the
//     rewriteText tool. No-op while ctx.aiBusy is true so AI buttons
//     can't stack.
//
//   - aspectRatioToBox(aspect) — map the AI media modal's aspect choice
//     ("1:1" / "16:9" / "4:3" / "9:16") to a synthetic boxW/boxH pair.
//     The /assets/generate server snaps box ratio to a Flux preset, so
//     this lookup steers Flux onto the exact preset the Owner picked
//     WITHOUT introducing a new aspect_ratio wire field. Pure function
//     — exposed at the module level so the smoke fixture can pin it.
//
//   - aiReplaceMediaImpl(ctx, elementId) — inspector "Replace media"
//     handler. Opens the 4-up AI media modal, uploads the picked tile
//     via uploadGeneratedBlobToElement, flashes Applied / Apply failed.
//     IMAGE-ONLY — refuses video elements loudly via the status line.
//     Bypasses the preview panel entirely: picking a tile IS the apply,
//     so the single-shot path's inspector-preview confirmation would be
//     a redundant second click hidden at the bottom of the inspector.
//
//   - aiCreateSectionImpl(ctx, afterSectionId) — section inspector
//     "Generate with AI" handler. Prompts for a brief, builds the
//     designSection prompt, routes through runAiPreview. Phase 2h.3.a
//     already declared aiCreateSection on ctx; this module supplies the
//     impl. The afterSectionId-null branch appends at the page end.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { CanvasAgentOp } from '../agent/canvas-ops.js';
import type {
  AiContext,
  DomContext,
  EditorContext,
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import type { MediaElement } from '../canvas/elements/media.js';
import { applyCustomKitCss } from './custom-kit-css.js';

interface PreviewPayload {
  ops?: CanvasAgentOp[];
  text?: string;
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown';
}

// ADR 0064 — closeAiPanelImpl detaches the live <aside> and releases the
// AI UI lock. The `aiPanel` ref is panel-local DOM state (not in DomContext
// because DomContext names boot-cached refs, not AI lifecycle slots); the
// AiContext lazy-cluster alias supplies `setAiBusy`.
export type CloseAiPanelContext = AiContext & Pick<EditorContext, 'aiPanel'>;

// ADR 0064 — applyPreview owns the POST-then-replace flow: flush pending
// save, hit /apply, swap ctx.state, re-render. Pulls in PersistContext for
// the network call + identity fields, StateContext + SelectionContext +
// DomContext + RenderContext for the post-apply reseat, AiContext for the
// access-revoked / session-expired guards, plus an inline Pick for the
// panel-lifecycle + migration verbs that don't yet have named contexts.
type ApplyPreviewContext = AiContext &
  PersistContext &
  StatusEmitterContext &
  StateContext &
  SelectionContext &
  DomContext &
  RenderContext &
  Pick<EditorContext, 'closeAiPanel' | 'flushPendingSave' | 'migrateState'>;

// ADR 0064 — buildAiPanel mounts the preview <aside> and forwards ctx to
// applyPreview on Accept, so it must be a superset of ApplyPreviewContext.
// Adds `aiPanel` for the panel-slot write at the end of the build.
type BuildAiPanelContext = ApplyPreviewContext & Pick<EditorContext, 'aiPanel'>;

// ADR 0064 — runAiPreviewImpl posts the Owner prompt, forwards ctx into
// buildAiPanel, and surfaces server errors through openAlertModal. Pulls in
// the build surface verbatim plus the modal verb.
export type RunAiPreviewContext = BuildAiPanelContext & Pick<EditorContext, 'openAlertModal'>;

// ADR 0064 — aiRewriteTextImpl + aiCreateSectionImpl share a tiny surface:
// gate on aiBusy, prompt via openTextModal, hand off to runAiPreview. They
// reach for an inline Pick rather than the wider AiContext because only
// aiBusy is needed from the AI cluster.
export type AiRewriteTextContext = Pick<
  EditorContext,
  'aiBusy' | 'openTextModal' | 'runAiPreview'
>;
export type AiCreateSectionContext = AiRewriteTextContext;

// ADR 0064 — aiReplaceMediaImpl bypasses the preview panel: picks a tile
// from the 4-up modal and uploads it directly. Touches the AI busy gate,
// the element lookup, the asset-generate endpoint (siteBase + authFetch),
// the modal verb, the upload verb, and the status line.
export type AiReplaceMediaContext = Pick<
  EditorContext,
  | 'aiBusy'
  | 'findElement'
  | 'authFetch'
  | 'siteBase'
  | 'openAiMediaModal'
  | 'uploadGeneratedBlobToElement'
  | 'setStatus'
>;

export function closeAiPanelImpl(ctx: CloseAiPanelContext): void {
  if (ctx.aiPanel && ctx.aiPanel.parentNode) {
    ctx.aiPanel.parentNode.removeChild(ctx.aiPanel);
  }
  ctx.aiPanel = null;
  ctx.setAiBusy(false);
}

// Every exit path must release the AI UI lock. If we leave aiBusy=true or
// the preview <aside> mounted, every [data-ai-button] stays disabled and
// the Owner sees a frozen editor after the first failed apply.
async function applyPreview(ctx: ApplyPreviewContext, ops: CanvasAgentOp[]): Promise<void> {
  try {
    const saved = await ctx.flushPendingSave();
    if (!saved) {
      ctx.closeAiPanel();
      return;
    }
    const response = await ctx.authFetch(
      ctx.apiBase + '/canvas-agent/sites/' + ctx.siteId + '/apply',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops }),
      },
    );
    if (ctx.accessRevoked || ctx.sessionExpired) {
      ctx.closeAiPanel();
      return;
    }
    if (!response.ok) {
      let detail: string = response.statusText;
      try {
        const body = (await response.json()) as { errors?: unknown[]; error?: unknown };
        if (body && Array.isArray(body.errors) && body.errors.length > 0) {
          const first: unknown = body.errors[0];
          if (typeof first === 'string') detail = first;
        } else if (body && typeof body.error === 'string') {
          detail = body.error;
        }
      } catch (_) {
        /* ignore */
      }
      ctx.setStatus('Apply failed: ' + detail, 'error');
      ctx.closeAiPanel();
      return;
    }
    const body = (await response.json()) as { editableState?: unknown };
    if (!body || typeof body !== 'object' || !body.editableState) {
      ctx.setStatus('Apply failed: malformed server response', 'error');
      ctx.closeAiPanel();
      return;
    }
    ctx.state = body.editableState as EditorContext['state'];
    if (ctx.state) ctx.state = ctx.migrateState(ctx.state);
    ctx.selectedSectionId = null;
    ctx.selectedElementId = null;
    if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
      ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
    }
    applyCustomKitCss(ctx.state);
    ctx.renderAll();
    ctx.closeAiPanel();
    ctx.setStatus('AI edit applied', 'ok');
  } catch (err) {
    if (!ctx.accessRevoked && !ctx.sessionExpired) {
      ctx.setStatus('Apply failed: ' + errorToString(err), 'error');
    }
    ctx.closeAiPanel();
  }
}

function buildAiPanel(ctx: BuildAiPanelContext, payload: PreviewPayload): void {
  ctx.closeAiPanel();
  const panel = document.createElement('aside');
  panel.className = 'opencanvas-ai-panel';
  panel.setAttribute('aria-label', 'AI preview');
  const heading = document.createElement('h3');
  heading.textContent = 'AI preview';
  panel.appendChild(heading);

  const ops: CanvasAgentOp[] = Array.isArray(payload.ops) ? payload.ops : [];
  if (typeof payload.text === 'string' && payload.text.length > 0) {
    const note = document.createElement('p');
    note.className = 'opencanvas-ai-note';
    note.textContent = payload.text;
    panel.appendChild(note);
  }
  if (ops.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'The assistant did not propose any changes.';
    panel.appendChild(empty);
  } else {
    const list = document.createElement('ol');
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op) continue;
      const item = document.createElement('li');
      item.textContent = ctx.describeOp(op);
      list.appendChild(item);
    }
    panel.appendChild(list);
  }

  const actions = document.createElement('div');
  actions.className = 'opencanvas-ai-actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.textContent = 'Accept';
  accept.disabled = ops.length === 0;
  accept.addEventListener('click', () => {
    void applyPreview(ctx, ops);
  });
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    ctx.closeAiPanel();
    ctx.setStatus('AI preview dismissed', 'ok');
  });
  actions.appendChild(accept);
  actions.appendChild(dismiss);
  panel.appendChild(actions);

  document.body.appendChild(panel);
  ctx.aiPanel = panel;
}

export async function runAiPreviewImpl(ctx: RunAiPreviewContext, prompt: string): Promise<void> {
  ctx.setAiBusy(true);
  const saved = await ctx.flushPendingSave();
  if (!saved) {
    ctx.setAiBusy(false);
    return;
  }
  ctx.setStatus('Asking the assistant...');
  try {
    const response = await ctx.authFetch(
      ctx.apiBase + '/canvas-agent/sites/' + ctx.siteId + '/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      },
    );
    if (!response.ok) {
      let detail: string = response.statusText;
      try {
        const body = (await response.json()) as { errors?: unknown[]; error?: unknown };
        if (body && Array.isArray(body.errors) && body.errors.length > 0) {
          const first: unknown = body.errors[0];
          if (typeof first === 'string') detail = first;
        } else if (body && typeof body.error === 'string') {
          detail = body.error;
        }
      } catch (_) {
        /* ignore */
      }
      ctx.setStatus('AI preview failed', 'error');
      ctx.setAiBusy(false);
      // Modal surface — the status-line flash is too easy to miss and the
      // server's error message often tells the Owner exactly what to do.
      try {
        await ctx.openAlertModal({ title: 'AI preview failed', message: detail });
      } catch (_) {
        /* another modal was open; status line still has the error */
      }
      return;
    }
    const body = (await response.json()) as PreviewPayload | null;
    buildAiPanel(ctx, body || {});
    ctx.setStatus('AI preview ready', 'ok');
  } catch (err) {
    ctx.setStatus('AI preview failed: ' + errorToString(err), 'error');
    ctx.setAiBusy(false);
  }
}

export async function aiRewriteTextImpl(
  ctx: AiRewriteTextContext,
  elementId: string,
): Promise<void> {
  if (ctx.aiBusy) return;
  const brief = await ctx.openTextModal({
    title: 'AI rewrite',
    label: 'How should this text change?',
    placeholder: 'Make it punchier',
    multiline: true,
  });
  if (brief === null || brief.trim().length === 0) return;
  const prompt =
    'Rewrite the text element with id=' +
    elementId +
    ' using the rewriteText tool. ' +
    'Owner brief: ' +
    brief;
  void ctx.runAiPreview(prompt);
}

// Map the modal's aspect ratio choice to a synthetic boxW/boxH pair so the
// /assets/generate server (which snaps box ratio to a Flux preset) lands
// on the exact preset the Owner picked. We keep the server contract
// unchanged — no new aspect_ratio field on the wire — so the existing
// single-shot generation path and tests stay valid.
export function aspectRatioToBox(aspect: string): { w: number; h: number } {
  if (aspect === '1:1') return { w: 1024, h: 1024 };
  if (aspect === '16:9') return { w: 1024, h: 576 };
  if (aspect === '4:3') return { w: 1024, h: 768 };
  if (aspect === '9:16') return { w: 576, h: 1024 };
  return { w: 1024, h: 1024 };
}

export async function aiReplaceMediaImpl(
  ctx: AiReplaceMediaContext,
  elementId: string,
): Promise<void> {
  if (ctx.aiBusy) return;
  const found = ctx.findElement(elementId);
  if (!found || found.element.type !== 'media' || found.element.mediaKind !== 'image') {
    ctx.setStatus('AI generation supports image elements only', 'error');
    return;
  }
  const element = found.element as MediaElement;
  const altInputId = 'media-upload-alt-' + element.id;
  function readAltValue(): string {
    const altInput = document.getElementById(altInputId);
    if (altInput instanceof HTMLInputElement && typeof altInput.value === 'string') {
      return altInput.value;
    }
    return typeof element.alt === 'string' ? element.alt : '';
  }

  // requestFn invoked four times in parallel by the modal. Each call hits
  // the same /assets/generate route the single-shot path uses; only the
  // synthesised box dimensions change to steer Flux toward the chosen
  // aspect preset.
  async function requestOne(
    prompt: string,
    aspectRatio: string,
  ): Promise<{ blob: Blob; mediaType: string }> {
    const box = aspectRatioToBox(aspectRatio);
    const altValue = readAltValue();
    const response = await ctx.authFetch(ctx.siteBase + '/assets/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        alt: altValue,
        boxW: box.w,
        boxH: box.h,
      }),
    });
    if (!response.ok) {
      let detail: string = response.statusText;
      try {
        const errBody = (await response.json()) as { error?: unknown };
        if (errBody && typeof errBody.error === 'string') detail = errBody.error;
      } catch (_) {
        /* ignore */
      }
      throw new Error(detail);
    }
    const mediaType = response.headers.get('content-type') || 'image/webp';
    if (!mediaType.startsWith('image/')) {
      throw new Error('server did not return image bytes');
    }
    const blob = await response.blob();
    return { blob: blob, mediaType: mediaType };
  }

  const picked = await ctx.openAiMediaModal({
    title: 'AI media',
    defaultPrompt: '',
    requestFn: requestOne,
  });
  if (!picked) return;
  // Picking a tile in the 4-up modal IS the apply — the modal is already
  // the preview, so the inspector-preview confirmation that the single-
  // shot path uses would just be a redundant second click hidden at the
  // bottom of the inspector.
  ctx.setStatus('Saving…');
  try {
    await ctx.uploadGeneratedBlobToElement(element, picked.blob, picked.mediaType, readAltValue());
    ctx.setStatus('Applied', 'ok');
  } catch (err) {
    ctx.setStatus('Apply failed: ' + errorToString(err), 'error');
  }
}

export async function aiCreateSectionImpl(
  ctx: AiCreateSectionContext,
  afterSectionId: string,
): Promise<void> {
  if (ctx.aiBusy) return;
  const brief = await ctx.openTextModal({
    title: 'AI section',
    label: 'What goes in this section?',
    placeholder: 'pricing tiers for a launch plan',
    multiline: true,
  });
  if (brief === null || brief.trim().length === 0) return;
  const afterClause = afterSectionId
    ? 'Insert it after section id=' + afterSectionId + '.'
    : 'Append it at the end of the page.';
  const prompt =
    'Create a new section using the designSection tool. ' +
    'Use a semantic layout tree with stack, grid, or split nodes; avoid media leaves. ' +
    afterClause +
    ' Owner brief: ' +
    brief;
  void ctx.runAiPreview(prompt);
}
