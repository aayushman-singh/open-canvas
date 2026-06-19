// src/editor-client/runtime-helpers.ts
//
// ADR 0015 Phase 3 runtime bindings for closure-level editor helpers that
// were still inline when the editor-client bundle became the production
// entrypoint. These functions mirror the old IIFE behavior and bind onto
// EditorContext during createEditor boot.

import type { ActionElement } from '../canvas/elements/action.js';
import type { ChartElement } from '../canvas/elements/chart.js';
import type { FormElement } from '../canvas/elements/form.js';
import { SIDEBAR_DISPATCH } from '../canvas/elements/index.js';
import type { MediaElement } from '../canvas/elements/media.js';
import type { SidebarCommandSpec } from '../canvas/elements/sidebar-spec.js';
import type { Tab } from '../canvas/elements/tabs.js';
import type { CanvasElement, CanvasPage, CanvasSection, EditableSite } from '../canvas/schema.js';
import type { FindElementResult } from './editor-context-types.js';
import type {
  DomContext,
  EditorContext,
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import {
  CROPPER_CDN,
  CROPPER_SRI_SHA384,
  FIRST_FRAME_SEEK_SECONDS,
  POSTER_EXTRACTION_TIMEOUT_MS,
  ZOOM_MAX_MANUAL,
  ZOOM_STEP,
} from './editor-constants.js';
import { field, selectInput } from './dom-builders.js';
import { beginDragImpl } from './drag-resize.js';
import { maybeExpandEmbedShortLink } from './embed-shortlink.js';
import { isAllowedHref } from './href-utils.js';
import { newElementId } from './ids.js';
import { mountChartData } from './inspector-chart-mount.js';
import { renderActionHrefField } from './inspector-action-href.js';
import { mountActionLabel } from './inspector-action-label.js';
import { renderIconField } from './inspector-icon-picker.js';
import {
  mountAccordionItems,
  mountCarouselSlides,
  mountTableGrid,
} from './inspector-content-mounts.js';
import { mountComponentStyle } from './inspector-component-style.js';
import { mountFormFields } from './inspector-form-mounts.js';
import { mountMediaAi, mountVideoPlayback } from './inspector-media-mounts.js';
import { mountTextFontFamily, refreshCustomFontsImpl } from './inspector-text-font-family.js';
import {
  mountMediaPicker,
  mountNavLinks,
  mountNavLogo,
  mountNavPrimaryAction,
  mountNavThemeOnScroll,
} from './inspector-nav-media-picker-mounts.js';
import {
  normalizePastedHtml,
  plainTextToFragmentHtml,
  renderMathInScope,
} from './paste-normalize.js';
import {
  applyCameraTransform,
  fitZoom,
  getPagePosition as getPagePositionImpl,
  screenToWorld,
  setZoom,
  zoomAtPoint,
  type CameraProjectionContext,
  type CameraTransformContext,
  type FitToPageContext,
} from './render.js';
import {
  handleViewportMousemove,
  schedulePublishLocalPresence,
  type CoEditMousemoveContext,
} from './co-edit.js';
import { SIDEBAR_FACTORIES, type SidebarFactoryName } from './sidebar-factories.js';

type ElementRecord = Record<string, unknown>;
type CropperSelection = HTMLElement & {
  $toCanvas(options: { width: number; height: number }): Promise<HTMLCanvasElement>;
};

let cropperLoadPromise: Promise<unknown> | null = null;

// ---------------------------------------------------------------------------
// ADR 0064 — narrow context aliases for runtime-helpers.ts. The runtime-
// helpers module is the largest single carve on the queue (~36 ctx-taking
// signatures), so the narrow surfaces are grouped here at the top of the
// file. Each alias is one cohesive view of EditorContext; the function
// signatures below sign against the alias instead of the wide
// `EditorContext`. `EditorContext` itself still appears in two places: the
// `installRuntimeHelpers` boot binder (which writes ~40 methods onto ctx
// and so legitimately needs the wide shape) and an inline cast in the
// publishing/save save-queue tail where the narrow surface would otherwise
// force a tangle of forwarded picks across modules that have not yet carved.
// ---------------------------------------------------------------------------

// ADR 0064 — `currentPage` reads only the loaded site + the active-page id.
// StateContext stops at `state` itself; the active-page id rides EditorContext
// directly, so a tight inline Pick names the exact pair.
export type CurrentPageContext = Pick<EditorContext, 'state' | 'activePageId'>;

// ADR 0064 — `setStatus` is the bound impl behind the canonical
// StatusEmitterContext alias. The impl itself reads/writes the status DOM
// node (DomContext.statusEl) and the auto-clear timer slot the IIFE pins on
// ctx — a tight pair that no canonical alias owns. Exported so the boot
// binder + any future direct caller picks up the same shape.
export type SetStatusContext = Pick<DomContext, 'statusEl'> & Pick<EditorContext, 'statusTimer'>;

// ADR 0064 — preserving the inspector's scroll position across renders
// pairs the inspector DOM ref (DomContext) with the per-subject latch the
// IIFE pins on ctx so the same scrollTop is restored only when the subject
// is unchanged.
export type PreserveInspectorScrollForContext = Pick<DomContext, 'inspector'> &
  Pick<EditorContext, 'inspectorRenderSubject'>;

// ADR 0064 — `revokePendingPreviews` walks the inspector subtree for any
// `[data-object-url]` blob URLs to revoke. No other ctx surface touched.
export type RevokePendingPreviewsContext = Pick<DomContext, 'inspector'>;

// ADR 0064 — `selectableSectionRoles` is a pure constant returner; per
// ADR 0059 the only legal role is `'body'`. Neither argument is read,
// so the alias declares an empty surface to keep the impl honest.
export type SelectableSectionRolesContext = Pick<EditorContext, never>;

// ADR 0064 — `applyPageStyleProperties` is a thin wrapper around
// `ctx.pageRenderWidth(page)`; the single verb is the entire ctx surface.
export type ApplyPageStylePropertiesContext = Pick<EditorContext, 'pageRenderWidth'>;

// ADR 0064 — `buildSectionNode` composes the children via the bound
// `buildElementNode` verb and tags the section with `data-selected` from
// the selection state. Two fields, both with a clear owner.
export type BuildSectionNodeContext = Pick<EditorContext, 'buildElementNode' | 'selectedSectionId'>;

// ADR 0064 — `renderInspectorSpec` is the union of every inspector field
// renderer the spec format can dispatch to. The spec walks fields and
// hands element + host to one of ~16 mount helpers (action-href, icon,
// action-label, media-ai/video/picker, accordion/carousel/table, nav-
// links/logo/primary-action, chart, form fields/style, text-font-family),
// plus an embed-shortlink expand path on `text` fields. The surface
// unions every mount's narrow context so the forwarded `ctx` argument
// typechecks at every call without per-call casts. `aiBusy` and the
// inspector-action handler map gate the `button-action` field kind;
// the remaining picks are owned by individual mounts (`ICON_SVG_MAP`
// for the icon picker, `serializeContentToRuns` for accordion bodies,
// asset upload verbs for the carousel + nav-logo + media-picker, and
// `customFonts` for the text-font-family picker).
export type RenderInspectorSpecContext = DomContext &
  StateContext &
  RenderContext &
  PersistContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    | 'aiBusy'
    | 'INSPECTOR_ACTION_HANDLERS'
    | 'ICON_SVG_MAP'
    | 'serializeContentToRuns'
    | 'buildPickerThumb'
    | 'postAssetUpload'
    | 'runDeleteAsset'
    | 'applyAssetIdToElement'
    | 'uploadMediaForElement'
    | 'customFonts'
  >;

// ADR 0064 — `persistStateSnapshot` is the inner HTTP-PUT helper that
// powers the saveQueue tail. Reads the access/session flags to decide
// whether to surface failure toasts, then runs the auth-wrapped PUT
// against `siteBase` and emits status. `authFetch` + `siteBase` live on
// PersistContext via a per-field Pick (PersistContext owns `authFetch`
// already; `siteBase` lives directly on EditorContext).
export type PersistStateSnapshotContext = StatusEmitterContext &
  Pick<EditorContext, 'accessRevoked' | 'sessionExpired' | 'authFetch' | 'siteBase'>;

// ADR 0064 — `saveStateNow` clones state, chains onto the saveQueue,
// then forwards into persistStateSnapshot. The two extras beyond the
// inner helper's surface are the cloned state itself and the saveQueue
// promise slot.
export type SaveStateNowContext = PersistStateSnapshotContext &
  Pick<EditorContext, 'state' | 'saveQueue'>;

// ADR 0064 — `flushPendingSave` flushes the debounce timer, calls the
// bound `saveStateNow`, then surfaces a "Save failed; action stopped"
// toast (gated on the access/session flags so a revoked-session save
// doesn't paint a misleading red toast on top of the session-end UI).
export type FlushPendingSaveContext = StatusEmitterContext &
  Pick<EditorContext, 'saveTimer' | 'saveStateNow' | 'accessRevoked' | 'sessionExpired'>;

// ADR 0064 — `buildPickerThumb` assembles a `<siteBase>/assets/<id>` URL
// for the thumbnail src. `siteBase` is the only ctx surface; the rest of
// the function builds DOM from arguments.
export type BuildPickerThumbContext = Pick<EditorContext, 'siteBase'>;

// ADR 0064 — `postAssetUpload` POSTs a Blob + alt + (optional) siteId/
// elementId to the auth-wrapped owner-assets endpoint. PersistContext
// already names the (authFetch, apiBase, siteId) triple this function
// touches; no module-specific verbs.
export type PostAssetUploadContext = PersistContext;

// ADR 0064 — `applyAssetIdToElement` writes the new assetId onto the
// element, re-renders, schedules a save, then upserts the slot-history
// row via authFetch. RenderContext for `rebuildElement`; PersistContext
// for `scheduleSave` + `authFetch` + `apiBase` + `siteId`.
export type ApplyAssetIdToElementContext = RenderContext & PersistContext;

// ADR 0064 — `clearDeletedAssetFromLocalState` walks every media element
// in state (header/footer/pages) and clears `assetId` / `posterAssetId`
// matches. StateContext for the walk root; Render + Persist for the
// post-mutation `renderAll` + `scheduleSave` when at least one slot
// was cleared.
export type ClearDeletedAssetFromLocalStateContext = StateContext & RenderContext & PersistContext;

// ADR 0064 — `runDeleteAsset` runs the two-phase asset DELETE: probe
// without `?confirm=1` to gather references, surface the confirm modal
// with a reference summary, then re-call with `?confirm=1`. Forwards
// into `clearDeletedAssetFromLocalState` on success. PersistContext
// carries authFetch + apiBase; StatusEmitterContext + openConfirmModal
// are the local-only surface this carve adds.
export type RunDeleteAssetContext = PersistContext &
  StatusEmitterContext &
  ClearDeletedAssetFromLocalStateContext &
  Pick<EditorContext, 'openConfirmModal'>;

// ADR 0064 — `uploadMediaForElement` runs the image-or-video upload
// pipeline: optionally crop, post the asset blob, then forward into
// `applyAssetIdToElement` + re-render the inspector. The status emitter
// surfaces the in-flight progress + final result toasts. Both
// `postAssetUpload` and `applyAssetIdToElement` are bound ctx-methods
// so the forwarded call typechecks against the same wider surface.
export type UploadMediaForElementContext = StatusEmitterContext &
  RenderContext &
  Pick<EditorContext, 'postAssetUpload' | 'applyAssetIdToElement'>;

// ADR 0064 — `generateImageForElement` POSTs the prompt to the per-site
// asset-generate endpoint, then forwards the response blob into
// `showGeneratePreview` so the Owner can Apply/Discard before the upload
// lands. Pairs StatusEmitterContext with the (authFetch, siteBase)
// network pair, then folds in the preview context.
export type GenerateImageForElementContext = StatusEmitterContext &
  ShowGeneratePreviewContext &
  Pick<EditorContext, 'authFetch' | 'siteBase'>;

// ADR 0064 — `showGeneratePreview` mounts the Preview card inside the
// inspector with Apply + Discard buttons. Apply forwards into
// `applyGeneratePreview` which runs the final upload pipeline; Discard
// revokes the blob URL and toasts "Discarded".
export type ShowGeneratePreviewContext = Pick<DomContext, 'inspector'> &
  StatusEmitterContext &
  ApplyGeneratePreviewContext;

// ADR 0064 — `applyGeneratePreview` runs the final upload pipeline
// behind the Apply button on the AI preview card. Calls the bound
// `uploadGeneratedBlobToElement`; surfaces "Saving..." → "Applied" /
// "Apply failed" toasts.
export type ApplyGeneratePreviewContext = StatusEmitterContext &
  Pick<EditorContext, 'uploadGeneratedBlobToElement'>;

// ADR 0064 — `uploadGeneratedBlobToElement` is the AI-blob-to-asset
// uploader. POSTs the generated blob as a File with a synthesized
// filename, then writes the returned assetId + alt onto the element and
// re-renders the inspector + schedules a save. Same shape as
// `applyAssetIdToElement` because they both write the element + bind the
// post-write render tail.
export type UploadGeneratedBlobToElementContext = RenderContext & PersistContext;

// ADR 0064 — `pointerToCanvas` converts a screen pointer event into the
// per-section canvas-local coordinate the element-resize / drag handlers
// expect. Only the camera projection pair is needed; the math runs off
// `getBoundingClientRect()` + `screenToWorld` (which rides
// CameraProjectionContext from render.ts).
export type PointerToCanvasContext = CameraProjectionContext;

// ADR 0064 — `mountViewport` builds the viewport scaffold, zoom toolbar,
// pan handlers, and wheel handler. Pulls in the camera + viewport DOM
// (DomContext for `root` + `viewport`), the camera-transform broadcast
// surface (for `applyCameraTransform(ctx)` calls), and the interaction-
// mode state machine (set/clear verbs + the mode field itself + the
// toolbar root the boot-time scaffold mounts into). The toolbar "Fit"
// button forwards into `fitZoom(ctx)` in render.ts, so the alias folds
// in FitToPageContext (pagePositions cache + currentPage) to keep the
// forwarded call typechecked without a cast.
export type MountViewportContext = Pick<DomContext, 'root' | 'viewport'> &
  CameraTransformContext &
  FitToPageContext &
  Pick<
    EditorContext,
    | 'zoomToolbar'
    | 'interactionMode'
    | 'setInteractionMode'
    | 'clearTemporaryPanState'
    | 'reducedMotionPreview'
    | 'renderAll'
  >;

// ADR 0064 — `resolveElementWrapperAtPoint` walks the rendered DOM under
// `ctx.root` looking for the deepest `.opencanvas-element` wrapper that
// either contains the pointer or whose descendants do. Only `root` is
// touched; the math runs off DOM geometry alone.
export type ResolveElementWrapperAtPointContext = Pick<DomContext, 'root'>;

// ADR 0064 — `resolveNestedInsertionTarget` walks the selected element's
// `findElement` result to determine whether sibling-insertion should
// land inside a tabs-panel / collection-entry / collection-custom-
// template array. StateContext owns `findElement`; SelectionContext owns
// `selectedElementId`; this carve picks the field directly to keep the
// surface minimal.
export type ResolveNestedInsertionTargetContext = StateContext &
  Pick<EditorContext, 'selectedElementId'>;

// ADR 0064 — `addElementToContainer` is the shared tail every new-
// element insertion runs: optionally tag the element with the page's
// default motion preset, push into the container array, renderAll,
// selectElement(id), scheduleSave. StateContext for the page lookup;
// RenderContext + PersistContext for the tail; SelectionContext for the
// post-mutation re-select.
export type AddElementToContainerContext = StateContext &
  RenderContext &
  PersistContext &
  Pick<SelectionContext, 'selectElement'>;

// ADR 0064 — `insertElementForSidebarCommand` looks up a sidebar
// command, runs its factory, then routes the result into either the
// nested-container path (when a tabs/collection child is selected) or
// the section-level `addElementToSection` path with a defaultBox layout.
// Composes the resolve + add helpers with the three module-specific
// verbs the dispatcher itself reads.
export type InsertElementForSidebarCommandContext = ResolveNestedInsertionTargetContext &
  AddElementToContainerContext &
  Pick<EditorContext, 'SIDEBAR_COMMANDS' | 'defaultBox' | 'addElementToSection'>;

// ADR 0064 — `forceOpenInspector` unsides the inspector panel (clears
// the `hidden` flag + the `collapsed` class) and resets the toggle
// chevron. Only `inspector` is touched on ctx.
export type ForceOpenInspectorContext = Pick<DomContext, 'inspector'>;

// ADR 0064 — `openLinkModal` is a re-entrant modal builder; the only
// ctx surface is the boot-time `modalOpen` latch that prevents
// double-open. No DOM cache needed — the modal mounts directly under
// `document.body`.
export type OpenLinkModalContext = Pick<EditorContext, 'modalOpen'>;

// ADR 0064 — `attachChromeToggles` wires the document-click outside-
// menu close, the sidebar-toggle click + camera compensation, and the
// inspector-toggle click + render gate. DomContext covers sidebar +
// viewport + inspector; CameraTransformContext covers the camera +
// applyCameraTransform broadcast; the SelectionContext partials + the
// menu-close pair name the per-handler verbs.
export type AttachChromeTogglesContext = DomContext &
  CameraTransformContext &
  Pick<RenderContext, 'renderInspector'> &
  Pick<SelectionContext, 'selectedElementId' | 'selectedSectionId'> &
  Pick<EditorContext, 'openMenuElementId' | 'closeElementMenu'>;

// ADR 0064 — `wireCoEditPresenceListeners` is the boot-time wire-up for
// the window scroll/resize/mousemove + document selectionchange
// listeners that drive remote-cursor repaint + local-presence publish.
// Forwards into co-edit.ts helpers; the union of their narrow contexts
// (CoEditMousemoveContext already extends CoEditPresencePublishContext)
// plus the bound `repaintRemoteCursors` verb names the entire surface.
export type WireCoEditPresenceListenersContext = CoEditMousemoveContext &
  Pick<EditorContext, 'repaintRemoteCursors'>;

// ADR 0064 — `wireMarkToolbarReflowListeners` is the boot-time wire-up
// for the window scroll/resize listeners that reposition the floating
// mark toolbar after viewport changes. Only the optional callback slot
// is touched on ctx.
export type WireMarkToolbarReflowListenersContext = Pick<EditorContext, 'onMarkToolbarReflow'>;

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

function buildSidebarCommandLookup(): Record<string, SidebarCommandSpec> {
  const commands: Record<string, SidebarCommandSpec> = {};
  const specs = Object.values(SIDEBAR_DISPATCH);
  for (let si = 0; si < specs.length; si++) {
    const spec = specs[si]!;
    for (let ci = 0; ci < spec.commands.length; ci++) {
      const command = spec.commands[ci]!;
      commands[command.key] = command;
    }
  }
  return commands;
}

export function installRuntimeHelpers(ctx: EditorContext): void {
  ctx.SIDEBAR_COMMANDS = buildSidebarCommandLookup();
  ctx.INSPECTOR_ACTION_HANDLERS = {
    'rewrite-text': (id) => {
      void ctx.aiRewriteText(id);
    },
    'replace-media': (id) => {
      void ctx.aiReplaceMedia(id);
    },
  };
  ctx.findElement = (elementId) => findElementImpl(ctx, elementId);
  ctx.buildPickerThumb = (assetId, selectedAssetId, onClick) =>
    buildPickerThumbImpl(ctx, assetId, selectedAssetId, onClick);
  ctx.postAssetUpload = (blob, altValue, elementId) =>
    postAssetUploadImpl(ctx, blob, altValue, elementId);
  ctx.setStatus = (text, tone) => setStatusImpl(ctx, text, tone);
  ctx.applyAssetIdToElement = (element, nextAssetId, refreshFn, nextKind) =>
    applyAssetIdToElementImpl(ctx, element, nextAssetId, refreshFn, nextKind);
  ctx.runDeleteAsset = (assetId, refreshFn) => runDeleteAssetImpl(ctx, assetId, refreshFn);
  ctx.uploadMediaForElement = (element, file, refreshFn) =>
    uploadMediaForElementImpl(ctx, element, file, refreshFn);
  ctx.findSection = (sectionId) => findSectionImpl(ctx, sectionId);
  ctx.preserveInspectorScrollFor = (subject) => preserveInspectorScrollForImpl(ctx, subject);
  ctx.revokePendingPreviews = () => revokePendingPreviewsImpl(ctx);
  ctx.selectableSectionRoles = (section) => selectableSectionRolesImpl(ctx, section);
  ctx.currentPage = () => currentPageImpl(ctx);
  ctx.applyPageMotionAttributes = (article, page) => applyPageMotionAttributesImpl(article, page);
  ctx.applyPageStyleProperties = (article, page) =>
    applyPageStylePropertiesImpl(ctx, article, page);
  ctx.pageRenderWidth = (page) => pageRenderWidthImpl(page);
  ctx.renderInspectorSpec = (spec, element) => renderInspectorSpecImpl(ctx, spec, element);
  ctx.saveStateNow = () => saveStateNowImpl(ctx);
  ctx.buildSectionNode = (section, pageWidth) => buildSectionNodeImpl(ctx, section, pageWidth);
  ctx.flushPendingSave = () => flushPendingSaveImpl(ctx);
  ctx.pointerToCanvas = (event, sectionEl) => pointerToCanvasImpl(ctx, event, sectionEl);
  ctx.resolveElementWrapperAtPoint = (target, clientX, clientY) =>
    resolveElementWrapperAtPointImpl(ctx, target, clientX, clientY);
  ctx.insertElementForSidebarCommand = (section, commandKey) =>
    insertElementForSidebarCommandImpl(ctx, section, commandKey);
  ctx.getPagePosition = (pageId) => getPagePositionImpl(ctx, pageId);
  ctx.uploadGeneratedBlobToElement = (element, blob, mediaType, altValue) =>
    uploadGeneratedBlobToElementImpl(ctx, element, blob, mediaType, altValue);
  ctx.forceOpenInspector = () => forceOpenInspectorImpl(ctx);
  ctx.renderMathInScope = (scope) => renderMathInScope(scope);
  ctx.normalizePastedHtml = (html) => normalizePastedHtml(html);
  ctx.plainTextToFragmentHtml = (plain) => plainTextToFragmentHtml(plain);
  ctx.beginDrag = (startEv, wrapper) => beginDragImpl(ctx, startEv, wrapper);
  ctx.openLinkModal = (opts) => openLinkModalImpl(ctx, opts);
  ctx.generateImageForElement = (element, prompt) =>
    generateImageForElementImpl(ctx, element, prompt);
  ctx.isEditableShortcutTarget = (target) => isEditableShortcutTargetImpl(target);
  ctx.refreshCustomFonts = () => refreshCustomFontsImpl(ctx);
}

export function currentPageImpl(ctx: CurrentPageContext): CanvasPage | null {
  if (!ctx.state || !Array.isArray(ctx.state.pages) || ctx.state.pages.length === 0) {
    return null;
  }
  if (ctx.activePageId) {
    for (let i = 0; i < ctx.state.pages.length; i++) {
      const page = ctx.state.pages[i]!;
      if (page.id === ctx.activePageId) return page;
    }
  }
  return ctx.state.pages[0] ?? null;
}

export function findSectionImpl(ctx: StateContext, sectionId: string | null): CanvasSection | null {
  if (!sectionId || !ctx.state) return null;
  if (ctx.state.header && ctx.state.header.id === sectionId) return ctx.state.header;
  if (ctx.state.footer && ctx.state.footer.id === sectionId) return ctx.state.footer;
  const page = ctx.currentPage();
  if (!page) return null;
  for (let si = 0; si < page.sections.length; si++) {
    const section = page.sections[si]!;
    if (section.id === sectionId) return section;
  }
  return null;
}

function findElementIn(section: CanvasSection, elementId: string): FindElementResult | null {
  function searchArray(
    arr: CanvasElement[],
    kind: FindElementResult['parentKind'],
    meta: FindElementResult['parentMeta'],
  ): FindElementResult | null {
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i]!;
      if (el.id === elementId) {
        return { section, element: el, parentArray: arr, parentKind: kind, parentMeta: meta };
      }
      if (el.type === 'tabs' && Array.isArray((el as { tabs?: unknown }).tabs)) {
        const tabs = (el as { tabs: Tab[] }).tabs;
        for (let ti = 0; ti < tabs.length; ti++) {
          const tab = tabs[ti]!;
          if (!Array.isArray(tab.elements)) continue;
          const hit = searchArray(tab.elements, 'tab-panel', { tabsElement: el, tab });
          if (hit) return hit;
        }
      } else if (el.type === 'collection') {
        // ADR 0063 D6 — `entries` is the materializer's per-entry output;
        // walked so the inspector can resolve a selection on a card child.
        const collectionRecord = el as {
          entries?: unknown;
          customTemplate?: unknown;
        };
        const entries = collectionRecord.entries;
        if (Array.isArray(entries)) {
          const entriesArr = entries as unknown[];
          for (let ei = 0; ei < entriesArr.length; ei++) {
            const entry = entriesArr[ei];
            if (!Array.isArray(entry)) continue;
            const entryElements = entry as CanvasElement[];
            const hit = searchArray(entryElements, 'collection-entry', {
              collectionElement: el,
              entryIndex: ei,
            });
            if (hit) return hit;
          }
        }
        // ADR 0065 D6 — `customTemplate` is the in-place edit surface for
        // `display === 'custom'`. Recurse so selection of any template
        // child resolves (otherwise the inspector hides because it can't
        // find the selected id). Walked unconditionally — the field is
        // optional but its presence is what we care about, not display.
        const customTemplate = collectionRecord.customTemplate;
        if (Array.isArray(customTemplate)) {
          const hit = searchArray(customTemplate as CanvasElement[], 'collection-custom-template', {
            collectionElement: el,
          });
          if (hit) return hit;
        }
      } else if (el.type === 'flow-container' && Array.isArray((el as { items?: unknown }).items)) {
        const items = (el as { items: unknown[] }).items;
        for (let ii = 0; ii < items.length; ii++) {
          const item = items[ii];
          if (!item || typeof item !== 'object') continue;
          const itemRecord = item as { id?: unknown; element?: unknown };
          if (!itemRecord.element || typeof itemRecord.element !== 'object') continue;
          const hosted = itemRecord.element as CanvasElement;
          const itemId = typeof itemRecord.id === 'string' ? itemRecord.id : String(ii);
          if (hosted.id === elementId) {
            return {
              section,
              element: hosted,
              parentArray: null,
              parentKind: 'flow-item',
              parentMeta: { flowContainerElement: el, itemId },
            };
          }
          const hit = searchArray([hosted], 'flow-item', {
            flowContainerElement: el,
            itemId,
          });
          if (hit) return hit;
        }
      }
    }
    return null;
  }
  return searchArray(section.elements, 'section', null);
}

export function findElementImpl(ctx: StateContext, elementId: string): FindElementResult | null {
  if (!ctx.state) return null;
  if (ctx.state.header) {
    const hitH = findElementIn(ctx.state.header, elementId);
    if (hitH) return hitH;
  }
  if (ctx.state.footer) {
    const hitF = findElementIn(ctx.state.footer, elementId);
    if (hitF) return hitF;
  }
  const page = ctx.currentPage();
  if (!page) return null;
  for (let si = 0; si < page.sections.length; si++) {
    const hit = findElementIn(page.sections[si]!, elementId);
    if (hit) return hit;
  }
  return null;
}

export function setStatusImpl(
  ctx: SetStatusContext,
  text: string,
  tone?: 'ok' | 'error' | 'info',
): void {
  const statusEl = ctx.statusEl;
  if (!statusEl) return;
  statusEl.textContent = '';
  statusEl.className = '';
  const endsWithEllipsis = /(\u2026|\.\.\.)$/.test(text);
  if (endsWithEllipsis && tone !== 'error') {
    const spinner = document.createElement('span');
    spinner.className = 'opencanvas-spinner';
    spinner.setAttribute('data-size', 'sm');
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.marginRight = '6px';
    statusEl.appendChild(spinner);
  }
  statusEl.appendChild(document.createTextNode(text));
  if (tone === 'error') statusEl.classList.add('error');
  if (tone === 'ok') statusEl.classList.add('ok');
  if (ctx.statusTimer) clearTimeout(ctx.statusTimer);
  ctx.statusTimer = setTimeout(() => {
    if (statusEl.textContent === text || statusEl.textContent.endsWith(text)) {
      statusEl.textContent = 'Saved';
      statusEl.className = '';
    }
  }, 4000);
}

export function preserveInspectorScrollForImpl(
  ctx: PreserveInspectorScrollForContext,
  nextSubject: string,
): void {
  if (!ctx.inspector) return;
  const same = ctx.inspectorRenderSubject === nextSubject;
  ctx.inspectorRenderSubject = nextSubject;
  if (!same) {
    ctx.inspector.scrollTop = 0;
    return;
  }
  const saved = ctx.inspector.scrollTop;
  if (saved <= 0) return;
  requestAnimationFrame(() => {
    if (!ctx.inspector) return;
    ctx.inspector.scrollTop = saved;
  });
}

export function revokePendingPreviewsImpl(ctx: RevokePendingPreviewsContext): void {
  if (!ctx.inspector) return;
  const previews = ctx.inspector.querySelectorAll('[data-object-url]');
  for (let i = 0; i < previews.length; i++) {
    const url = previews[i]!.getAttribute('data-object-url');
    if (url) URL.revokeObjectURL(url);
  }
}

export function selectableSectionRolesImpl(
  _ctx: SelectableSectionRolesContext,
  _section: CanvasSection,
): string[] {
  // ADR 0059 — page sections can only carry the implicit `'body'` role;
  // header/footer pinning is gone. The role-selector UI follows in Phase 5.
  return ['body'];
}

export function pageRenderWidthImpl(page: CanvasPage | null): number {
  if (!page) {
    throw new Error('pageRenderWidth: page is null; caller passed a dangling page reference');
  }
  return page.maxWidth != null && page.maxWidth < page.width ? page.maxWidth : page.width;
}

export function applyPageMotionAttributesImpl(article: HTMLElement, page: CanvasPage): void {
  article.removeAttribute('data-motion-preset');
  article.removeAttribute('data-entrance-animation');
  article.removeAttribute('data-scroll-trigger');
  if (!page.entranceAnimation || page.entranceAnimation === 'none') return;
  const triggerMode = page.scrollTriggerMode || 'on-load';
  if (triggerMode === 'on-load') {
    article.setAttribute('data-motion-preset', page.entranceAnimation);
  } else {
    article.setAttribute('data-entrance-animation', page.entranceAnimation);
  }
  article.setAttribute('data-scroll-trigger', triggerMode);
}

export function applyPageStylePropertiesImpl(
  ctx: ApplyPageStylePropertiesContext,
  article: HTMLElement,
  page: CanvasPage,
): void {
  article.style.width = ctx.pageRenderWidth(page) + 'px';
  article.style.background = page.pageBackground || '';
  article.style.display = page.sectionGap != null ? 'flex' : '';
  article.style.flexDirection = page.sectionGap != null ? 'column' : '';
  article.style.gap = page.sectionGap != null ? page.sectionGap + 'px' : '';
  article.style.maxWidth = page.maxWidth != null ? page.maxWidth + 'px' : '';
}

// ADR 0064 — `buildSectionToolbar` is a private DOM scaffold builder
// (the section's per-recipe add-element buttons row). It threads ctx
// only to satisfy the legacy IIFE shape — the impl `void`s ctx — so
// the surface alias is empty.
function buildSectionToolbar(ctx: Pick<EditorContext, never>, section: CanvasSection): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'section-toolbar';
  const specs = Object.values(SIDEBAR_DISPATCH);
  for (let si = 0; si < specs.length; si++) {
    const commands = specs[si]!.commands;
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci]!;
      if (!cmd.toolbarLabel) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = cmd.toolbarLabel;
      button.title = cmd.toolbarTip || cmd.sidebarTip;
      button.setAttribute('data-section-action', 'add-' + cmd.key);
      button.setAttribute('data-section-id', section.id);
      bar.appendChild(button);
    }
  }
  void ctx;
  return bar;
}

export function buildSectionNodeImpl(
  ctx: BuildSectionNodeContext,
  section: CanvasSection,
  pageWidth: number,
): HTMLElement {
  const node = document.createElement('section');
  node.className = 'opencanvas-section';
  node.setAttribute('data-opencanvas-section', section.id);
  node.setAttribute('data-recipe', section.recipeId);
  if (section.backgroundEffect) node.setAttribute('data-bg-effect', section.backgroundEffect);
  if (section.navThemeTarget) node.setAttribute('data-opencanvas-nav-theme-target', section.navThemeTarget);
  if (section.entrance) node.setAttribute('data-entrance', section.entrance);
  node.style.position = 'relative';
  node.style.width = pageWidth + 'px';
  node.style.height = section.height + 'px';
  if (ctx.selectedSectionId === section.id) node.setAttribute('data-selected', 'true');
  for (let i = 0; i < section.elements.length; i++) {
    node.appendChild(ctx.buildElementNode(section.elements[i]!));
  }
  node.appendChild(buildSectionToolbar(ctx, section));
  const grip = document.createElement('div');
  grip.className = 'section-grip-handle';
  grip.setAttribute('data-section-grip', section.id);
  grip.textContent = '\u2847';
  node.appendChild(grip);
  return node;
}

export function renderInspectorSpecImpl(
  ctx: RenderInspectorSpecContext,
  spec: Parameters<EditorContext['renderInspectorSpec']>[0],
  element: CanvasElement,
): void {
  if (!ctx.inspector) return;
  const elementByPath = element as unknown as ElementRecord;
  spec.fields.forEach((f) => {
    if (f.kind === 'select') {
      let cur = elementByPath[f.path];
      if (typeof cur !== 'string' || !f.options.includes(cur)) {
        cur = f.defaultValue || f.options[0];
      }
      const sel = selectInput(f.options, String(cur));
      sel.addEventListener('change', () => {
        elementByPath[f.path] = sel.value;
        // Shape variant flips that require a dependent field. When variant
        // becomes 'icon' on a shape without an iconKind, the validator-side
        // contract demands one — assign a sane default in the same change so
        // the editor never saves a half-configured icon shape. Re-render the
        // inspector so the (showWhen-gated) icon picker mounts immediately.
        let needsInspectorRerender = false;
        if (
          f.path === 'variant' &&
          element.type === 'shape' &&
          sel.value === 'icon' &&
          typeof elementByPath.iconKind !== 'string'
        ) {
          elementByPath.iconKind = 'arrow-up-right';
          needsInspectorRerender = true;
        }
        ctx.rebuildElement(element.id);
        if (needsInspectorRerender) ctx.renderInspector();
        ctx.scheduleSave();
      });
      ctx.inspector!.appendChild(field(f.label, sel));
      return;
    }
    if (f.kind === 'select-mapped') {
      const tol = typeof f.tolerance === 'number' ? f.tolerance : 0.01;
      const raw = elementByPath[f.path];
      let curLabel: string | null = null;
      if (typeof raw === 'number') {
        for (let oi = 0; oi < f.options.length; oi++) {
          const opt = f.options[oi]!;
          if (Math.abs(opt.value - raw) < tol) {
            curLabel = opt.label;
            break;
          }
        }
      }
      if (curLabel === null) {
        for (let di = 0; di < f.options.length; di++) {
          const opt = f.options[di]!;
          if (Math.abs(opt.value - f.defaultValue) < tol) {
            curLabel = opt.label;
            break;
          }
        }
      }
      if (curLabel === null) curLabel = f.options[0]!.label;
      const labels = f.options.map((option) => option.label);
      const msel = selectInput(labels, curLabel);
      msel.addEventListener('change', () => {
        for (let oj = 0; oj < f.options.length; oj++) {
          const opt = f.options[oj]!;
          if (opt.label === msel.value) {
            elementByPath[f.path] = opt.value;
            break;
          }
        }
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      ctx.inspector!.appendChild(field(f.label, msel));
      return;
    }
    if (f.kind === 'text') {
      const ti = document.createElement('input');
      ti.type = 'text';
      const existing = elementByPath[f.path];
      ti.value = typeof existing === 'string' ? existing : '';
      if (f.placeholder) ti.placeholder = f.placeholder;
      ti.addEventListener('change', () => {
        if (f.required && ti.value.length === 0) {
          ctx.setStatus(f.label + ' cannot be empty', 'error');
          ti.value = typeof elementByPath[f.path] === 'string' ? String(elementByPath[f.path]) : '';
          return;
        }
        if (f.emptyOmits && ti.value.length === 0) {
          delete elementByPath[f.path];
        } else {
          elementByPath[f.path] = ti.value;
        }
        if (!f.noRebuild) ctx.rebuildElement(element.id);
        ctx.scheduleSave();
        if (element.type === 'embed' && f.path === 'url') {
          void maybeExpandEmbedShortLink(ctx, element, ti);
        }
      });
      ctx.inspector!.appendChild(field(f.label, ti));
      return;
    }
    if (f.kind === 'textarea') {
      const ta = document.createElement('textarea');
      if (typeof f.rows === 'number') ta.rows = f.rows;
      if (typeof f.cssText === 'string') ta.style.cssText = f.cssText;
      const existing = elementByPath[f.path];
      ta.value = typeof existing === 'string' ? existing : '';
      if (f.placeholder) ta.placeholder = f.placeholder;
      ta.addEventListener('change', () => {
        elementByPath[f.path] = ta.value;
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      ctx.inspector!.appendChild(field(f.label, ta));
      return;
    }
    if (f.kind === 'checkbox') {
      const toggleField = document.createElement('div');
      toggleField.className = 'field field--toggle';
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'opencanvas-toggle';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.className = 'opencanvas-toggle-input';
      toggleInput.checked = !!elementByPath[f.path];
      const toggleTrack = document.createElement('span');
      toggleTrack.className = 'opencanvas-toggle-track';
      toggleTrack.setAttribute('aria-hidden', 'true');
      const toggleText = document.createElement('span');
      toggleText.className = 'opencanvas-toggle-text';
      toggleText.textContent = f.label;
      toggleInput.addEventListener('change', () => {
        elementByPath[f.path] = toggleInput.checked;
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      toggleLabel.appendChild(toggleInput);
      toggleLabel.appendChild(toggleTrack);
      toggleLabel.appendChild(toggleText);
      toggleField.appendChild(toggleLabel);
      ctx.inspector!.appendChild(toggleField);
      return;
    }
    if (f.kind === 'number') {
      const ni = document.createElement('input');
      ni.type = 'number';
      if (typeof f.min === 'number') ni.min = String(f.min);
      if (typeof f.max === 'number') ni.max = String(f.max);
      let prev = typeof elementByPath[f.path] === 'number' ? Number(elementByPath[f.path]) : 0;
      ni.value = String(prev);
      ni.addEventListener('change', () => {
        const n = Number(ni.value);
        const minOk = typeof f.min !== 'number' || n >= f.min;
        const maxOk = typeof f.max !== 'number' || n <= f.max;
        if (Number.isFinite(n) && minOk && maxOk) {
          elementByPath[f.path] = n;
          prev = n;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        } else {
          ni.value = String(prev);
        }
      });
      ctx.inspector!.appendChild(field(f.label, ni));
      return;
    }
    if (f.kind === 'button-action') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = f.label;
      if (f.dataAttr) btn.setAttribute('data-ai-button', f.dataAttr);
      if (f.busyFlag === 'aiBusy' && ctx.aiBusy) btn.disabled = true;
      const handler = ctx.INSPECTOR_ACTION_HANDLERS[f.action];
      if (typeof handler !== 'function') {
        throw new Error(
          'renderInspectorSpec: no action handler registered for ' + JSON.stringify(f.action),
        );
      }
      btn.addEventListener('click', () => {
        handler(element.id);
      });
      ctx.inspector!.appendChild(btn);
      return;
    }
    if (f.kind === 'action-href') {
      renderActionHrefField(ctx, f, element as ActionElement);
      return;
    }
    if (f.kind === 'icon') {
      renderIconField(ctx, f, element);
      return;
    }
    if (f.kind === 'custom-mount') {
      const mount = inspectorMountHandler(ctx, f.name);
      if (typeof mount !== 'function') {
        throw new Error(
          'renderInspectorSpec: no mount handler registered for ' + JSON.stringify(f.name),
        );
      }
      mount(element, ctx.inspector!);
      return;
    }
    throw new Error('renderInspectorSpec: unknown field kind ' + JSON.stringify(f));
  });
}

function inspectorMountHandler(
  ctx: RenderInspectorSpecContext,
  name: string,
): ((element: CanvasElement, host: HTMLElement) => void) | null {
  const mounts: Record<string, (element: CanvasElement, host: HTMLElement) => void> = {
    'action-label': (element, host) => mountActionLabel(ctx, element as ActionElement, host),
    'media-ai': (element, host) => mountMediaAi(ctx, element as MediaElement, host),
    'media-picker': (element, host) => mountMediaPicker(ctx, element as MediaElement, host),
    'video-playback': (element, host) => mountVideoPlayback(ctx, element as MediaElement, host),
    'accordion-items': (element, host) =>
      mountAccordionItems(ctx, element as Parameters<typeof mountAccordionItems>[1], host),
    'carousel-slides': (element, host) =>
      mountCarouselSlides(ctx, element as Parameters<typeof mountCarouselSlides>[1], host),
    'table-grid': (element, host) =>
      mountTableGrid(ctx, element as Parameters<typeof mountTableGrid>[1], host),
    'nav-links': (element, host) =>
      mountNavLinks(ctx, element as Parameters<typeof mountNavLinks>[1], host),
    'nav-primary-action': (element, host) =>
      mountNavPrimaryAction(ctx, element as Parameters<typeof mountNavPrimaryAction>[1], host),
    'nav-logo': (element, host) =>
      mountNavLogo(ctx, element as Parameters<typeof mountNavLogo>[1], host),
    'nav-theme-on-scroll': (element, host) =>
      mountNavThemeOnScroll(ctx, element as Parameters<typeof mountNavThemeOnScroll>[1], host),
    'chart-data': (element, host) => mountChartData(ctx, element as ChartElement, host),
    'form-fields': (element, host) => mountFormFields(ctx, element as FormElement, host),
    'form-style': (element, host) => mountComponentStyle(ctx, element, host),
    'component-style': (element, host) => mountComponentStyle(ctx, element, host),
    'text-font-family': (element, host) => mountTextFontFamily(ctx, element, host),
  };
  return mounts[name] || null;
}

async function persistStateSnapshot(
  ctx: PersistStateSnapshotContext,
  snapshot: EditableSite,
): Promise<boolean> {
  if (ctx.accessRevoked || ctx.sessionExpired) return false;
  ctx.setStatus('Saving...');
  try {
    const response = await ctx.authFetch(ctx.siteBase, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editableState: snapshot }),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { errors?: unknown[]; error?: unknown };
        if (body && Array.isArray(body.errors) && body.errors.length > 0) {
          const first = body.errors[0];
          if (typeof first === 'string') detail = first;
        } else if (body && typeof body.error === 'string') {
          detail = body.error;
        }
      } catch (_) {
        /* statusText already carries the HTTP failure */
      }
      if (!ctx.accessRevoked && !ctx.sessionExpired) {
        ctx.setStatus('Save failed: ' + detail, 'error');
      }
      return false;
    }
    if (ctx.accessRevoked || ctx.sessionExpired) return false;
    ctx.setStatus('Saved', 'ok');
    return true;
  } catch (err: unknown) {
    if (!ctx.accessRevoked && !ctx.sessionExpired) {
      ctx.setStatus('Save failed: ' + errorToString(err), 'error');
    }
    return false;
  }
}

export async function saveStateNowImpl(ctx: SaveStateNowContext): Promise<boolean> {
  if (!ctx.state) return true;
  const snapshot = structuredClone(ctx.state);
  const task = ctx.saveQueue.catch(() => false).then(() => persistStateSnapshot(ctx, snapshot));
  ctx.saveQueue = task;
  return task;
}

export async function flushPendingSaveImpl(ctx: FlushPendingSaveContext): Promise<boolean> {
  if (ctx.saveTimer) {
    clearTimeout(ctx.saveTimer);
    ctx.saveTimer = null;
  }
  const saved = await ctx.saveStateNow();
  if (!saved && !ctx.accessRevoked && !ctx.sessionExpired) {
    ctx.setStatus('Save failed; action stopped', 'error');
  }
  return saved;
}

export function buildPickerThumbImpl(
  ctx: BuildPickerThumbContext,
  assetId: string,
  selectedAssetId: string,
  onClick: (assetId: string) => void,
): HTMLElement {
  const isEmpty = !assetId || assetId === '__placeholder__';
  if (isEmpty) {
    const cell = document.createElement('div');
    cell.className = 'picker-thumb empty';
    cell.textContent = '-';
    cell.setAttribute('title', 'No asset selected');
    return cell;
  }
  const img = document.createElement('img');
  img.className = 'picker-thumb' + (assetId === selectedAssetId ? ' selected' : '');
  img.src = ctx.siteBase + '/assets/' + encodeURIComponent(assetId);
  img.alt = '';
  img.title = assetId;
  img.addEventListener('click', () => onClick(assetId));
  return img;
}

export async function postAssetUploadImpl(
  ctx: PostAssetUploadContext,
  blob: Blob,
  altValue: string,
  elementId: string,
): Promise<{ assetId: string; kind: string }> {
  const form = new FormData();
  form.append('file', blob);
  form.append('alt', altValue);
  const hasElementId = typeof elementId === 'string' && elementId.length > 0;
  if (hasElementId) {
    form.append('siteId', ctx.siteId);
    form.append('elementId', elementId);
  }
  const response = await ctx.authFetch(ctx.apiBase + '/owner/assets', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') detail = body.error;
    } catch (_) {
      /* statusText already names the upload failure */
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as { id?: unknown; kind?: unknown };
  if (!body || typeof body.id !== 'string' || typeof body.kind !== 'string') {
    throw new Error('malformed server response');
  }
  return { assetId: body.id, kind: body.kind };
}

export async function applyAssetIdToElementImpl(
  ctx: ApplyAssetIdToElementContext,
  element: MediaElement,
  nextAssetId: string,
  refreshFn?: () => Promise<unknown>,
  nextKind?: string,
): Promise<void> {
  element.assetId = nextAssetId;
  if (typeof nextKind === 'string' && nextKind.length > 0) {
    element.mediaKind = nextKind as MediaElement['mediaKind'];
  }
  ctx.rebuildElement(element.id);
  ctx.scheduleSave();
  if (nextAssetId && nextAssetId !== '__placeholder__') {
    void ctx
      .authFetch(
        ctx.apiBase +
          '/sites/' +
          encodeURIComponent(ctx.siteId) +
          '/elements/' +
          encodeURIComponent(element.id) +
          '/history/' +
          encodeURIComponent(nextAssetId),
        { method: 'PUT' },
      )
      .then((r) => {
        if (!r.ok) console.error('slot-history upsert failed', r.status);
      })
      .catch((err: unknown) => console.error('slot-history upsert failed', err));
  }
  if (typeof refreshFn === 'function') await refreshFn();
}

function walkMediaElements(state: EditableSite, visit: (element: MediaElement) => void): void {
  function walkArray(elements: CanvasElement[]): void {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]!;
      if (element.type === 'media') visit(element);
      if (element.type === 'tabs' && Array.isArray((element as { tabs?: unknown }).tabs)) {
        const tabs = (element as { tabs: Array<{ elements?: CanvasElement[] }> }).tabs;
        for (let ti = 0; ti < tabs.length; ti++) {
          const tab = tabs[ti]!;
          if (Array.isArray(tab.elements)) walkArray(tab.elements);
        }
      } else if (
        element.type === 'collection' &&
        Array.isArray((element as { entries?: unknown }).entries)
      ) {
        const entries = (element as { entries: unknown[] }).entries;
        for (let ei = 0; ei < entries.length; ei++) {
          const entry = entries[ei];
          if (Array.isArray(entry)) walkArray(entry as CanvasElement[]);
        }
      }
    }
  }
  const siteSections = [state.header, state.footer].filter(
    (section): section is CanvasSection => !!section,
  );
  for (let si = 0; si < siteSections.length; si++) walkArray(siteSections[si]!.elements);
  for (let pi = 0; pi < state.pages.length; pi++) {
    const page = state.pages[pi]!;
    for (let si = 0; si < page.sections.length; si++) walkArray(page.sections[si]!.elements);
  }
}

function clearDeletedAssetFromLocalState(
  ctx: ClearDeletedAssetFromLocalStateContext,
  assetId: string,
): number {
  if (!ctx.state || !Array.isArray(ctx.state.pages)) return 0;
  let cleared = 0;
  walkMediaElements(ctx.state, (mediaElement) => {
    if (mediaElement.assetId === assetId) {
      mediaElement.assetId = '';
      cleared += 1;
    }
    const mediaRecord = mediaElement as MediaElement & { posterAssetId?: string };
    if (mediaRecord.posterAssetId === assetId) {
      mediaRecord.posterAssetId = '';
      cleared += 1;
    }
  });
  if (cleared > 0) {
    ctx.renderAll();
    ctx.scheduleSave();
  }
  return cleared;
}

export async function runDeleteAssetImpl(
  ctx: RunDeleteAssetContext,
  assetId: string,
  refreshFn?: () => Promise<unknown>,
): Promise<void> {
  let references: unknown[] = [];
  try {
    const resp = await ctx.authFetch(ctx.apiBase + '/owner/assets/' + encodeURIComponent(assetId), {
      method: 'DELETE',
    });
    const body = (await resp.json()) as { references?: unknown[]; error?: unknown };
    if (resp.status === 412 || resp.ok) {
      references = Array.isArray(body.references) ? body.references : [];
    } else {
      const detail = typeof body.error === 'string' ? body.error : resp.statusText;
      ctx.setStatus('Delete failed: ' + detail, 'error');
      return;
    }
  } catch (err: unknown) {
    ctx.setStatus('Delete failed: ' + errorToString(err), 'error');
    return;
  }

  const editableRefs = references.filter(
    (ref) => ref && typeof ref === 'object' && (ref as { source?: unknown }).source === 'editable',
  );
  const publishedRefs = references.filter(
    (ref) => ref && typeof ref === 'object' && (ref as { source?: unknown }).source === 'published',
  );
  // Per-ref field stringification with strict string narrowing. The
  // server returns `references[]: { source, siteName?, siteId?,
  // pageSlug?, elementId?, role?, publishedAddress? }` — every field is
  // a string when present. The runtime-narrow `typeof === 'string'`
  // gate keeps lint happy (raw `unknown` would stringify to "[object
  // Object]") and turns a server-shape regression into an empty-token
  // render rather than a [object Object] toast.
  function refField(ref: Record<string, unknown>, key: string): string {
    const value = ref[key];
    return typeof value === 'string' ? value : '';
  }
  const lines = ['Delete asset ' + assetId + '?'];
  if (editableRefs.length > 0) {
    lines.push('', 'Editable slots that will be cleared:');
    for (let i = 0; i < editableRefs.length; i++) {
      const ref = editableRefs[i] as Record<string, unknown>;
      const siteLabel = refField(ref, 'siteName') || refField(ref, 'siteId');
      lines.push(
        '  - ' +
          siteLabel +
          ' / ' +
          refField(ref, 'pageSlug') +
          ' / element ' +
          refField(ref, 'elementId') +
          ' (' +
          refField(ref, 'role') +
          ')',
      );
    }
  }
  if (publishedRefs.length > 0) {
    lines.push('', 'Live published sites that will show missing media until you re-publish:');
    for (let i = 0; i < publishedRefs.length; i++) {
      const ref = publishedRefs[i] as Record<string, unknown>;
      const siteLabel = refField(ref, 'siteName') || refField(ref, 'siteId');
      const publishedAddress = refField(ref, 'publishedAddress');
      const address = publishedAddress ? ' (live: ' + publishedAddress + ')' : '';
      lines.push(
        '  - ' +
          siteLabel +
          address +
          ' / ' +
          refField(ref, 'pageSlug') +
          ' / element ' +
          refField(ref, 'elementId') +
          ' (' +
          refField(ref, 'role') +
          ')',
      );
    }
  }
  if (editableRefs.length === 0 && publishedRefs.length === 0) {
    lines.push('', 'No canvas references were found.');
  }
  lines.push('', 'Continue?');
  const confirmed = await ctx.openConfirmModal({
    title: 'Delete asset',
    message: lines.join('\n'),
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;

  try {
    const resp = await ctx.authFetch(
      ctx.apiBase + '/owner/assets/' + encodeURIComponent(assetId) + '?confirm=1',
      { method: 'DELETE' },
    );
    if (!resp.ok) {
      let detail = resp.statusText;
      try {
        const body = (await resp.json()) as { error?: unknown };
        if (body && typeof body.error === 'string') detail = body.error;
      } catch (_) {
        /* statusText already names the delete failure */
      }
      ctx.setStatus('Delete failed: ' + detail, 'error');
      return;
    }
  } catch (err: unknown) {
    ctx.setStatus('Delete failed: ' + errorToString(err), 'error');
    return;
  }

  clearDeletedAssetFromLocalState(ctx, assetId);
  ctx.setStatus('Asset deleted', 'ok');
  if (typeof refreshFn === 'function') await refreshFn();
}

function loadCropper(): Promise<unknown> {
  if (!cropperLoadPromise) {
    cropperLoadPromise = (async () => {
      const response = await fetch(CROPPER_CDN, { cache: 'force-cache' });
      if (!response.ok) {
        throw new Error(
          'Cropper.js fetch failed: HTTP ' + response.status + ' from ' + CROPPER_CDN,
        );
      }
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-384', bytes);
      const digestBytes = new Uint8Array(digest);
      let bin = '';
      for (let i = 0; i < digestBytes.length; i++) bin += String.fromCharCode(digestBytes[i]!);
      const actual = btoa(bin);
      if (actual !== CROPPER_SRI_SHA384) {
        throw new Error(
          'Cropper.js SRI mismatch: expected sha384=' +
            CROPPER_SRI_SHA384 +
            ' but got sha384=' +
            actual +
            ' from ' +
            CROPPER_CDN +
            '. Refusing to import potentially tampered code.',
        );
      }
      const blob = new Blob([bytes], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        // Dynamic import of an SRI-verified Blob URL returns the cropper.js
        // module namespace. We do not consume its exports — we only care
        // that the import evaluates so the cropper-canvas / cropper-image
        // custom elements register their side effects. The return value is
        // captured for tracing only; nothing reads it.
        const mod: unknown = await import(blobUrl);
        return mod;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })();
  }
  return cropperLoadPromise;
}

function runCropperModal(
  sourceUrl: string,
  boxW: number,
  boxH: number,
  sourceMediaType: string,
): Promise<{ blob: Blob; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      'box-sizing:border-box;';

    const card = document.createElement('div');
    card.style.cssText =
      'background:#111;border-radius:8px;padding:16px;display:flex;' +
      'flex-direction:column;gap:12px;max-width:960px;width:100%;color:#fff;' +
      'font:13px system-ui,sans-serif;';
    overlay.appendChild(card);

    const heading = document.createElement('div');
    heading.style.cssText = 'font-weight:600;';
    heading.textContent =
      'Crop to slot (' +
      Math.round(boxW) +
      'x' +
      Math.round(boxH) +
      ') - drag to pan, scroll to zoom';
    card.appendChild(heading);

    const canvasEl = document.createElement('cropper-canvas');
    canvasEl.setAttribute('background', '');
    canvasEl.style.cssText = 'width:100%;height:60vh;background:#000;display:block;';
    card.appendChild(canvasEl);

    const img = document.createElement('cropper-image');
    img.setAttribute('src', sourceUrl);
    img.setAttribute('alt', '');
    img.setAttribute('rotatable', '');
    img.setAttribute('scalable', '');
    img.setAttribute('translatable', '');
    canvasEl.appendChild(img);

    const shade = document.createElement('cropper-shade');
    canvasEl.appendChild(shade);

    const moveHandle = document.createElement('cropper-handle');
    moveHandle.setAttribute('action', 'move');
    moveHandle.setAttribute('plain', '');
    canvasEl.appendChild(moveHandle);

    const selection = document.createElement('cropper-selection') as CropperSelection;
    selection.setAttribute('aspect-ratio', String(boxW / boxH));
    selection.setAttribute('initial-coverage', '0.85');
    selection.setAttribute('outlined', '');
    canvasEl.appendChild(selection);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const modalBtnBase =
      'padding:8px 14px;border-radius:6px;font:600 13px system-ui,sans-serif;cursor:pointer;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText =
      modalBtnBase + 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.35);';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Use this crop';
    confirmBtn.style.cssText = modalBtnBase + 'background:#fff;color:#111;border:1px solid #fff;';
    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);
    card.appendChild(buttons);

    function teardown(): void {
      overlay.remove();
    }

    cancelBtn.addEventListener('click', () => {
      teardown();
      reject(new Error('crop cancelled'));
    });
    confirmBtn.addEventListener('click', () => {
      const outWidth = Math.max(1, Math.round(boxW));
      const outHeight = Math.max(1, Math.round(boxH));
      const reEncodableTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const outType = reEncodableTypes.includes(sourceMediaType) ? sourceMediaType : 'image/png';
      selection
        .$toCanvas({ width: outWidth, height: outHeight })
        .then(
          (cv) =>
            new Promise<{ blob: Blob; mediaType: string }>((res, rej) => {
              cv.toBlob(
                (blob) => {
                  if (blob) res({ blob, mediaType: outType });
                  else rej(new Error('canvas toBlob returned null'));
                },
                outType,
                0.92,
              );
            }),
        )
        .then((out) => {
          teardown();
          resolve(out);
        })
        .catch((err: unknown) => {
          teardown();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });

    document.body.appendChild(overlay);
  });
}

async function cropFileToSlotAspect(
  file: File,
  boxW: number,
  boxH: number,
): Promise<{ blob: Blob; mediaType: string }> {
  await loadCropper();
  const url = URL.createObjectURL(file);
  try {
    return await runCropperModal(url, boxW, boxH, file.type);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractVideoFirstFrame(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<Blob>((_res, rej) => {
    timeoutHandle = setTimeout(() => {
      rej(
        new Error('video poster extraction timed out after ' + POSTER_EXTRACTION_TIMEOUT_MS + 'ms'),
      );
    }, POSTER_EXTRACTION_TIMEOUT_MS);
  });
  const work = (async () => {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error('video failed to load for poster extraction'));
    });
    await new Promise<void>((res, rej) => {
      video.onseeked = () => res();
      video.onerror = () => rej(new Error('video seek failed'));
      const target = Math.min(FIRST_FRAME_SEEK_SECONDS, (video.duration || 1) / 2);
      try {
        video.currentTime = target;
      } catch (err: unknown) {
        rej(err instanceof Error ? err : new Error(String(err)));
      }
    });
    const cv = document.createElement('canvas');
    cv.width = video.videoWidth || 1280;
    cv.height = video.videoHeight || 720;
    const drawCtx = cv.getContext('2d');
    if (!drawCtx) throw new Error('2D context unavailable for poster extraction');
    drawCtx.drawImage(video, 0, 0, cv.width, cv.height);
    return new Promise<Blob>((res, rej) => {
      cv.toBlob((blob) => {
        if (blob) res(blob);
        else rej(new Error('poster toBlob returned null'));
      }, 'image/png');
    });
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    URL.revokeObjectURL(url);
  }
}

export async function uploadMediaForElementImpl(
  ctx: UploadMediaForElementContext,
  element: MediaElement,
  file: File,
  refreshFn?: () => Promise<unknown>,
): Promise<void> {
  const altInput = document.getElementById('media-upload-alt-' + element.id);
  const altValue =
    altInput instanceof HTMLInputElement && typeof altInput.value === 'string'
      ? altInput.value
      : element.alt || '';
  const boxW = element.box && typeof element.box.w === 'number' ? element.box.w : 0;
  const boxH = element.box && typeof element.box.h === 'number' ? element.box.h : 0;
  if (boxW <= 0 || boxH <= 0) {
    ctx.setStatus('Cannot upload: slot has no size yet - resize the element first', 'error');
    return;
  }

  try {
    if (element.mediaKind === 'image') {
      ctx.setStatus('Loading cropper...');
      const cropped = await cropFileToSlotAspect(file, boxW, boxH);
      ctx.setStatus('Uploading...');
      const uploaded = await ctx.postAssetUpload(cropped.blob, altValue, element.id);
      element.alt = altValue;
      await ctx.applyAssetIdToElement(element, uploaded.assetId, refreshFn, uploaded.kind);
      ctx.renderInspector();
      ctx.setStatus('Uploaded', 'ok');
      return;
    }

    ctx.setStatus('Extracting poster...');
    const posterBlob = await extractVideoFirstFrame(file);
    const posterFile = new File([posterBlob], 'poster.png', { type: 'image/png' });

    ctx.setStatus('Loading cropper...');
    const croppedPoster = await cropFileToSlotAspect(posterFile, boxW, boxH);

    ctx.setStatus('Uploading video...');
    const uploadedVideo = await ctx.postAssetUpload(file, altValue, element.id);

    ctx.setStatus('Uploading poster...');
    const uploadedPoster = await ctx.postAssetUpload(croppedPoster.blob, altValue, element.id);

    element.mediaKind = 'video';
    element.posterAssetId = uploadedPoster.assetId;
    element.alt = altValue;
    await ctx.applyAssetIdToElement(element, uploadedVideo.assetId, refreshFn, 'video');
    ctx.renderInspector();
    ctx.setStatus('Uploaded', 'ok');
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'crop cancelled') {
      ctx.setStatus('Cancelled');
      return;
    }
    ctx.setStatus('Upload failed: ' + errorToString(err), 'error');
  }
}

export async function generateImageForElementImpl(
  ctx: GenerateImageForElementContext,
  element: MediaElement,
  prompt: string,
): Promise<void> {
  const altInput = document.getElementById('media-upload-alt-' + element.id);
  const altValue =
    altInput instanceof HTMLInputElement && typeof altInput.value === 'string'
      ? altInput.value
      : element.alt || '';
  const boxW = element.box && typeof element.box.w === 'number' ? element.box.w : 0;
  const boxH = element.box && typeof element.box.h === 'number' ? element.box.h : 0;
  if (boxW <= 0 || boxH <= 0) {
    ctx.setStatus('Cannot generate: slot has no size yet - resize the element first', 'error');
    return;
  }
  ctx.setStatus('Generating...');
  try {
    const response = await ctx.authFetch(ctx.siteBase + '/assets/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, alt: altValue, boxW, boxH }),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (body && typeof body.error === 'string') detail = body.error;
      } catch (_) {
        /* statusText already names the generation failure */
      }
      ctx.setStatus('Generate failed: ' + detail, 'error');
      return;
    }
    const mediaType = response.headers.get('content-type') || 'image/webp';
    if (!mediaType.startsWith('image/')) {
      ctx.setStatus('Generate failed: server did not return image bytes', 'error');
      return;
    }
    const blob = await response.blob();
    showGeneratePreview(ctx, element, blob, mediaType, altValue);
    ctx.setStatus('Preview ready - Apply to save', 'ok');
  } catch (err: unknown) {
    ctx.setStatus('Generate failed: ' + errorToString(err), 'error');
  }
}

function showGeneratePreview(
  ctx: ShowGeneratePreviewContext,
  element: MediaElement,
  blob: Blob,
  mediaType: string,
  altValue: string,
): void {
  if (!ctx.inspector) return;
  const prior = document.getElementById('ai-preview-' + element.id);
  if (prior) {
    const staleUrl = prior.getAttribute('data-object-url');
    if (staleUrl) URL.revokeObjectURL(staleUrl);
    prior.remove();
  }

  const objectUrl = URL.createObjectURL(blob);
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.id = 'ai-preview-' + element.id;
  wrap.setAttribute('data-object-url', objectUrl);

  const label = document.createElement('label');
  label.textContent = 'Preview (not saved yet)';
  wrap.appendChild(label);

  const img = document.createElement('img');
  img.src = objectUrl;
  img.alt = altValue;
  img.style.cssText =
    'max-width:100%;display:block;border:1px solid var(--opencanvas-border,#ccc);';
  wrap.appendChild(img);

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
  const aiPreviewBtnBase =
    'padding:6px 12px;border-radius:6px;font:600 12.5px var(--sans,system-ui,sans-serif);cursor:pointer;';
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = 'Apply';
  applyBtn.style.cssText =
    aiPreviewBtnBase +
    'background:var(--ink,#111);color:var(--surface,#fff);border:1px solid var(--ink,#111);';

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.textContent = 'Discard';
  discardBtn.style.cssText =
    aiPreviewBtnBase +
    'background:transparent;color:var(--ink-2,#555);border:1px solid var(--line,#ccc);';

  applyBtn.addEventListener('click', () => {
    void applyGeneratePreview(
      ctx,
      element,
      blob,
      mediaType,
      altValue,
      wrap,
      applyBtn,
      discardBtn,
      objectUrl,
    );
  });
  discardBtn.addEventListener('click', () => {
    URL.revokeObjectURL(objectUrl);
    wrap.remove();
    ctx.setStatus('Discarded');
  });

  buttons.appendChild(applyBtn);
  buttons.appendChild(discardBtn);
  wrap.appendChild(buttons);
  ctx.inspector.appendChild(wrap);
}

async function uploadGeneratedBlobToElementImpl(
  ctx: UploadGeneratedBlobToElementContext,
  element: MediaElement,
  blob: Blob,
  mediaType: string,
  altValue: string,
): Promise<void> {
  const dotIdx = mediaType.indexOf('/');
  const ext = dotIdx > 0 ? mediaType.slice(dotIdx + 1) : 'webp';
  const form = new FormData();
  form.append('file', new File([blob], 'generated.' + ext, { type: mediaType }));
  form.append('alt', altValue);
  form.append('siteId', ctx.siteId);
  form.append('elementId', element.id);

  const response = await ctx.authFetch(ctx.apiBase + '/owner/assets', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errBody = (await response.json()) as { error?: unknown };
      if (errBody && typeof errBody.error === 'string') detail = errBody.error;
    } catch (_) {
      /* statusText already names the upload failure */
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as { id?: unknown; kind?: unknown };
  if (!body || typeof body.id !== 'string' || typeof body.kind !== 'string') {
    throw new Error('malformed server response');
  }
  element.assetId = body.id;
  element.mediaKind = body.kind as MediaElement['mediaKind'];
  element.alt = altValue;
  ctx.rebuildElement(element.id);
  ctx.renderInspector();
  ctx.scheduleSave();
}

async function applyGeneratePreview(
  ctx: ApplyGeneratePreviewContext,
  element: MediaElement,
  blob: Blob,
  mediaType: string,
  altValue: string,
  wrap: HTMLElement,
  applyBtn: HTMLButtonElement,
  discardBtn: HTMLButtonElement,
  objectUrl: string,
): Promise<void> {
  applyBtn.disabled = true;
  discardBtn.disabled = true;
  ctx.setStatus('Saving...');
  try {
    await ctx.uploadGeneratedBlobToElement(element, blob, mediaType, altValue);
    URL.revokeObjectURL(objectUrl);
    wrap.remove();
    ctx.setStatus('Applied', 'ok');
  } catch (err: unknown) {
    ctx.setStatus('Apply failed: ' + errorToString(err), 'error');
    applyBtn.disabled = false;
    discardBtn.disabled = false;
  }
}

export function pointerToCanvasImpl(
  ctx: PointerToCanvasContext,
  event: PointerEvent | MouseEvent,
  sectionEl: Element,
): { x: number; y: number } | null {
  if (!sectionEl || typeof event.clientX !== 'number') return null;
  const world = screenToWorld(ctx, event.clientX, event.clientY);
  const sectionRect = sectionEl.getBoundingClientRect();
  const sectionWorld = screenToWorld(ctx, sectionRect.left, sectionRect.top);
  return {
    x: world.x - sectionWorld.x,
    y: world.y - sectionWorld.y,
  };
}

export function isEditableShortcutTargetImpl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest('input, textarea, select, button');
  if (control) return true;
  const editable = target.closest('[contenteditable]');
  if (!editable) return false;
  return editable.getAttribute('contenteditable') !== 'false';
}

export function mountViewportImpl(ctx: MountViewportContext): void {
  if (!ctx.root || !ctx.root.parentNode) return;
  const parent = ctx.root.parentNode;
  ctx.viewport = document.createElement('div');
  ctx.viewport.className = 'opencanvas-viewport';
  parent.insertBefore(ctx.viewport, ctx.root);
  ctx.viewport.appendChild(ctx.root);

  ctx.zoomToolbar = document.createElement('div');
  ctx.zoomToolbar.className = 'opencanvas-zoom-toolbar';
  ctx.zoomToolbar.setAttribute('role', 'toolbar');
  ctx.zoomToolbar.setAttribute('aria-label', 'Zoom and interaction mode');
  const modeDefs = [
    { label: '\u2196', title: 'Select (V)', ariaLabel: 'Select mode', action: 'select' },
    { label: '\u270b', title: 'Pan (Space)', ariaLabel: 'Pan mode', action: 'pan' },
  ];
  for (let mi = 0; mi < modeDefs.length; mi++) {
    const def = modeDefs[mi]!;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label;
    btn.title = def.title;
    btn.setAttribute('aria-label', def.ariaLabel);
    btn.setAttribute('data-mode-action', def.action);
    btn.setAttribute('aria-pressed', def.action === 'select' ? 'true' : 'false');
    ctx.zoomToolbar.appendChild(btn);
  }
  const sep = document.createElement('span');
  sep.className = 'zoom-toolbar-sep';
  ctx.zoomToolbar.appendChild(sep);
  const defs = [
    { label: 'Fit', action: 'fit' },
    { label: '100%', action: 'reset' },
    { label: '-', action: 'out' },
    { label: '+', action: 'in' },
  ];
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]!;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label;
    btn.setAttribute('data-zoom-action', def.action);
    ctx.zoomToolbar.appendChild(btn);
  }
  ctx.zoomReadout = document.createElement('span');
  ctx.zoomReadout.className = 'zoom-readout';
  ctx.zoomReadout.textContent = '100%';
  ctx.zoomToolbar.appendChild(ctx.zoomReadout);
  const reducedMotionSep = document.createElement('span');
  reducedMotionSep.className = 'zoom-toolbar-sep';
  ctx.zoomToolbar.appendChild(reducedMotionSep);
  const reducedMotionButton = document.createElement('button');
  reducedMotionButton.type = 'button';
  reducedMotionButton.textContent = 'Reduce';
  reducedMotionButton.title = 'Preview reduced-motion visitor behavior';
  reducedMotionButton.className = 'opencanvas-reduced-motion-preview-toggle';
  reducedMotionButton.setAttribute('aria-label', 'Preview reduced-motion visitor behavior');
  reducedMotionButton.setAttribute('data-opencanvas-reduced-motion-preview', 'toggle');
  reducedMotionButton.setAttribute(
    'aria-pressed',
    ctx.reducedMotionPreview === 'reduce' ? 'true' : 'false',
  );
  ctx.zoomToolbar.appendChild(reducedMotionButton);
  document.body.appendChild(ctx.zoomToolbar);
  ctx.zoomToolbar.addEventListener('click', (ev) => {
    const modeTarget =
      ev.target instanceof Element ? ev.target.closest('button[data-mode-action]') : null;
    if (modeTarget) {
      const mode = modeTarget.getAttribute('data-mode-action');
      if (mode) {
        ctx.clearTemporaryPanState();
        ctx.setInteractionMode(mode);
      }
      return;
    }
    const reducedMotionTarget =
      ev.target instanceof Element
        ? ev.target.closest('button[data-opencanvas-reduced-motion-preview]')
        : null;
    if (reducedMotionTarget) {
      ctx.reducedMotionPreview =
        ctx.reducedMotionPreview === 'reduce' ? 'no-preference' : 'reduce';
      reducedMotionTarget.setAttribute(
        'aria-pressed',
        ctx.reducedMotionPreview === 'reduce' ? 'true' : 'false',
      );
      if (ctx.root) {
        ctx.root.setAttribute('data-opencanvas-reduced-motion-preview', ctx.reducedMotionPreview);
      }
      ctx.renderAll();
      return;
    }
    const target =
      ev.target instanceof Element ? ev.target.closest('button[data-zoom-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-zoom-action');
    if (action === 'fit') fitZoom(ctx);
    else if (action === 'reset') setZoom(ctx, 1, ZOOM_MAX_MANUAL);
    else if (action === 'in') setZoom(ctx, ctx.camera.zoom + ZOOM_STEP, ZOOM_MAX_MANUAL);
    else if (action === 'out') setZoom(ctx, ctx.camera.zoom - ZOOM_STEP, ZOOM_MAX_MANUAL);
  });

  ctx.viewport.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) {
        ctx.camera.x -= ev.deltaX;
        ctx.camera.y -= ev.deltaY;
        applyCameraTransform(ctx);
        return;
      }
      ev.preventDefault();
      const direction = ev.deltaY > 0 ? -1 : 1;
      zoomAtPoint(ctx, ctx.camera.zoom + direction * ZOOM_STEP, ev.clientX, ev.clientY);
    },
    { passive: false },
  );
  ctx.viewport.addEventListener('mousedown', (ev) => {
    if (ctx.interactionMode !== 'pan') return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const camStartX = ctx.camera.x;
    const camStartY = ctx.camera.y;
    ctx.viewport!.setAttribute('data-panning', 'true');
    function onMove(e: MouseEvent): void {
      e.preventDefault();
      ctx.camera.x = camStartX + (e.clientX - startX);
      ctx.camera.y = camStartY + (e.clientY - startY);
      applyCameraTransform(ctx);
    }
    function onUp(): void {
      ctx.viewport!.removeAttribute('data-panning');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  });
  ctx.setInteractionMode('select');
  applyCameraTransform(ctx);
}

export function resolveElementWrapperAtPointImpl(
  ctx: ResolveElementWrapperAtPointContext,
  target: Element,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  if (!ctx.root) return null;
  const seen = new Set<Element>();
  const candidates: HTMLElement[] = [];

  function addCandidate(node: Node | null): void {
    let n: Node | null = node;
    while (n && n !== ctx.root) {
      if (
        n.nodeType === 1 &&
        n instanceof HTMLElement &&
        n.classList.contains('opencanvas-element')
      ) {
        if (!seen.has(n)) {
          seen.add(n);
          candidates.push(n);
        }
        return;
      }
      n = n.parentNode;
    }
  }

  function pointInsideAnyRect(node: Element, x: number, y: number): boolean {
    const rects = node.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  function addGeometryCandidates(): void {
    const wrappers = ctx.root!.querySelectorAll('.opencanvas-element');
    for (let i = 0; i < wrappers.length; i++) {
      const wrapper = wrappers[i]!;
      if (pointInsideAnyRect(wrapper, clientX, clientY)) {
        addCandidate(wrapper);
        continue;
      }
      const descendants = wrapper.querySelectorAll('*');
      for (let j = 0; j < descendants.length; j++) {
        if (pointInsideAnyRect(descendants[j]!, clientX, clientY)) {
          addCandidate(wrapper);
          break;
        }
      }
    }
  }

  addCandidate(target);
  if (typeof document.elementsFromPoint === 'function') {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < stack.length; i++) addCandidate(stack[i]!);
  }
  addGeometryCandidates();
  if (candidates.length === 0) return null;

  function depth(node: Node): number {
    let d = 0;
    let n: Node | null = node;
    while (n && n !== ctx.root) {
      d += 1;
      n = n.parentNode;
    }
    return d;
  }

  function rectContains(node: Element, x: number, y: number): boolean {
    const r = node.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  let best: HTMLElement | null = null;
  let bestDepth = -1;
  let bestContains = false;
  for (let i = 0; i < candidates.length; i++) {
    const node = candidates[i]!;
    const contains = rectContains(node, clientX, clientY);
    const d = depth(node);
    if (best === null) {
      best = node;
      bestDepth = d;
      bestContains = contains;
      continue;
    }
    if (contains && !bestContains) {
      best = node;
      bestDepth = d;
      bestContains = contains;
      continue;
    }
    if (contains === bestContains && d > bestDepth) {
      best = node;
      bestDepth = d;
    }
  }
  return best;
}

function resolveNestedInsertionTarget(
  ctx: ResolveNestedInsertionTargetContext,
): { elements: CanvasElement[] } | null {
  if (!ctx.selectedElementId) return null;
  const found = ctx.findElement(ctx.selectedElementId);
  if (!found) return null;
  if (found.element.type === 'tabs') {
    const tabsElement = found.element as unknown as {
      activeTabId?: string;
      tabs?: Array<{ id: string; elements?: CanvasElement[] }>;
    };
    const activeTab = (tabsElement.tabs || []).find((t) => t && t.id === tabsElement.activeTabId);
    if (activeTab && Array.isArray(activeTab.elements)) return { elements: activeTab.elements };
    return null;
  }
  if (found.parentKind === 'tab-panel' && found.parentArray) return { elements: found.parentArray };
  if (found.parentKind === 'collection-entry' && found.parentArray) {
    return { elements: found.parentArray };
  }
  // ADR 0065 D6 — template-edit mode: the active customTemplate array IS the
  // immediate parent of the selected child; sibling insertions land in the
  // same array (mirrors the collection-entry handling above).
  if (found.parentKind === 'collection-custom-template' && found.parentArray) {
    return { elements: found.parentArray };
  }
  return null;
}

function addElementToContainer(
  ctx: AddElementToContainerContext,
  section: CanvasSection,
  containerArray: CanvasElement[],
  element: CanvasElement,
): void {
  if (!element.motion) {
    const pg = ctx.currentPage();
    if (pg && pg.defaultMotionPreset && pg.defaultMotionPreset !== 'none') {
      element.motion = { preset: pg.defaultMotionPreset, delayMs: 0 };
    }
  }
  void section;
  containerArray.push(element);
  ctx.renderAll();
  ctx.selectElement(element.id);
  ctx.scheduleSave();
}

export function insertElementForSidebarCommandImpl(
  ctx: InsertElementForSidebarCommandContext,
  section: CanvasSection,
  commandKey: string,
): void {
  const command = ctx.SIDEBAR_COMMANDS[commandKey] as SidebarCommandSpec | undefined;
  if (!command) {
    throw new Error(
      'insertElementForSidebarCommand: unknown command key ' + JSON.stringify(commandKey),
    );
  }
  const factory = SIDEBAR_FACTORIES[command.factoryName as SidebarFactoryName];
  if (typeof factory !== 'function') {
    throw new Error(
      'insertElementForSidebarCommand: no factory registered for ' +
        JSON.stringify(command.factoryName),
    );
  }
  const nestedTarget = resolveNestedInsertionTarget(ctx);
  const built = factory();
  const newEl = {
    id: newElementId(),
    ...built.payload,
  } as CanvasElement;
  if (nestedTarget) {
    newEl.box = {
      x: 24,
      y: 24,
      w: built.defaultSize.w,
      h: built.defaultSize.h,
      z: nextZInArray(nestedTarget.elements),
    };
    addElementToContainer(ctx, section, nestedTarget.elements, newEl);
    return;
  }
  newEl.box = ctx.defaultBox(section, built.defaultSize.w, built.defaultSize.h);
  ctx.addElementToSection(section, newEl);
}

function nextZInArray(elements: CanvasElement[]): number {
  let max = 0;
  for (let i = 0; i < elements.length; i++) {
    const box = elements[i]!.box;
    if (box && typeof box.z === 'number' && box.z > max) max = box.z;
  }
  return max + 1;
}

export function forceOpenInspectorImpl(ctx: ForceOpenInspectorContext): void {
  if (!ctx.inspector) return;
  ctx.inspector.hidden = false;
  ctx.inspector.classList.remove('collapsed');
  const toggle = document.getElementById('inspector-toggle');
  if (toggle) toggle.textContent = '\u203a';
}

export function openLinkModalImpl(
  ctx: OpenLinkModalContext,
  opts: {
    linkText?: string;
    href?: string;
    blank?: boolean;
    focusAfterClose?: HTMLElement | null;
  },
): Promise<{ href: string; target?: '_blank' } | null> {
  if (ctx.modalOpen) throw new Error('openLinkModal: another modal is already open');
  const linkText = typeof opts.linkText === 'string' ? opts.linkText : '';
  const defaultHref = typeof opts.href === 'string' ? opts.href : 'https://';
  const defaultBlank = opts.blank === true;
  const focusAfterClose =
    opts.focusAfterClose && typeof opts.focusAfterClose.focus === 'function'
      ? opts.focusAfterClose
      : null;
  ctx.modalOpen = true;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'opencanvas-modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'opencanvas-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Link');

    const h = document.createElement('h3');
    h.textContent = 'Link';
    panel.appendChild(h);

    if (linkText.length > 0) {
      const previewLabel = document.createElement('label');
      previewLabel.textContent = 'Text';
      panel.appendChild(previewLabel);
      const preview = document.createElement('div');
      preview.className = 'opencanvas-link-modal-preview';
      preview.textContent = linkText;
      panel.appendChild(preview);
    }

    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'URL';
    panel.appendChild(urlLabel);
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = defaultHref;
    urlInput.placeholder = 'https://...';
    panel.appendChild(urlInput);

    const errorEl = document.createElement('div');
    errorEl.className = 'opencanvas-link-modal-error';
    errorEl.textContent = '';
    panel.appendChild(errorEl);

    const checkLabel = document.createElement('label');
    checkLabel.className = 'opencanvas-link-modal-checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = defaultBlank;
    checkLabel.appendChild(checkbox);
    checkLabel.appendChild(document.createTextNode(' Open in new tab'));
    panel.appendChild(checkLabel);

    function autoToggleBlank(): void {
      const val = urlInput.value.trim();
      if (val.startsWith('http://') || val.startsWith('https://')) checkbox.checked = true;
      else if (val.startsWith('#') || val.startsWith('/')) checkbox.checked = false;
    }
    if (defaultHref === 'https://') urlInput.addEventListener('input', autoToggleBlank);

    const actions = document.createElement('div');
    actions.className = 'opencanvas-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = 'Apply';
    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);
    panel.appendChild(actions);
    backdrop.appendChild(panel);

    function close(value: { href: string; target?: '_blank' } | null): void {
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.body.classList.remove('opencanvas-modal-open');
      ctx.modalOpen = false;
      if (focusAfterClose && document.contains(focusAfterClose)) {
        focusAfterClose.focus({ preventScroll: true });
      }
      resolve(value);
    }

    function tryApply(): void {
      const href = urlInput.value.trim();
      if (href.length === 0) {
        errorEl.textContent = 'URL cannot be empty';
        return;
      }
      if (!isAllowedHref(href)) {
        errorEl.textContent = 'URL must be http, https, mailto, tel, /relative, or #anchor';
        return;
      }
      const result: { href: string; target?: '_blank' } = { href };
      if (checkbox.checked) result.target = '_blank';
      close(result);
    }

    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(null);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        tryApply();
      }
    }

    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close(null);
    });
    cancelBtn.addEventListener('click', () => close(null));
    applyBtn.addEventListener('click', () => tryApply());
    urlInput.addEventListener('input', () => {
      errorEl.textContent = '';
    });
    document.addEventListener('keydown', onKey, true);

    document.body.classList.add('opencanvas-modal-open');
    document.body.appendChild(backdrop);
    urlInput.focus();
    urlInput.select();
  });
}

export function attachChromeToggles(ctx: AttachChromeTogglesContext): void {
  document.addEventListener('click', (ev) => {
    if (
      ctx.openMenuElementId &&
      ev.target instanceof Element &&
      !ev.target.closest('[data-element-menu]') &&
      !ev.target.closest('[data-element-menu-trigger]')
    ) {
      ctx.closeElementMenu();
    }
  });

  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle && ctx.sidebar) {
    sidebarToggle.addEventListener('click', () => {
      const beforeLeft = ctx.viewport ? ctx.viewport.getBoundingClientRect().left : 0;
      const collapsed = ctx.sidebar!.classList.toggle('collapsed');
      sidebarToggle.textContent = collapsed ? '\u203a' : '\u2039';
      if (ctx.viewport) {
        ctx.viewport.classList.toggle('sidebar-collapsed', collapsed);
        const afterLeft = ctx.viewport.getBoundingClientRect().left;
        const delta = beforeLeft - afterLeft;
        if (delta !== 0) {
          ctx.camera.x += delta;
          applyCameraTransform(ctx);
        }
      }
    });
  }

  const inspectorToggle = document.getElementById('inspector-toggle');
  if (inspectorToggle && ctx.inspector) {
    const toggle = inspectorToggle;
    function syncInspectorToggleIcon(): void {
      if (!ctx.inspector) return;
      const collapsed = ctx.inspector.classList.contains('collapsed');
      toggle.textContent = collapsed || ctx.inspector.hidden ? '\u2039' : '\u203a';
    }
    syncInspectorToggleIcon();
    toggle.addEventListener('click', () => {
      if (!ctx.inspector) return;
      const willOpen = ctx.inspector.hidden || ctx.inspector.classList.contains('collapsed');
      if (willOpen) {
        ctx.inspector.classList.remove('collapsed');
        if ((!ctx.selectedElementId && !ctx.selectedSectionId) || ctx.inspector.hidden) {
          ctx.renderInspector();
        }
      } else {
        ctx.inspector.classList.add('collapsed');
      }
      syncInspectorToggleIcon();
    });
  }
}

export function wireCoEditPresenceListeners(ctx: WireCoEditPresenceListenersContext): void {
  window.addEventListener(
    'scroll',
    () => {
      if (typeof ctx.repaintRemoteCursors === 'function') ctx.repaintRemoteCursors();
    },
    true,
  );
  window.addEventListener('resize', () => {
    if (typeof ctx.repaintRemoteCursors === 'function') ctx.repaintRemoteCursors();
  });
  window.addEventListener('mousemove', (ev) => handleViewportMousemove(ctx, ev));
  document.addEventListener('selectionchange', () => schedulePublishLocalPresence(ctx));
}

export function wireMarkToolbarReflowListeners(ctx: WireMarkToolbarReflowListenersContext): void {
  window.addEventListener(
    'scroll',
    () => {
      if (typeof ctx.onMarkToolbarReflow === 'function') ctx.onMarkToolbarReflow();
    },
    { passive: true },
  );
  window.addEventListener('resize', () => {
    if (typeof ctx.onMarkToolbarReflow === 'function') ctx.onMarkToolbarReflow();
  });
}
