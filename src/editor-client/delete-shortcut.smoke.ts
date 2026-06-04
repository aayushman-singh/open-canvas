// src/editor-client/delete-shortcut.smoke.ts
//
// Behavioural smoke for the Delete/Backspace keyboard shortcut
// dispatcher in ./delete-shortcut.ts.
//
// Runs under bare Bun (no DOM). The dispatcher takes an injectable
// event shape (DeleteShortcutEvent) instead of a real KeyboardEvent so
// the smoke can synthesise the inputs without a `window` or `document`.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import type { FindElementResult } from './editor-context-types.js';
import { deleteElement } from './inspector-actions.js';
import { handleDeleteShortcut } from './delete-shortcut.js';
import type { DeleteShortcutEvent } from './delete-shortcut.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[delete-shortcut:smoke] ${message}`);
}

// ---- Fixture helpers ---------------------------------------------------

function makeText(id: string): TextElement {
  return {
    id,
    type: 'text',
    box: { x: 0, y: 0, w: 200, h: 60, z: 1 },
    content: [{ text: id }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

function makeSection(id: string, elements: CanvasElement[]): CanvasSection {
  return {
    id,
    recipeId: 'feature-grid',
    name: id,
    height: 800,
    elements,
  };
}

function makePage(id: string, sections: CanvasSection[]): CanvasPage {
  return {
    id,
    slug: id,
    title: id,
    width: 1200,
    sections,
  };
}

function makeSite(opts: {
  page: CanvasPage;
  header?: CanvasSection;
  footer?: CanvasSection;
}): EditableSite {
  const site: EditableSite = {
    styleKit: 'custom',
    pages: [opts.page],
  };
  if (opts.header) site.header = opts.header;
  if (opts.footer) site.footer = opts.footer;
  return site;
}

interface StatusEntry {
  text: string;
  tone: 'ok' | 'error' | 'info' | undefined;
}

interface MockCallLog {
  deleteElementCalls: Array<{ sectionId: string; elementId: string }>;
  handleSectionActionCalls: Array<{ action: string; sectionId: string }>;
  statuses: StatusEntry[];
}

function makeCtx(opts: {
  state: EditableSite;
  activeSection: CanvasSection;
  isEditableTarget?: (target: EventTarget | null) => boolean;
  editingElementId?: string | null;
}): { ctx: EditorContext; log: MockCallLog } {
  const log: MockCallLog = {
    deleteElementCalls: [],
    handleSectionActionCalls: [],
    statuses: [],
  };
  const activeSection = opts.activeSection;
  const activePage = opts.state.pages[0]!;

  // We synthesise a tiny EditorContext just rich enough that the
  // dispatcher's hot path runs. Anything outside the shortcut surface
  // throws loudly — the smoke must not exercise those branches.
  const ctx = {
    state: opts.state,
    selectedElementId: null,
    selectedSectionId: null,
    editingElementId: opts.editingElementId ?? null,
    isEditableShortcutTarget: opts.isEditableTarget ?? (() => false),
    setStatus: (text: string, tone?: 'ok' | 'error' | 'info') => {
      log.statuses.push({ text, tone });
    },
    findElement: (elementId: string): FindElementResult | null => {
      // Walk header → footer → active page sections (mirrors the real
      // findElement contract documented on EditorContext).
      const candidates: CanvasSection[] = [];
      if (opts.state.header) candidates.push(opts.state.header);
      if (opts.state.footer) candidates.push(opts.state.footer);
      for (const s of activePage.sections) candidates.push(s);
      for (const s of candidates) {
        for (const el of s.elements) {
          if (el.id === elementId) {
            return {
              section: s,
              element: el,
              parentArray: s.elements,
              parentKind: 'section',
              parentMeta: null,
            };
          }
        }
      }
      return null;
    },
    currentPage: () => activePage,
    deleteElement: (section: CanvasSection, element: CanvasElement) => {
      log.deleteElementCalls.push({
        sectionId: section.id,
        elementId: element.id,
      });
      // Use the real mutation so the smoke also exercises the contract
      // that deleteElement clears ctx.selectedElementId when it matches
      // (the inspector-actions smoke pins that). We stub the lifecycle
      // hooks (renderAll/scheduleSave/etc.) below.
      deleteElement(ctxRef.value, section, element);
    },
    handleSectionAction: (action: string, sectionId: string) => {
      log.handleSectionActionCalls.push({ action, sectionId });
      if (action === 'delete-section') {
        // Mirror the real section-toolbar behaviour for the cases the
        // smoke exercises: header/footer match → delete from site;
        // last-section guard → setStatus + return; otherwise → splice
        // out of the page's sections array and clear selection.
        if (opts.state.header && opts.state.header.id === sectionId) {
          delete opts.state.header;
          ctxRef.value.selectedSectionId = null;
          ctxRef.value.setStatus('Header removed', 'ok');
          return;
        }
        if (opts.state.footer && opts.state.footer.id === sectionId) {
          delete opts.state.footer;
          ctxRef.value.selectedSectionId = null;
          ctxRef.value.setStatus('Footer removed', 'ok');
          return;
        }
        if (activePage.sections.length <= 1) {
          ctxRef.value.setStatus("Can't delete the last section", 'error');
          return;
        }
        const idx = activePage.sections.findIndex((s) => s.id === sectionId);
        if (idx >= 0) {
          activePage.sections.splice(idx, 1);
          ctxRef.value.selectedSectionId = null;
        }
      }
    },
    // The deleteElement call chain reaches into these mocks. The real
    // inspector-actions deleteElement calls closeElementMenu, captureForUndo,
    // renderAll, renderInspector, scheduleSave — we no-op all of them.
    closeElementMenu: () => {},
    captureForUndo: () => {},
    renderAll: () => {},
    renderInspector: () => {},
    scheduleSave: () => {},
    // Properties touched only by other ctx pathways — initialised so the
    // EditorContext shape is satisfied at runtime.
  } as unknown as EditorContext;
  // Bind a small ref so the closures above can read/mutate the same
  // ctx instance (the inspector-actions deleteElement asks for ctx).
  const ctxRef = { value: ctx };
  // Pre-fix activeSection back-pointers if any test wants direct access.
  void activeSection;
  return { ctx, log };
}

function makeEvent(
  key: string,
  opts: { ctrl?: boolean; meta?: boolean; alt?: boolean; target?: EventTarget | null } = {},
): DeleteShortcutEvent {
  return {
    key,
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    altKey: opts.alt ?? false,
    target: opts.target ?? null,
  };
}

// ---- Spec 1: Delete removes the selected element -----------------------

(function deleteKeyRemovesSelectedElement() {
  const elA = makeText('el-a');
  const elB = makeText('el-b');
  const section = makeSection('sec-a', [elA, elB]);
  const page = makePage('p1', [section]);
  const state = makeSite({ page });
  const { ctx, log } = makeCtx({ state, activeSection: section });
  ctx.selectedElementId = 'el-a';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Delete'));

  assert(outcome === 'element', `Delete on element selection: outcome must be 'element' (got '${outcome}')`);
  assert(
    section.elements.length === 1 && section.elements[0]!.id === 'el-b',
    'Delete must splice el-a out of the section, leaving el-b',
  );
  assert(ctx.selectedElementId === null, 'Delete must clear ctx.selectedElementId for the removed element');
  assert(
    log.deleteElementCalls.length === 1 && log.deleteElementCalls[0]!.elementId === 'el-a',
    'Delete must call ctx.deleteElement exactly once for the selected element',
  );
  const success = log.statuses[log.statuses.length - 1];
  assert(
    success !== undefined && success.text === 'Deleted text' && success.tone === 'ok',
    `Delete must surface "Deleted text" toast (got ${JSON.stringify(success)})`,
  );
})();

// ---- Spec 2: Backspace also removes the selected element ---------------

(function backspaceKeyRemovesSelectedElement() {
  const elA = makeText('el-a');
  const elB = makeText('el-b');
  const section = makeSection('sec-a', [elA, elB]);
  const page = makePage('p1', [section]);
  const state = makeSite({ page });
  const { ctx } = makeCtx({ state, activeSection: section });
  ctx.selectedElementId = 'el-b';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Backspace'));

  assert(outcome === 'element', `Backspace on element selection: outcome must be 'element' (got '${outcome}')`);
  assert(
    section.elements.length === 1 && section.elements[0]!.id === 'el-a',
    'Backspace must splice el-b out, leaving el-a',
  );
  assert(ctx.selectedElementId === null, 'Backspace must clear ctx.selectedElementId for the removed element');
})();

// ---- Spec 3: Focus inside an input is a no-op --------------------------

(function inputFocusBlocksShortcut() {
  const elA = makeText('el-a');
  const section = makeSection('sec-a', [elA]);
  const page = makePage('p1', [section]);
  const state = makeSite({ page });
  // Sentinel target object — the editable check is fully delegated to
  // isEditableShortcutTarget, so we just return true for our sentinel.
  const inputSentinel = { kind: 'input-sentinel' } as unknown as EventTarget;
  const { ctx, log } = makeCtx({
    state,
    activeSection: section,
    isEditableTarget: (t) => t === inputSentinel,
  });
  ctx.selectedElementId = 'el-a';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Delete', { target: inputSentinel }));

  assert(
    outcome === 'none',
    `Delete with input focused: outcome must be 'none' (got '${outcome}')`,
  );
  assert(
    section.elements.length === 1 && section.elements[0]!.id === 'el-a',
    'Delete with input focused must NOT remove the element',
  );
  assert(log.deleteElementCalls.length === 0, 'Delete with input focused must NOT call ctx.deleteElement');
  assert(log.statuses.length === 0, 'Delete with input focused must NOT surface a toast');
})();

// ---- Spec 4: Site-pinned header refuses delete -------------------------

(function pinnedHeaderRefusesDelete() {
  const header = makeSection('site-header', [makeText('header-el')]);
  const body = makeSection('sec-body', [makeText('body-el')]);
  const otherBody = makeSection('sec-body-2', [makeText('body-el-2')]);
  const page = makePage('p1', [body, otherBody]);
  const state = makeSite({ page, header });
  const { ctx, log } = makeCtx({ state, activeSection: header });
  ctx.selectedSectionId = 'site-header';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Delete'));

  assert(
    outcome === 'pinned-blocked',
    `Delete on pinned header: outcome must be 'pinned-blocked' (got '${outcome}')`,
  );
  assert(state.header !== undefined, 'Delete on pinned header must NOT remove state.header');
  assert(
    log.handleSectionActionCalls.length === 0,
    'Delete on pinned header must NOT call ctx.handleSectionAction',
  );
  const toast = log.statuses[log.statuses.length - 1];
  assert(
    toast !== undefined &&
      toast.text === 'Site header/footer cannot be deleted' &&
      toast.tone === 'error',
    `Pinned header delete must surface a refusal toast (got ${JSON.stringify(toast)})`,
  );
})();

// ---- Spec 5: Site-pinned footer refuses delete -------------------------

(function pinnedFooterRefusesDelete() {
  const footer = makeSection('site-footer', [makeText('footer-el')]);
  const body = makeSection('sec-body', [makeText('body-el')]);
  const otherBody = makeSection('sec-body-2', [makeText('body-el-2')]);
  const page = makePage('p1', [body, otherBody]);
  const state = makeSite({ page, footer });
  const { ctx, log } = makeCtx({ state, activeSection: footer });
  ctx.selectedSectionId = 'site-footer';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Backspace'));

  assert(
    outcome === 'pinned-blocked',
    `Backspace on pinned footer: outcome must be 'pinned-blocked' (got '${outcome}')`,
  );
  assert(state.footer !== undefined, 'Backspace on pinned footer must NOT remove state.footer');
  assert(
    log.handleSectionActionCalls.length === 0,
    'Backspace on pinned footer must NOT call ctx.handleSectionAction',
  );
})();

// ---- Spec 6: Ctrl+Backspace is left to the browser ---------------------

(function modifierKeyBlocksShortcut() {
  const elA = makeText('el-a');
  const section = makeSection('sec-a', [elA]);
  const page = makePage('p1', [section]);
  const state = makeSite({ page });
  const { ctx, log } = makeCtx({ state, activeSection: section });
  ctx.selectedElementId = 'el-a';

  const ctrlOutcome = handleDeleteShortcut(ctx, makeEvent('Backspace', { ctrl: true }));
  const metaOutcome = handleDeleteShortcut(ctx, makeEvent('Delete', { meta: true }));
  const altOutcome = handleDeleteShortcut(ctx, makeEvent('Delete', { alt: true }));

  assert(ctrlOutcome === 'none', `Ctrl+Backspace: outcome must be 'none' (got '${ctrlOutcome}')`);
  assert(metaOutcome === 'none', `Meta+Delete: outcome must be 'none' (got '${metaOutcome}')`);
  assert(altOutcome === 'none', `Alt+Delete: outcome must be 'none' (got '${altOutcome}')`);
  assert(
    section.elements.length === 1 && section.elements[0]!.id === 'el-a',
    'Modifier-held Delete/Backspace must NOT remove the element',
  );
  assert(log.deleteElementCalls.length === 0, 'Modifier-held shortcut must NOT call ctx.deleteElement');
})();

// ---- Spec 7: Inline text edit in progress blocks the shortcut ---------

(function inlineEditBlocksShortcut() {
  const elA = makeText('el-a');
  const section = makeSection('sec-a', [elA]);
  const page = makePage('p1', [section]);
  const state = makeSite({ page });
  const { ctx, log } = makeCtx({ state, activeSection: section, editingElementId: 'el-a' });
  ctx.selectedElementId = 'el-a';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Delete'));

  assert(outcome === 'none', `Delete while editing: outcome must be 'none' (got '${outcome}')`);
  assert(section.elements.length === 1, 'Delete while editing must NOT remove the element');
  assert(log.deleteElementCalls.length === 0, 'Delete while editing must NOT call ctx.deleteElement');
})();

// ---- Spec 8: Non-pinned section delete on a page with >1 sections -----

(function bodySectionDeletes() {
  const body = makeSection('sec-body', [makeText('body-el')]);
  const otherBody = makeSection('sec-body-2', [makeText('body-el-2')]);
  const page = makePage('p1', [body, otherBody]);
  const state = makeSite({ page });
  const { ctx, log } = makeCtx({ state, activeSection: body });
  ctx.selectedSectionId = 'sec-body';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Delete'));

  assert(outcome === 'section', `Delete on body section: outcome must be 'section' (got '${outcome}')`);
  assert(page.sections.length === 1, 'Delete on body section must splice it out of page.sections');
  assert(page.sections[0]!.id === 'sec-body-2', 'Survivor must be the other body section');
  assert(
    log.handleSectionActionCalls.length === 1 &&
      log.handleSectionActionCalls[0]!.action === 'delete-section' &&
      log.handleSectionActionCalls[0]!.sectionId === 'sec-body',
    'Delete on body section must call ctx.handleSectionAction("delete-section", id) exactly once',
  );
  const toast = log.statuses[log.statuses.length - 1];
  assert(
    toast !== undefined && toast.text === 'Deleted section' && toast.tone === 'ok',
    `Body section delete must surface "Deleted section" toast (got ${JSON.stringify(toast)})`,
  );
})();

// ---- Spec 9: Last-section guard preserves error toast ------------------

(function lastSectionGuardKeepsErrorToast() {
  const only = makeSection('sec-only', [makeText('e')]);
  const page = makePage('p1', [only]);
  const state = makeSite({ page });
  const { ctx, log } = makeCtx({ state, activeSection: only });
  ctx.selectedSectionId = 'sec-only';

  const outcome = handleDeleteShortcut(ctx, makeEvent('Delete'));

  assert(outcome === 'section', `Delete on last section: outcome must be 'section' (got '${outcome}')`);
  assert(page.sections.length === 1, 'Last-section guard must keep the section in place');
  const toast = log.statuses[log.statuses.length - 1];
  assert(
    toast !== undefined && toast.text === "Can't delete the last section" && toast.tone === 'error',
    `Last-section guard must keep the error toast as the last status (got ${JSON.stringify(toast)})`,
  );
})();

// ---- Spec 10: No selection = no-op (consume neither key nor mutation) --

(function noSelectionConsumesNothing() {
  const elA = makeText('el-a');
  const section = makeSection('sec-a', [elA]);
  const page = makePage('p1', [section]);
  const state = makeSite({ page });
  const { ctx, log } = makeCtx({ state, activeSection: section });
  // No selection set.

  const outcome = handleDeleteShortcut(ctx, makeEvent('Delete'));

  assert(
    outcome === 'no-selection',
    `Delete with no selection: outcome must be 'no-selection' (got '${outcome}')`,
  );
  assert(section.elements.length === 1, 'Delete with no selection must NOT remove anything');
  assert(log.deleteElementCalls.length === 0, 'Delete with no selection must NOT call ctx.deleteElement');
  assert(
    log.handleSectionActionCalls.length === 0,
    'Delete with no selection must NOT call ctx.handleSectionAction',
  );
})();

console.log('[delete-shortcut:smoke] OK');
