// src/editor-client/collection-template-edit-view.ts
//
// ADR 0065 Phase 3 — visual chrome around the in-place template-edit mode.
//
// When `ctx.editingCollectionTemplate` pins a Collection, the editor:
//   * dims the rest of the canvas surround behind a fixed-position scrim
//     anchored to ctx.viewport, so only the active template wrapper stays
//     visually crisp;
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
// Boot-order contract: `mountTemplateEditChromeImpl(ctx)` runs after
// `augmentCollectionPreviewsImpl` inside `renderAllImpl` so the wrapper's
// own per-element body has already settled. Idempotent — re-running the
// mount strips prior chrome before re-mounting.

import type { EditorContext } from './editor-context.js';
import { cssEscape } from './css-escape.js';
import { panToElementImpl } from './section-toolbar.js';
import { applyCameraTransform } from './render.js';

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
 *  a state-tick leaves exactly one chrome block (or none). */
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
  // The scrim mounts onto the viewport (not the canvas root, since the
  // root carries the camera transform which would scale the scrim).
  // Strip it explicitly from the viewport so it doesn't survive a
  // state-tick where edit mode flips off.
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
function buildDoneButton(ctx: EditorContext): HTMLButtonElement {
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

/** Build the editor-only scrim overlaying the rest of the canvas while
 *  edit mode is active. Mounted onto ctx.viewport (not the canvas root,
 *  because the root's transform would zoom the scrim with the camera —
 *  the scrim must stay anchored to the viewport rect). The scrim is
 *  semi-transparent and covers everything; the template wrapper itself
 *  carries a higher z-index via its `data-template-edit-active` data-attr
 *  so it visually punches through. */
function buildScrim(): HTMLDivElement {
  const scrim = document.createElement('div');
  scrim.className = CHROME_CLASS + '-scrim';
  scrim.setAttribute('data-editor-only', 'true');
  scrim.setAttribute('data-collection-template-scrim', 'true');
  scrim.style.cssText = [
    'position: absolute',
    'left: 0',
    'top: 0',
    'right: 0',
    'bottom: 0',
    'background: rgba(15, 23, 42, 0.32)',
    'pointer-events: none',
    'z-index: 1',
  ].join('; ');
  return scrim;
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
export function mountTemplateEditChromeImpl(ctx: EditorContext): void {
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

  // Stamp an attr so CSS / Phase 2D click-handler can identify the
  // currently-edited wrapper without re-reading ctx state.
  wrapper.setAttribute('data-template-edit-active', 'true');
  // Keep the wrapper itself above the scrim — without an explicit z-index
  // the wrapper stays at the document order baseline and the scrim above
  // covers it too. The wrapper is already absolutely positioned by
  // setBoxStyle (an ancestor of buildElementNodeImpl); position:relative
  // would clobber that. Setting z-index alone is enough since the wrapper
  // already establishes a stacking context via its transforms.
  wrapper.style.zIndex = '5';

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

  // -- Mount the scrim onto the viewport so it survives canvas re-render -
  if (ctx.viewport) {
    const scrim = buildScrim();
    ctx.viewport.appendChild(scrim);
  }

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
