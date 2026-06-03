// src/editor-client/chat-panel.ts
//
// ADR 0058 Phase 2k.a — chat panel toggle + chat selection chip.
// canvas-client.ts:615-632 (toggleChatPanel + its toggle/close event
// wiring) and 634-662 (chat selection chip mirror of selectedElementId
// + its clear-button wiring) carry the inline twins. Both retire on
// ADR 0015 Phase 3 atomic cutover; until then, the inline IIFE is the
// production source-of-truth and this module is dead code.
//
// Two functions live here:
//
//   - toggleChatPanel(ctx) — flip the chat panel's hidden flag, mirror
//     the open state onto the toolbar toggle button's .active class, and
//     focus the chat input on open. No-op when ctx.chatPanelEl hasn't
//     mounted yet (boot order — the route ships the DOM but the early
//     wiring still null-checks).
//
//   - updateChatSelectionChipImpl(ctx) — re-render the "this element is
//     in scope" chip in the chat panel from ctx.selectedElementId +
//     ctx.chatSelectionDropped. The chip surfaces the freshly selected
//     element's type + truncated id so the agent can resolve vague
//     references ("change this to blue") to the right element. Hidden
//     when no selection, when the Owner dropped the hint, or when state
//     hasn't loaded. Exported with the `Impl` suffix per the Phase 2l
//     `renderAllImpl` precedent — the ctx interface already declares the
//     signature (ctx.updateChatSelectionChip from Phase 2o.a:372); the
//     createEditor wiring will bind `ctx.updateChatSelectionChip = () =>
//     updateChatSelectionChipImpl(ctx)` at boot.
//
// Event-listener registrations (chatToggleBtn/chatCloseBtn click →
// toggleChatPanel, chatSelectionClearBtn click → flip
// chatSelectionDropped + updateChatSelectionChip) stay inline in
// canvas-client.ts — Phase 2 never touches the IIFE. They will move
// into createEditor at Phase 3 cutover.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';

export function toggleChatPanel(ctx: EditorContext): void {
  if (!ctx.chatPanelEl) return;
  const isOpen = !ctx.chatPanelEl.hidden;
  ctx.chatPanelEl.hidden = isOpen;
  if (ctx.chatToggleBtn) ctx.chatToggleBtn.classList.toggle('active', !isOpen);
  if (!isOpen) {
    const inp = document.getElementById('canvas-chat-input');
    if (inp) inp.focus();
  }
}

export function updateChatSelectionChipImpl(ctx: EditorContext): void {
  if (!ctx.chatSelectionEl || !ctx.chatSelectionTextEl) return;
  if (!ctx.selectedElementId || ctx.chatSelectionDropped || !ctx.state) {
    ctx.chatSelectionEl.hidden = true;
    return;
  }
  const found = ctx.findElement(ctx.selectedElementId);
  const typeLabel = found && found.element ? found.element.type : 'element';
  const shortId =
    ctx.selectedElementId.length > 10
      ? ctx.selectedElementId.slice(0, 10) + '...'
      : ctx.selectedElementId;
  ctx.chatSelectionTextEl.textContent = typeLabel + ' - ' + shortId;
  ctx.chatSelectionEl.hidden = false;
}
