// src/editor-client/ai-integration.ts
//
// ADR 0058 Phase 2n — AI integration: chat-suggestion tracker, agent
// op apply/revert, accept-all summary, AI-busy state machine.
// canvas-client.ts:10313-10339 (setAiBusy + AI busy state machine),
// :10342-10376 (describeOp), :10391-10752 (snapshot helpers +
// computeInverseFromPre + resolveDeferredInverse, private to this
// module), :10759-10794 (findCanvasNodeForOp + focusCanvasOnNode),
// :10796-11019 (pendingAiSuggestions cluster: refreshAcceptAllButton +
// applyAgentOps + revertAgentEntry + showAcceptAllSummary) all carry the
// inline twins. Twins retire on ADR 0015 Phase 3 atomic cutover; until
// then, the inline IIFE is the production source-of-truth and this
// module is dead code.
//
// Eight exports map 1:1 onto Phase 2n's ctx fields:
//
//   - describeOp(op) — human-readable one-liner per op kind. Pure.
//     Bound directly: ctx.describeOp = describeOp.
//
//   - findCanvasNodeForOpImpl(ctx, op) — resolve the canvas DOM wrapper
//     the op points at (elementId first, then sectionId / afterSectionId
//     fallback) so chat suggestion cards can paint overlays and pan.
//     Bound: ctx.findCanvasNodeForOp = (op) => findCanvasNodeForOpImpl(
//     ctx, op).
//
//   - focusCanvasOnNodeImpl(ctx, node) — pan the camera so node centres
//     in the viewport and pulse-ring it. Reads ctx.viewport + ctx.camera;
//     calls applyCameraTransform(ctx) from render.ts.
//
//   - refreshAcceptAllButtonImpl(ctx) — show/hide the Accept-all banner
//     based on the live (pending) count in ctx.pendingAiSuggestions.
//     Belt-and-suspenders hide (hidden attr + inline display:none) so a
//     CSS regression cannot leave a phantom banner on a blank chat.
//
//   - applyAgentOpsImpl(ctx, ops, suggestions) — POST ops through
//     /canvas-agent/.../apply, capture per-op pre-state inverses against
//     the snapshot taken just before /apply mutates state, flip matching
//     suggestion cards to status="accepted", expose Revert buttons where
//     a clean inverse exists. New-id ops (addElement/addPage/insert/
//     design/duplicate) come back as "deferred" — their inverse is
//     finalised after /apply returns by diffing pre-vs-post id sets.
//
//   - revertAgentEntryImpl(ctx, entry) — POST entry.inverseOp through
//     /apply, flip the card back to status="pending" so the Owner can
//     re-Accept. Repaints the canvas overlay so the proposal is visible
//     again. Status semantic chosen by the Owner (the other option —
//     freezing as "reverted" — was declined).
//
//   - showAcceptAllSummaryImpl(ctx) — modal listing every live pending
//     op as an ordered list; "Apply all" routes through applyAgentOps
//     with the same suggestion array so chat-side cards flip status in
//     lockstep with the canvas mutation.
//
//   - setAiBusyImpl(ctx, busy) — flip ctx.aiBusy and toggle
//     [data-ai-button] disabled state. ORs in ctx.sessionExpired +
//     ctx.accessRevoked so a busy=false call during a locked session
//     keeps the buttons disabled — the lock takes precedence.
//
// Private helpers (snapshot walkers + per-op inverse computation) stay
// as inner declarations: they're only consumed by applyAgentOpsImpl /
// revertAgentEntryImpl and have no cross-module callers.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';
import type { EditableSite } from '../canvas/schema.js';
import { applyCustomKitCss } from './custom-kit-css.js';
import { cssEscape } from './css-escape.js';
import { applyCameraTransform } from './render.js';
import { migrateState } from './state-migration.js';

/**
 * Inline IIFE twin reads `err.message || String(err)` — untyped JS. The
 * extracted module catches err as `unknown` (no declared shape on the
 * promise reject branch) and routes it through this helper so member
 * access is narrowed first. Mirrors chat-session.ts's same-named helper
 * so the inline twin's surface is preserved verbatim.
 */
function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown';
}

/**
 * Loose shape of a CanvasAgentOp the chat agent emits. All fields
 * optional — the runtime branches on `kind` and reads only the fields
 * relevant to that branch. Mirrors the inline JS's untyped reads
 * (`op.elementId`, `op.patch`, etc.) without committing to the full
 * discriminated union; the narrow check happens via `op.kind === "…"`
 * exactly as the inline twin writes it.
 */
interface AgentOp {
  kind?: string | undefined;
  elementId?: string | undefined;
  sectionId?: string | undefined;
  afterSectionId?: string | undefined;
  pageId?: string | undefined;
  assetId?: string | undefined;
  mediaKind?: string | undefined;
  recipeId?: string | undefined;
  styleKit?: string | undefined;
  title?: string | undefined;
  slug?: string | undefined;
  alt?: string | undefined;
  patch?: Record<string, unknown> | undefined;
  content?: Array<{ text?: string }> | undefined;
  element?: { id?: string; type?: string } | undefined;
  input?: { brief?: string; sectionName?: string } | undefined;
}

/**
 * One entry in ctx.pendingAiSuggestions. Mirrors the shape chat-session
 * pushes in the op-preview branch + the optional accept/reject/revert
 * button handles attached after card construction.
 */
interface SuggestionEntry {
  op: unknown;
  toolName: string;
  status: string;
  cardEl: HTMLElement;
  targetNode: HTMLElement | null;
  inverseOp: unknown;
  acceptBtn?: HTMLButtonElement;
  rejectBtn?: HTMLButtonElement;
  revertBtn?: HTMLButtonElement;
  /** See EditorContext.pendingAiSuggestions[i].suggestionId — the op-preview
   *  event id used to associate the entry with its ghost section in
   *  ctx.ghostSections. */
  suggestionId?: string;
  /** See EditorContext.pendingAiSuggestions[i].ghostBlueprint — captured on
   *  Accept so a later Revert can re-materialise the ghost. */
  ghostBlueprint?: EditorContext['ghostSections'][number];
}

/**
 * Pre-state inverse computation tag. "ready" means we can revert right
 * now with the carried op; "deferred" means the inverse needs the post-
 * state from /apply to resolve a new id (addElement / addPage / insert /
 * design / duplicate); "destructive" means no inverse exists in the op
 * union and the Revert button must stay hidden.
 */
type InverseResult =
  | { kind: 'ready'; op: AgentOp }
  | { kind: 'deferred'; op: AgentOp }
  | { kind: 'destructive'; reason: string };

interface SnapshotElement {
  id?: string | undefined;
  type?: string | undefined;
  tabs?: Array<{ id?: string | undefined; elements?: SnapshotElement[] | undefined }> | undefined;
  entries?: SnapshotElement[][] | undefined;
  href?: { type?: string | undefined; pageId?: string | undefined } | undefined;
  mediaKind?: string | undefined;
  assetId?: string | undefined;
  alt?: string | undefined;
  content?: unknown;
}

interface SnapshotSection {
  id?: string | undefined;
  elements?: SnapshotElement[] | undefined;
}

interface SnapshotPage {
  id?: string | undefined;
  sections?: SnapshotSection[] | undefined;
}

interface Snapshot {
  header?: SnapshotSection | undefined;
  footer?: SnapshotSection | undefined;
  pages?: SnapshotPage[] | undefined;
  styleKit?: string | undefined;
}

// -- Snapshot walkers (private) ----------------------------------------

function walkSnapshotElements(
  snap: Snapshot,
  visit: (el: SnapshotElement, section: SnapshotSection, arr: SnapshotElement[], index: number) => void,
): void {
  function walkArr(arr: SnapshotElement[] | undefined, section: SnapshotSection): void {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el) continue;
      visit(el, section, arr, i);
      if (el.type === 'tabs' && Array.isArray(el.tabs)) {
        for (let ti = 0; ti < el.tabs.length; ti++) {
          const tab = el.tabs[ti];
          if (tab && Array.isArray(tab.elements)) walkArr(tab.elements, section);
        }
      } else if (el.type === 'collection' && Array.isArray(el.entries)) {
        for (let ei = 0; ei < el.entries.length; ei++) {
          walkArr(el.entries[ei], section);
        }
      }
    }
  }
  if (snap.header) walkArr(snap.header.elements, snap.header);
  if (snap.footer) walkArr(snap.footer.elements, snap.footer);
  if (Array.isArray(snap.pages)) {
    for (let pi = 0; pi < snap.pages.length; pi++) {
      const page = snap.pages[pi];
      if (!page || !Array.isArray(page.sections)) continue;
      for (let si = 0; si < page.sections.length; si++) {
        walkArr(page.sections[si]!.elements, page.sections[si]!);
      }
    }
  }
}

function findElementInSnapshot(
  snap: Snapshot,
  elementId: string,
): { element: SnapshotElement; section: SnapshotSection } | null {
  let found: { element: SnapshotElement; section: SnapshotSection } | null = null;
  walkSnapshotElements(snap, function (el, section) {
    if (!found && el.id === elementId) found = { element: el, section: section };
  });
  return found;
}

interface ElementLocation {
  element: SnapshotElement;
  section: SnapshotSection;
  parentKind: 'section' | 'tab-panel' | 'collection-entry';
  tabsElementId?: string | undefined;
  tabId?: string | undefined;
  collectionElementId?: string | undefined;
  entryIndex?: number | undefined;
  index: number;
}

// Like findElementInSnapshot but also captures enough context to put the
// element back via a restoreElement op: section id, parent kind, parent
// ids (NOT live refs — those go stale across renderAll), and the index
// in the parent array. Walks tabs and collections recursively because
// the element being deleted may live nested inside either.
function findElementLocationInSnapshot(snap: Snapshot, elementId: string): ElementLocation | null {
  function searchArr(
    arr: SnapshotElement[] | undefined,
    section: SnapshotSection,
    parentKind: 'section' | 'tab-panel' | 'collection-entry',
    meta:
      | null
      | { tabsElementId?: string | undefined; tabId?: string | undefined }
      | { collectionElementId?: string | undefined; entryIndex?: number | undefined },
  ): ElementLocation | null {
    if (!Array.isArray(arr)) return null;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el) continue;
      if (el.id === elementId) {
        return {
          element: el,
          section: section,
          parentKind: parentKind,
          tabsElementId: meta && 'tabsElementId' in meta ? meta.tabsElementId : undefined,
          tabId: meta && 'tabId' in meta ? meta.tabId : undefined,
          collectionElementId: meta && 'collectionElementId' in meta ? meta.collectionElementId : undefined,
          entryIndex: meta && 'entryIndex' in meta ? meta.entryIndex : undefined,
          index: i,
        };
      }
      if (el.type === 'tabs' && Array.isArray(el.tabs)) {
        for (let ti = 0; ti < el.tabs.length; ti++) {
          const tab = el.tabs[ti];
          if (tab && Array.isArray(tab.elements)) {
            const hit = searchArr(tab.elements, section, 'tab-panel', {
              tabsElementId: el.id,
              tabId: tab.id,
            });
            if (hit) return hit;
          }
        }
      } else if (el.type === 'collection' && Array.isArray(el.entries)) {
        for (let ei = 0; ei < el.entries.length; ei++) {
          const entry = el.entries[ei];
          if (Array.isArray(entry)) {
            const hitC = searchArr(entry, section, 'collection-entry', {
              collectionElementId: el.id,
              entryIndex: ei,
            });
            if (hitC) return hitC;
          }
        }
      }
    }
    return null;
  }
  if (snap.header && Array.isArray(snap.header.elements)) {
    const h = searchArr(snap.header.elements, snap.header, 'section', null);
    if (h) return h;
  }
  if (snap.footer && Array.isArray(snap.footer.elements)) {
    const f = searchArr(snap.footer.elements, snap.footer, 'section', null);
    if (f) return f;
  }
  if (Array.isArray(snap.pages)) {
    for (let pi = 0; pi < snap.pages.length; pi++) {
      const page = snap.pages[pi];
      if (!page || !Array.isArray(page.sections)) continue;
      for (let si = 0; si < page.sections.length; si++) {
        const sec = page.sections[si]!;
        const hitS = searchArr(sec.elements, sec, 'section', null);
        if (hitS) return hitS;
      }
    }
  }
  return null;
}

interface SectionLocation {
  section: SnapshotSection;
  prevSectionId: string | null;
  scope: 'header' | 'footer' | 'page';
  pageId: string | null;
  index: number;
}

function findSectionInSnapshot(snap: Snapshot, sectionId: string): SectionLocation | null {
  if (snap.header && snap.header.id === sectionId) {
    return { section: snap.header, prevSectionId: null, scope: 'header', pageId: null, index: -1 };
  }
  if (snap.footer && snap.footer.id === sectionId) {
    return { section: snap.footer, prevSectionId: null, scope: 'footer', pageId: null, index: -1 };
  }
  if (!Array.isArray(snap.pages)) return null;
  for (let pi = 0; pi < snap.pages.length; pi++) {
    const page = snap.pages[pi];
    if (!page || !Array.isArray(page.sections)) continue;
    for (let si = 0; si < page.sections.length; si++) {
      if (page.sections[si]!.id === sectionId) {
        const prev = si > 0 ? page.sections[si - 1]!.id || null : null;
        return {
          section: page.sections[si]!,
          prevSectionId: prev,
          scope: 'page',
          pageId: page.id || null,
          index: si,
        };
      }
    }
  }
  return null;
}

// Scan the whole snapshot for action elements whose href points at the
// given pageId. deletePage rewrites these to '{type:external, url:"#"}';
// restorePage uses the captured list to re-point them.
function collectActionRefsToPage(
  snap: Snapshot,
  pageId: string,
): Array<{ sectionId: string; elementId: string }> {
  const refs: Array<{ sectionId: string; elementId: string }> = [];
  function scanSection(section: SnapshotSection | undefined): void {
    if (!section || !Array.isArray(section.elements)) return;
    for (let i = 0; i < section.elements.length; i++) {
      const el = section.elements[i];
      if (
        el &&
        el.type === 'action' &&
        el.href &&
        typeof el.href === 'object' &&
        el.href.type === 'page' &&
        el.href.pageId === pageId
      ) {
        refs.push({ sectionId: section.id || '', elementId: el.id || '' });
      }
    }
  }
  if (snap.header) scanSection(snap.header);
  if (snap.footer) scanSection(snap.footer);
  if (Array.isArray(snap.pages)) {
    for (let pi = 0; pi < snap.pages.length; pi++) {
      const page = snap.pages[pi];
      if (!page || page.id === pageId || !Array.isArray(page.sections)) continue;
      for (let si = 0; si < page.sections.length; si++) {
        scanSection(page.sections[si]);
      }
    }
  }
  return refs;
}

function findPageInSnapshot(
  snap: Snapshot,
  pageId: string,
): { page: SnapshotPage; index: number } | null {
  if (!Array.isArray(snap.pages)) return null;
  for (let i = 0; i < snap.pages.length; i++) {
    if (snap.pages[i]!.id === pageId) return { page: snap.pages[i]!, index: i };
  }
  return null;
}

function collectElementIds(snap: Snapshot): Record<string, boolean> {
  const ids: Record<string, boolean> = {};
  walkSnapshotElements(snap, function (el) {
    if (el && el.id) ids[el.id] = true;
  });
  return ids;
}

function collectSectionIds(snap: Snapshot): Record<string, boolean> {
  const ids: Record<string, boolean> = {};
  if (snap.header && snap.header.id) ids[snap.header.id] = true;
  if (snap.footer && snap.footer.id) ids[snap.footer.id] = true;
  if (Array.isArray(snap.pages)) {
    for (let pi = 0; pi < snap.pages.length; pi++) {
      const page: SnapshotPage | undefined = snap.pages[pi];
      if (!page || !Array.isArray(page.sections)) continue;
      for (let si = 0; si < page.sections.length; si++) {
        const id = page.sections[si]!.id;
        if (id) ids[id] = true;
      }
    }
  }
  return ids;
}

function collectPageIds(snap: Snapshot): Record<string, boolean> {
  const ids: Record<string, boolean> = {};
  if (Array.isArray(snap.pages)) {
    for (let i = 0; i < snap.pages.length; i++) {
      const id = snap.pages[i]!.id;
      if (id) ids[id] = true;
    }
  }
  return ids;
}

function firstNewId(
  prevMap: Record<string, boolean>,
  nextMap: Record<string, boolean>,
  consumedMap: Record<string, boolean> | null,
): string | null {
  for (const k in nextMap) {
    if (
      Object.prototype.hasOwnProperty.call(nextMap, k) &&
      !prevMap[k] &&
      !(consumedMap && consumedMap[k])
    ) {
      if (consumedMap) consumedMap[k] = true;
      return k;
    }
  }
  return null;
}

function clonePatchPrev(
  target: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const prev: Record<string, unknown> = {};
  const deletes: string[] = [];
  if (!patch || typeof patch !== 'object') return prev;
  for (const k in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    if (k === '__deleteFields') continue;
    if (target && Object.prototype.hasOwnProperty.call(target, k)) {
      prev[k] = structuredClone(target[k]);
    } else {
      deletes.push(k);
    }
  }
  if (deletes.length > 0) prev.__deleteFields = deletes;
  return prev;
}

// Pre-state inverse computation. See InverseResult for the tag union.
function computeInverseFromPre(op: AgentOp | null, pre: Snapshot | null): InverseResult {
  if (!op || !pre) return { kind: 'destructive', reason: 'missing state' };
  if (op.kind === 'rewriteText') {
    const rt = findElementInSnapshot(pre, op.elementId || '');
    if (!rt || rt.element.type !== 'text')
      return { kind: 'destructive', reason: 'rewriteText target missing' };
    return {
      kind: 'ready',
      op: {
        kind: 'rewriteText',
        elementId: op.elementId,
        content: structuredClone((rt.element.content as Array<{ text?: string }>) || []),
      },
    };
  }
  if (op.kind === 'replaceMedia') {
    const rm = findElementInSnapshot(pre, op.elementId || '');
    if (!rm || rm.element.type !== 'media')
      return { kind: 'destructive', reason: 'replaceMedia target missing' };
    return {
      kind: 'ready',
      op: {
        kind: 'replaceMedia',
        elementId: op.elementId,
        mediaKind: rm.element.mediaKind,
        assetId: rm.element.assetId,
        alt: typeof rm.element.alt === 'string' ? rm.element.alt : '',
      },
    };
  }
  if (op.kind === 'updateElement') {
    const ue = findElementInSnapshot(pre, op.elementId || '');
    if (!ue) return { kind: 'destructive', reason: 'updateElement target missing' };
    return {
      kind: 'ready',
      op: {
        kind: 'updateElement',
        elementId: op.elementId,
        // elementType is read by the server but not part of AgentOp's loose
        // shape; carry it as an extra field via cast so the inline twin's
        // wire format is preserved.
        ...({ elementType: ue.element.type } as Record<string, unknown>),
        patch: clonePatchPrev(ue.element as Record<string, unknown>, op.patch),
      },
    };
  }
  if (op.kind === 'updateSection') {
    const us = findSectionInSnapshot(pre, op.sectionId || '');
    if (!us) return { kind: 'destructive', reason: 'updateSection target missing' };
    return {
      kind: 'ready',
      op: {
        kind: 'updateSection',
        sectionId: op.sectionId,
        patch: clonePatchPrev(us.section as Record<string, unknown>, op.patch),
      },
    };
  }
  if (op.kind === 'updatePage') {
    const up = findPageInSnapshot(pre, op.pageId || '');
    if (!up) return { kind: 'destructive', reason: 'updatePage target missing' };
    return {
      kind: 'ready',
      op: {
        kind: 'updatePage',
        pageId: op.pageId,
        patch: clonePatchPrev(up.page as Record<string, unknown>, op.patch),
      },
    };
  }
  if (op.kind === 'setStyleKit') {
    return { kind: 'ready', op: { kind: 'setStyleKit', styleKit: pre.styleKit } };
  }
  if (op.kind === 'setSiteConfig') {
    return {
      kind: 'ready',
      op: { kind: 'setSiteConfig', patch: clonePatchPrev(pre as Record<string, unknown>, op.patch) },
    };
  }
  if (op.kind === 'moveSection') {
    const ms = findSectionInSnapshot(pre, op.sectionId || '');
    if (!ms) return { kind: 'destructive', reason: 'moveSection target missing' };
    return {
      kind: 'ready',
      op: { kind: 'moveSection', sectionId: op.sectionId, afterSectionId: ms.prevSectionId || undefined },
    };
  }
  if (
    op.kind === 'addElement' ||
    op.kind === 'addPage' ||
    op.kind === 'insertSection' ||
    op.kind === 'designSection' ||
    op.kind === 'duplicateSection'
  ) {
    return { kind: 'deferred', op: op };
  }
  // Delete ops: snapshot the entity + its position so we can re-insert it
  // via the internal restore* ops. These ops are not exposed to the LLM;
  // only the editor's revert flow emits them.
  if (op.kind === 'deleteElement') {
    const loc = findElementLocationInSnapshot(pre, op.elementId || '');
    if (!loc) return { kind: 'destructive', reason: 'deleteElement target missing' };
    const restoreEl: Record<string, unknown> = {
      kind: 'restoreElement',
      sectionId: loc.section.id,
      parentKind: loc.parentKind,
      index: loc.index,
      element: structuredClone(loc.element),
    };
    if (loc.parentKind === 'tab-panel') {
      restoreEl.tabsElementId = loc.tabsElementId;
      restoreEl.tabId = loc.tabId;
    } else if (loc.parentKind === 'collection-entry') {
      restoreEl.collectionElementId = loc.collectionElementId;
      restoreEl.entryIndex = loc.entryIndex;
    }
    return { kind: 'ready', op: restoreEl };
  }
  if (op.kind === 'deleteSection') {
    const ds = findSectionInSnapshot(pre, op.sectionId || '');
    if (!ds) return { kind: 'destructive', reason: 'deleteSection target missing' };
    return {
      kind: 'ready',
      op: {
        ...({
          kind: 'restoreSection',
          scope: ds.scope,
          pageId: ds.pageId,
          index: ds.index >= 0 ? ds.index : 0,
          section: structuredClone(ds.section),
        } as Record<string, unknown>),
      },
    };
  }
  if (op.kind === 'deletePage') {
    const dp = findPageInSnapshot(pre, op.pageId || '');
    if (!dp) return { kind: 'destructive', reason: 'deletePage target missing' };
    return {
      kind: 'ready',
      op: {
        ...({
          kind: 'restorePage',
          index: dp.index,
          page: structuredClone(dp.page),
          actionHrefRestores: collectActionRefsToPage(pre, op.pageId || ''),
        } as Record<string, unknown>),
      },
    };
  }
  return { kind: 'destructive', reason: 'no per-op inverse for ' + (op.kind || '') };
}

function resolveDeferredInverse(
  originalOp: AgentOp | null,
  pre: Snapshot | null,
  post: Snapshot | null,
  consumedIds: { elements: Record<string, boolean>; sections: Record<string, boolean>; pages: Record<string, boolean> } | null,
): AgentOp | null {
  if (!originalOp || !pre || !post) return null;
  const consumed = consumedIds || { elements: {}, sections: {}, pages: {} };
  if (originalOp.kind === 'addElement') {
    const newEl = firstNewId(collectElementIds(pre), collectElementIds(post), consumed.elements);
    return newEl ? { kind: 'deleteElement', elementId: newEl } : null;
  }
  if (
    originalOp.kind === 'insertSection' ||
    originalOp.kind === 'designSection' ||
    originalOp.kind === 'duplicateSection'
  ) {
    const newSec = firstNewId(collectSectionIds(pre), collectSectionIds(post), consumed.sections);
    return newSec ? { kind: 'deleteSection', sectionId: newSec } : null;
  }
  if (originalOp.kind === 'addPage') {
    const newPg = firstNewId(collectPageIds(pre), collectPageIds(post), consumed.pages);
    return newPg ? { kind: 'deletePage', pageId: newPg } : null;
  }
  return null;
}

// -- Exports (bound by createEditor onto ctx.*) ------------------------

export function describeOp(op: AgentOp): string {
  if (op.kind === 'rewriteText') {
    const preview = Array.isArray(op.content)
      ? op.content.map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('')
      : '';
    const shortened = preview.length > 80 ? preview.slice(0, 77) + '…' : preview;
    return 'Rewrite text ' + op.elementId + ': ' + JSON.stringify(shortened);
  }
  if (op.kind === 'replaceMedia') {
    return 'Replace media ' + op.elementId + ' with asset ' + op.assetId + ' (' + op.mediaKind + ')';
  }
  if (op.kind === 'insertSection') {
    const after = op.afterSectionId ? ' after ' + op.afterSectionId : ' at end';
    const brief = op.input && typeof op.input.brief === 'string' ? op.input.brief : '';
    return (
      'Insert section recipe=' +
      op.recipeId +
      after +
      (brief.length > 0 ? ' — ' + JSON.stringify(brief) : '')
    );
  }
  if (op.kind === 'designSection') {
    const after = op.afterSectionId ? ' after ' + op.afterSectionId : ' at end';
    const name = op.input && typeof op.input.sectionName === 'string' ? op.input.sectionName : 'Custom section';
    return 'Design section ' + JSON.stringify(name) + after;
  }
  if (op.kind === 'deleteElement') return 'Delete element ' + op.elementId;
  if (op.kind === 'updateElement') return 'Update element ' + op.elementId;
  if (op.kind === 'addElement')
    return (
      'Add ' +
      (op.element && op.element.type ? op.element.type : 'element') +
      ' to section ' +
      op.sectionId
    );
  if (op.kind === 'updateSection') return 'Update section ' + op.sectionId;
  if (op.kind === 'deleteSection') return 'Delete section ' + op.sectionId;
  if (op.kind === 'moveSection')
    return (
      'Move section ' +
      op.sectionId +
      (op.afterSectionId ? ' after ' + op.afterSectionId : ' to top')
    );
  if (op.kind === 'duplicateSection') return 'Duplicate section ' + op.sectionId;
  if (op.kind === 'addPage') return 'Add page ' + JSON.stringify(op.title || op.slug || '');
  if (op.kind === 'updatePage') return 'Update page ' + op.pageId;
  if (op.kind === 'deletePage') return 'Delete page ' + op.pageId;
  if (op.kind === 'setStyleKit') return 'Switch style kit to ' + JSON.stringify(op.styleKit);
  return 'Unknown op';
}

export function findCanvasNodeForOpImpl(ctx: EditorContext, op: AgentOp | null): HTMLElement | null {
  if (!ctx.root || !op) return null;
  const elementId = op.elementId || (op.element && op.element.id) || null;
  if (elementId) {
    const elNode = ctx.root.querySelector(
      '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
    );
    if (elNode) return elNode as HTMLElement;
  }
  const sectionId = op.sectionId || op.afterSectionId || null;
  if (sectionId) {
    const secNode = ctx.root.querySelector(
      '[data-opencanvas-section="' + cssEscape(sectionId) + '"]',
    );
    if (secNode) return secNode as HTMLElement;
  }
  return null;
}

export function focusCanvasOnNodeImpl(ctx: EditorContext, node: HTMLElement | null): void {
  if (!node || !ctx.viewport) return;
  const nodeRect = node.getBoundingClientRect();
  const viewRect = ctx.viewport.getBoundingClientRect();
  const nodeCenterX = nodeRect.left + nodeRect.width / 2;
  const nodeCenterY = nodeRect.top + nodeRect.height / 2;
  const viewCenterX = viewRect.left + viewRect.width / 2;
  const viewCenterY = viewRect.top + viewRect.height / 2;
  ctx.camera.x += viewCenterX - nodeCenterX;
  ctx.camera.y += viewCenterY - nodeCenterY;
  applyCameraTransform(ctx);
  node.classList.remove('opencanvas-ai-focus-pulse');
  // Force a reflow so the keyframe restarts on repeated clicks.
  void node.offsetWidth;
  node.classList.add('opencanvas-ai-focus-pulse');
}

export function refreshAcceptAllButtonImpl(ctx: EditorContext): void {
  if (!ctx.chatAcceptAllBtn) return;
  const live = ctx.pendingAiSuggestions.filter(function (s) {
    return s.status === 'pending';
  });
  const label = ctx.chatAcceptAllBtn.querySelector('[data-accept-all-label]');
  const count = ctx.chatAcceptAllBtn.querySelector('[data-accept-all-count]');
  if (live.length === 0) {
    // Belt-and-suspenders hide: set both the hidden attribute AND inline
    // display:none. Inline style beats any stylesheet rule regardless of
    // specificity, so a future CSS regression (or a browser caching an
    // old build) cannot leave a phantom banner on a blank chat. Also
    // reset count + label text so a re-show after hide cannot leak the
    // previous "1".
    ctx.chatAcceptAllBtn.hidden = true;
    ctx.chatAcceptAllBtn.style.display = 'none';
    if (label) label.textContent = 'Accept all changes';
    if (count) count.textContent = '0';
    return;
  }
  ctx.chatAcceptAllBtn.hidden = false;
  // Clear the inline override so the stylesheet's display:flex applies.
  ctx.chatAcceptAllBtn.style.display = '';
  if (label) label.textContent = 'Accept all ' + (live.length === 1 ? 'change' : 'changes');
  if (count) count.textContent = String(live.length);
}

export function applyAgentOpsImpl(
  ctx: EditorContext,
  ops: unknown[],
  suggestions: SuggestionEntry[] | null,
): Promise<boolean> {
  if (!ops || ops.length === 0) return Promise.resolve(false);
  const preSnapshot: Snapshot | null = ctx.state ? (structuredClone(ctx.state)) : null;
  const precomputed: InverseResult[] = [];
  if (suggestions && preSnapshot) {
    for (let pi = 0; pi < suggestions.length; pi++) {
      precomputed.push(computeInverseFromPre(suggestions[pi]!.op as AgentOp, preSnapshot));
    }
  }
  return ctx
    .flushPendingSave()
    .then(function (saved) {
      if (!saved) return false;
      return ctx
        .authFetch(ctx.apiBase + '/canvas-agent/sites/' + ctx.siteId + '/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ops: ops }),
        })
        .then(function (r) {
          return r.json().then(function (body) {
            return { ok: r.ok, body: body as { editableState?: EditableSite; errors?: string[]; error?: string } };
          });
        })
        .then(function (res) {
          if (!res.ok || !res.body || !res.body.editableState) {
            const detail =
              (res.body && ((res.body.errors && res.body.errors[0]) || res.body.error)) ||
              'apply failed';
            ctx.setStatus('Apply failed: ' + detail, 'error');
            return false;
          }
          ctx.state = res.body.editableState;
          if (ctx.state) ctx.state = migrateState(ctx.state);
          ctx.selectedSectionId = null;
          ctx.selectedElementId = null;
          if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
            ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
          }
          applyCustomKitCss(ctx.state);
          // Ghost-preview cleanup BEFORE renderAll: each accepted suggestion
          // had a ghost slot in ctx.ghostSections matching s.suggestionId.
          // The apply replaced that slot with a real section so the ghost
          // must come out, otherwise the next renderAll paints both. The
          // blueprint stays on the suggestion entry — Revert needs it.
          if (suggestions) {
            const acceptedIds = new Set<string>();
            for (let ai = 0; ai < suggestions.length; ai++) {
              const sid = suggestions[ai]!.suggestionId;
              if (typeof sid === 'string') acceptedIds.add(sid);
            }
            if (acceptedIds.size > 0) {
              ctx.ghostSections = ctx.ghostSections.filter((g) => !acceptedIds.has(g.id));
            }
          }
          ctx.renderAll();
          if (suggestions) {
            const consumedDeferredIds = { elements: {}, sections: {}, pages: {} };
            for (let i = 0; i < suggestions.length; i++) {
              const s = suggestions[i]!;
              s.status = 'accepted';
              if (s.cardEl) s.cardEl.setAttribute('data-status', 'accepted');
              if (s.acceptBtn) s.acceptBtn.disabled = true;
              if (s.rejectBtn) s.rejectBtn.disabled = true;
              // renderAll() blew away the old wrappers; the stale attr is
              // gone with them. Clear the back-reference so a future
              // Reject can't poke a detached node.
              s.targetNode = null;
              // Resolve the captured inverse. Deferred entries (new-id
              // ops) need the post-state to look up the new id; otherwise
              // we just lift the ready inverse onto the entry.
              const pc = precomputed[i] || { kind: 'destructive', reason: 'missing pre-snapshot' };
              if (pc.kind === 'ready') {
                s.inverseOp = pc.op;
              } else if (pc.kind === 'deferred' && preSnapshot) {
                const resolved = resolveDeferredInverse(
                  pc.op,
                  preSnapshot,
                  ctx.state,
                  consumedDeferredIds,
                );
                s.inverseOp = resolved || null;
              } else {
                s.inverseOp = null;
              }
              if (s.revertBtn) {
                if (s.inverseOp) {
                  s.revertBtn.hidden = false;
                  s.revertBtn.disabled = false;
                } else {
                  s.revertBtn.hidden = true;
                }
              }
            }
          }
          ctx.setStatus('AI edit applied', 'ok');
          ctx.refreshAcceptAllButton();
          return true;
        });
    })
    .catch(function (err: unknown) {
      ctx.setStatus('Apply failed: ' + errorToString(err), 'error');
      return false;
    });
}

export function revertAgentEntryImpl(ctx: EditorContext, entry: SuggestionEntry | null): Promise<boolean> {
  if (!entry || !entry.inverseOp) {
    ctx.setStatus('Cannot revert this change', 'error');
    return Promise.resolve(false);
  }
  const inverseOp = entry.inverseOp;
  if (entry.revertBtn) entry.revertBtn.disabled = true;
  return ctx
    .flushPendingSave()
    .then(function (saved) {
      if (!saved) {
        if (entry.revertBtn) entry.revertBtn.disabled = false;
        return false;
      }
      return ctx
        .authFetch(ctx.apiBase + '/canvas-agent/sites/' + ctx.siteId + '/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ops: [inverseOp] }),
        })
        .then(function (r) {
          return r.json().then(function (body) {
            return { ok: r.ok, body: body as { editableState?: EditableSite; errors?: string[]; error?: string } };
          });
        })
        .then(function (res) {
          if (!res.ok || !res.body || !res.body.editableState) {
            const detail =
              (res.body && ((res.body.errors && res.body.errors[0]) || res.body.error)) ||
              'revert failed';
            ctx.setStatus('Revert failed: ' + detail, 'error');
            if (entry.revertBtn) entry.revertBtn.disabled = false;
            return false;
          }
          ctx.state = res.body.editableState;
          if (ctx.state) ctx.state = migrateState(ctx.state);
          ctx.selectedSectionId = null;
          ctx.selectedElementId = null;
          if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
            ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
          }
          applyCustomKitCss(ctx.state);
          // Ghost-preview re-materialise BEFORE renderAll: the proposal is
          // back to "pending" so the in-place ghost reappears. The blueprint
          // was captured on Accept and survives the revert round-trip.
          const ghostBlueprint = (entry as { ghostBlueprint?: EditorContext['ghostSections'][number] })
            .ghostBlueprint;
          if (ghostBlueprint) {
            const already = ctx.ghostSections.some((g) => g.id === ghostBlueprint.id);
            if (!already) ctx.ghostSections.push(ghostBlueprint);
          }
          ctx.renderAll();
          // Re-arm the card. Owner can Accept again; that path will
          // recompute a fresh inverse against the new pre-state.
          entry.status = 'pending';
          entry.inverseOp = null;
          if (entry.cardEl) entry.cardEl.setAttribute('data-status', 'pending');
          if (entry.acceptBtn) entry.acceptBtn.disabled = false;
          if (entry.rejectBtn) entry.rejectBtn.disabled = false;
          if (entry.revertBtn) entry.revertBtn.hidden = true;
          // Repaint the canvas overlay so the proposal is visible again.
          entry.targetNode = findCanvasNodeForOpImpl(ctx, entry.op as AgentOp);
          if (entry.targetNode) {
            entry.targetNode.setAttribute('data-ai-overlay-status', 'proposed');
          }
          ctx.setStatus('Reverted', 'ok');
          ctx.refreshAcceptAllButton();
          return true;
        });
    })
    .catch(function (err: unknown) {
      ctx.setStatus('Revert failed: ' + errorToString(err), 'error');
      if (entry.revertBtn) entry.revertBtn.disabled = false;
      return false;
    });
}

export function showAcceptAllSummaryImpl(ctx: EditorContext): void {
  const live = ctx.pendingAiSuggestions.filter(function (s) {
    return s.status === 'pending';
  });
  if (live.length === 0) return;
  const modal = document.createElement('div');
  modal.className = 'opencanvas-ai-summary-modal';
  const card = document.createElement('div');
  card.className = 'opencanvas-ai-summary-modal-card';
  const h = document.createElement('h3');
  h.textContent = 'Apply ' + live.length + ' change' + (live.length === 1 ? '' : 's') + '?';
  card.appendChild(h);
  const ol = document.createElement('ol');
  for (let i = 0; i < live.length; i++) {
    const li = document.createElement('li');
    li.textContent = describeOp(live[i]!.op as AgentOp);
    ol.appendChild(li);
  }
  card.appendChild(ol);
  const actions = document.createElement('div');
  actions.className = 'opencanvas-ai-summary-modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', function () {
    modal.remove();
  });
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'primary';
  go.textContent = 'Apply all';
  go.addEventListener('click', function () {
    go.disabled = true;
    cancel.disabled = true;
    go.textContent = 'Applying…';
    void ctx
      .applyAgentOps(
        live.map(function (s) {
          return s.op;
        }),
        live,
      )
      .then(function () {
        modal.remove();
      });
  });
  actions.appendChild(cancel);
  actions.appendChild(go);
  card.appendChild(actions);
  modal.appendChild(card);
  document.body.appendChild(modal);
}

export function setAiBusyImpl(ctx: EditorContext, busy: boolean): void {
  ctx.aiBusy = busy || ctx.sessionExpired || ctx.accessRevoked;
  const buttons = document.querySelectorAll('[data-ai-button]');
  for (let i = 0; i < buttons.length; i++) {
    (buttons[i] as HTMLButtonElement).disabled = ctx.aiBusy;
  }
}
