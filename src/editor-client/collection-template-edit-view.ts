// src/editor-client/collection-template-edit-view.ts
//
// ADR 0065 Phase 3 — visual chrome around the in-place template-edit mode.
//
// When `ctx.editingCollectionTemplate` pins a Collection, the editor:
//   * dims every canvas element wrapper EXCEPT the active template
//     wrapper, its ancestors, and its descendants (`opacity: 0.32` +
//     `data-template-edit-dimmed="true"` stamped via inline style on
//     each affected wrapper) — codex review pass 2 finding 3 replaced
//     the prior single-scrim approach because `#canvas-root` carries
//     the camera transform and therefore forms its own stacking context,
//     which trapped the active wrapper's `z-index: 5` inside canvas-
//     root's bounds while the scrim (mounted as a viewport sibling)
//     painted over the entire canvas-root including the active template.
//     Per-element dimming makes the visual outcome stacking-context-
//     agnostic: dimmed wrappers paint at 32% opacity individually, the
//     active wrapper paints at 100% — no stacking-context arithmetic
//     required;
//   * appends an "Editing template — substitutions apply at publish"
//     banner directly above the wrapper, mounted into the wrapper's
//     parent so the camera/layout transform carries it;
//   * appends a "Done" button directly below the wrapper, also editor-
//     only, calling `ctx.exitCollectionTemplateEdit()` on click;
//   * pans the viewport so the template wrapper is centered, then on
//     exit pans back to the camera snapshot taken at enter time.
//
// All DOM created here carries `data-editor-only="true"` so a publish-
// path source-guard grep catches any accidental leak. The publish
// renderers MUST NOT import this module — collection-template-edit-view.
// smoke.ts pins that contract.
//
// Failure path (CLAUDE.md no-fallback rule):
//   * If the active collectionId references no live wrapper (the
//     Collection was deleted concurrently by another collaborator), the
//     mount no-ops and the next render-pass clears the field via the
//     Phase 2C exit verb. We do NOT silently delete the field here — the
//     ADR's D6 failure-path discipline owns the recovery.
//
// Boot-order contract: `mountTemplateEditChromeImpl(ctx)` runs late in
// `renderAllImpl` so the wrapper's own per-element body has already
// settled. Idempotent — re-running the mount strips prior chrome before
// re-mounting.

import type { DomContext, EditorContext } from './editor-context.js';
import { cssEscape } from './css-escape.js';
import { panToElementImpl, type PanToElementContext } from './section-toolbar.js';
import { applyCameraTransform } from './render.js';

// ADR 0064 — narrow Pick-based contexts for the in-place template-edit
// chrome mount. The module reads `root` for the canvas-root DOM scope,
// forwards `ctx` to `panToElementImpl` (PanToElementContext already
// folds in StateContext + viewport + CameraTransformContext +
// getPagePosition) and to `applyCameraTransform` (CameraTransformContext,
// already inside PanToElementContext), and touches the pin verbs
// `editingCollectionTemplate` + `exitCollectionTemplateEdit` directly.
// `buildDoneButton` rides a one-field surface so the click closure does
// not retain anything beyond the exit verb it actually fires.
export type DoneButtonContext = Pick<EditorContext, 'exitCollectionTemplateEdit'>;

export type MountTemplateEditChromeContext = PanToElementContext &
  Pick<DomContext, 'root'> &
  Pick<EditorContext, 'editingCollectionTemplate' | 'exitCollectionTemplateEdit'>;

/** Class on the editor-only scrim/banner/done DOM. Used as the idempotency
 *  marker — re-running the mount strips any prior chrome first. */
const CHROME_CLASS = 'opencanvas-collection-template-edit-chrome';

/** Exact banner text per ADR 0065 D5. */
const BANNER_TEXT = 'Editing template — substitutions apply at publish';

/** Camera snapshot taken at enter time so the exit handler can pan back.
 *  Module-private — the ctx surface stays unchanged. Keyed by collectionId
 *  so a re-enter on the same Collection after exit-with-no-pan-back
 *  (theoretical edge — exit always restores) doesn't stomp the saved
 *  origin. Single-entry in practice since edit mode is mutually exclusive
 *  with itself per ADR 0065 D6. */
let cameraSnapshot: { collectionId: string; x: number; y: number; zoom: number } | null = null;

/** Strip any prior chrome the augmenter mounted onto the editor DOM tree.
 *  Idempotent — re-running the mount calls this first so re-render after
 *  a state-tick leaves exactly one chrome block (or none).
 *
 *  Codex review pass 2 finding 3: prior versions also stripped a `-scrim`
 *  child from the viewport. That scrim was removed in favour of per-
 *  wrapper dimming (see mountTemplateEditChromeImpl); strip dimmed-marker
 *  attributes + their inline opacity off every previously-affected
 *  wrapper here so the next renderAll() starts from a clean visual slate.
 *  The `viewport` parameter is retained for one last viewport-level scrub
 *  in case an in-flight worktree carries an old scrim — but since the
 *  scrim is no longer built, the lookup hits zero nodes in steady state. */
function stripChrome(root: HTMLElement, viewport: HTMLElement | null): void {
  // Strip banner + Done button from inside the canvas root (they mount
  // into the Collection wrapper, which lives under root). Also clear any
  // template-edit marker attributes the prior mount stamped on wrappers
  // so the next renderAll() starts from a clean slate.
  const existing = root.querySelectorAll('.' + CHROME_CLASS);
  for (let i = 0; i < existing.length; i++) {
    const node = existing[i];
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }
  const marked = root.querySelectorAll('[data-template-edit-active]');
  for (let i = 0; i < marked.length; i++) {
    const node = marked[i];
    if (node instanceof HTMLElement) {
      node.removeAttribute('data-template-edit-active');
      node.style.removeProperty('z-index');
    }
  }
  // Codex review pass 2 finding 3 — strip per-wrapper dim markers + inline
  // opacity from every wrapper that prior mounts touched. Without this
  // scrub a stale state-tick would leave wrappers permanently dimmed.
  const dimmed = root.querySelectorAll('[data-template-edit-dimmed]');
  for (let i = 0; i < dimmed.length; i++) {
    const node = dimmed[i];
    if (node instanceof HTMLElement) {
      node.removeAttribute('data-template-edit-dimmed');
      node.style.removeProperty('opacity');
    }
  }
  // Defensive scrim scrub — the per-wrapper dimming replaces the prior
  // single-scrim approach (codex review pass 2 finding 3). The lookup
  // hits zero in steady state since buildScrim is no longer wired, but
  // an in-flight worktree carrying a half-applied refactor would still
  // need the cleanup to land cleanly.
  if (viewport) {
    const scrims = viewport.querySelectorAll('.' + CHROME_CLASS + '-scrim');
    for (let i = 0; i < scrims.length; i++) {
      const node = scrims[i];
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
  }
}

/** Build the "Editing template — substitutions apply at publish" banner.
 *  Inline styles only — no dependency on styles.css so smokes that
 *  bypass the stylesheet still see correctly-styled chrome. */
function buildBanner(): HTMLDivElement {
  const banner = document.createElement('div');
  banner.className = CHROME_CLASS + ' ' + CHROME_CLASS + '-banner';
  banner.setAttribute('data-editor-only', 'true');
  banner.style.cssText = [
    'position: absolute',
    'left: 0',
    'right: 0',
    'bottom: 100%',
    'margin-bottom: 8px',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'padding: 8px 12px',
    'background: rgba(254, 249, 231, 0.95)',
    'border: 1px dashed #e0b96b',
    'border-radius: 6px',
    'color: #6b4f1b',
    'font-family: system-ui, -apple-system, sans-serif',
    'font-size: 12px',
    'line-height: 1.4',
    'pointer-events: none',
    'z-index: 2',
  ].join('; ');
  banner.textContent = BANNER_TEXT;
  return banner;
}

/** Build the "Done" button mounted below the template wrapper. Click calls
 *  ctx.exitCollectionTemplateEdit() — same verb the inspector's "Done
 *  editing template" button drives, so the two affordances are mutually
 *  exclusive states of the same single source of truth. */
function buildDoneButton(ctx: DoneButtonContext): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = CHROME_CLASS + ' ' + CHROME_CLASS + '-done';
  btn.setAttribute('data-editor-only', 'true');
  btn.setAttribute('data-collection-template-done', 'true');
  btn.textContent = 'Done';
  btn.style.cssText = [
    'position: absolute',
    'left: 50%',
    'top: 100%',
    'transform: translate(-50%, 8px)',
    'padding: 8px 20px',
    'background: #1f2937',
    'color: #ffffff',
    'border: none',
    'border-radius: 6px',
    'font-family: system-ui, -apple-system, sans-serif',
    'font-size: 13px',
    'font-weight: 600',
    'cursor: pointer',
    'z-index: 2',
  ].join('; ');
  btn.addEventListener('click', function (ev: MouseEvent) {
    // Stop the click from also being read by the canvas root listener as
    // "click outside the template" — the Done button IS the explicit exit
    // affordance, the click-outside path is the implicit one.
    ev.stopPropagation();
    ctx.exitCollectionTemplateEdit();
  });
  return btn;
}

/** Codex review pass 2 finding 3 — dim every element wrapper that is NOT
 *  the active template wrapper, NOT an ancestor of it, and NOT a
 *  descendant of it. Inline `opacity: 0.32` + `data-template-edit-dimmed`
 *  marker on each affected node.
 *
 *  Why this shape instead of a single scrim DOM element: `#canvas-root`
 *  carries the camera transform, which forces it to form its own
 *  stacking context. Any z-index on a canvas-root descendant (including
 *  the active wrapper's `z-index: 5`) is bounded by canvas-root's own
 *  z-index in the viewport's stacking context. A scrim mounted as a
 *  viewport-direct sibling of canvas-root therefore paints OVER the
 *  entire canvas-root including the active template — the wrapper's
 *  z-index can't punch through.
 *
 *  Per-wrapper dimming sidesteps the stacking-context problem entirely:
 *  dimmed wrappers paint at 32% opacity individually, the active wrapper
 *  and its ancestors/descendants paint at 100%. No z-index arithmetic
 *  required. The visual outcome — surround dimmed, template bright — is
 *  identical to the scrim's intent.
 *
 *  Ancestor preservation matters because the active wrapper lives inside
 *  a Collection that sits inside a section, which lives inside the
 *  artboard. If we dimmed every "other" wrapper without checking
 *  ancestry, the section enclosing the active Collection would dim and
 *  drag the active wrapper down with it (opacity cascades to descendants
 *  in the paint pass). Descendant preservation matters because the
 *  active wrapper's `customTemplate` children render as `.opencanvas-
 *  element` wrappers inside it — those ARE the elements being edited.
 *
 *  The lookup uses `data-opencanvas-element` (the canvas wrapper's id
 *  attribute) as the target set, mirroring how `selection.ts` finds the
 *  selected wrapper. */
function applyDimmingToOtherWrappers(root: HTMLElement, activeWrapper: HTMLElement): void {
  const wrappers = root.querySelectorAll('[data-opencanvas-element]');
  for (let i = 0; i < wrappers.length; i++) {
    const node = wrappers[i];
    if (!(node instanceof HTMLElement)) continue;
    if (node === activeWrapper) continue;
    if (node.contains(activeWrapper)) continue;
    if (activeWrapper.contains(node)) continue;
    node.setAttribute('data-template-edit-dimmed', 'true');
    node.style.setProperty('opacity', '0.32');
  }
}

/** Mount the chrome onto the editor for the active template, or strip
 *  prior chrome when no template is active. Idempotent — safe to call
 *  every renderAll().
 *
 *  Side effects beyond DOM:
 *   * captures ctx.camera into the module-private snapshot the first time
 *     a given collectionId enters edit mode, so the exit handler can pan
 *     back;
 *   * pans the viewport via panToElementImpl on first-mount-for-id;
 *   * on transition active → inactive, restores camera from the snapshot
 *     and clears it.
 */
export function mountTemplateEditChromeImpl(ctx: MountTemplateEditChromeContext): void {
  if (!ctx.root) return;

  const active = ctx.editingCollectionTemplate;

  // -- Transition: active → null (or different collectionId) -------------
  // If we have a snapshot but the active state doesn't match, restore the
  // camera before stripping chrome. The strip itself is unconditional.
  if (cameraSnapshot !== null) {
    const matches = active !== null && cameraSnapshot.collectionId === active.collectionId;
    if (!matches) {
      ctx.camera.x = cameraSnapshot.x;
      ctx.camera.y = cameraSnapshot.y;
      ctx.camera.zoom = cameraSnapshot.zoom;
      applyCameraTransform(ctx);
      cameraSnapshot = null;
    }
  }

  stripChrome(ctx.root, ctx.viewport);

  if (active === null) return;

  // -- Active: locate the wrapper, mount chrome, pan if first-time -------
  const wrapper = ctx.root.querySelector(
    '[data-opencanvas-element="' + cssEscape(active.collectionId) + '"][data-element-type="collection"]',
  );
  if (!(wrapper instanceof HTMLElement)) {
    // ADR 0065 D6 failure path — Collection was concurrently deleted.
    // The exit verb owns the recovery; we no-op here. The next render-
    // pass after the verb fires will see editingCollectionTemplate ===
    // null and the strip above will run unconditionally.
    return;
  }

  // -- Codex review pass 6 finding 2 — chrome-mount precondition parity --
  // Pass 4 F1 added the same precondition to `buildCollectionBodyImpl`
  // (body-builders-data.ts): render the editable template-instance ONLY
  // when the pin targets this Collection AND `display === 'custom'` AND
  // `customTemplate` is a present array. That gate kept the BODY content
  // consistent after Ctrl+Z reverted the atomic first-switch (display +
  // customTemplate); without it the CHROME mount path here would run on
  // `active !== null` alone, stamping banner/Done/dimming around a wrapper
  // whose body fell back to the normal grid.
  //
  // Codex review pass 7 finding 1 — empty array is a VALID authored state
  // (Owner drained every template child to author from scratch). The
  // body builder renders an empty editable frame in this state; the
  // chrome must mount in lockstep so the banner / Done / dimming all
  // appear. The earlier `length > 0` guard over-corrected and left the
  // Owner stranded — visible drained frame, no exit affordance. The
  // precondition is now `display === 'custom'` AND `Array.isArray()`;
  // undefined still falls through (pre-seed defence — should not happen
  // because the enter verb seeds atomically, but a partial state must
  // not mount unanchored chrome).
  //
  // Strip-then-guard order matters. `stripChrome(ctx.root, ctx.viewport)`
  // above already ran unconditionally — any previously-mounted chrome
  // (banner / Done / dim markers / camera snapshot pan-back) from a
  // valid prior state gets cleaned up regardless of whether we mount
  // new chrome. This block only DECIDES whether to mount; it never
  // skips the strip.
  //
  // We resolve the element through `ctx.findElement` to match the body
  // builder's exact source-of-truth read — querySelector wrappers carry
  // attribute slack (`data-element-type`) but the element's `display`
  // and `customTemplate` live on the canvas-state object.
  const found = ctx.findElement(active.collectionId);
  const collection = found?.element ?? null;
  const isCustomWithTemplate =
    collection !== null &&
    typeof collection === 'object' &&
    'type' in collection &&
    collection.type === 'collection' &&
    'display' in collection &&
    collection.display === 'custom' &&
    'customTemplate' in collection &&
    Array.isArray(collection.customTemplate);
  if (!isCustomWithTemplate) {
    // The body builder falls through to the normal grid in this state.
    // No edit-mode chrome should sit around a normal grid — return now
    // so banner / Done / per-wrapper dimming / camera pan are skipped.
    // The strip above already cleaned up any prior chrome, so the next
    // intentional exit verb (Esc / Done / page-switch / click-outside)
    // is responsible for clearing the stale pin loudly.
    return;
  }

  // Stamp an attr so CSS / Phase 2D click-handler can identify the
  // currently-edited wrapper without re-reading ctx state.
  wrapper.setAttribute('data-template-edit-active', 'true');
  // Codex review pass 2 finding 3 — the `z-index: 5` previously stamped
  // here tried to lift the wrapper above a viewport-level scrim, but
  // canvas-root forms its own stacking context (camera transform), so
  // the z-index couldn't escape to compete with the scrim sibling. The
  // scrim is replaced by per-wrapper dimming, so no z-index arithmetic
  // is needed — the active wrapper paints at its natural document order
  // while siblings/cousins paint at 32% opacity. stripChrome scrubs any
  // stale z-index from a prior mount.

  // -- Pan the viewport on first mount for this collectionId -------------
  if (cameraSnapshot === null || cameraSnapshot.collectionId !== active.collectionId) {
    // Snapshot first, then pan — exit will restore from the snapshot.
    cameraSnapshot = {
      collectionId: active.collectionId,
      x: ctx.camera.x,
      y: ctx.camera.y,
      zoom: ctx.camera.zoom,
    };
    panToElementImpl(ctx, active.collectionId);
  }

  // -- Codex review pass 2 finding 3 — dim every OTHER element wrapper ---
  // (not the active wrapper, not an ancestor, not a descendant) so the
  // active template stays visually bright while the surround fades.
  // Replaces the prior single-scrim mount which couldn't escape canvas-
  // root's stacking context.
  applyDimmingToOtherWrappers(ctx.root, wrapper);

  // -- Mount banner + Done relative to the wrapper -----------------------
  // The wrapper itself is absolutely-positioned within the artboard, with
  // its own width/height from box. Banner mounts above (bottom: 100%),
  // Done below (top: 100%). Both anchored INSIDE the wrapper so the
  // camera transform carries them.
  const banner = buildBanner();
  wrapper.appendChild(banner);
  const doneBtn = buildDoneButton(ctx);
  wrapper.appendChild(doneBtn);
}
