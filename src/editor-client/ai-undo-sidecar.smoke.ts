import type { EditorContext } from './editor-context.js';
import type { EditableSite } from '../canvas/schema.js';
import { captureForUndo, flushPendingUndoCapture, redo, undo } from './persist.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[ai-undo-sidecar:smoke] ${message}`);
}

const localStorageStub = {
  getItem() {
    return null;
  },
  setItem() {},
  removeItem() {},
};
(globalThis as unknown as { localStorage: typeof localStorageStub }).localStorage =
  localStorageStub;

const preState: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'home',
      slug: '',
      title: 'Home',
      width: 1200,
      sections: [],
    },
  ],
};

const acceptedState: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'home',
      slug: '',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'real-section',
          recipeId: 'feature-grid',
          name: 'Accepted',
          height: 320,
          elements: [],
        },
      ],
    },
  ],
};

const ghost: EditorContext['ghostSections'][number] = {
  id: 'suggestion-1',
  pageId: 'home',
  afterSectionId: null,
  section: {
    id: 'ghost-section',
    recipeId: 'feature-grid',
    name: 'Ghost',
    height: 320,
    elements: [],
  },
};

function button(): HTMLButtonElement {
  return { disabled: false, hidden: false } as HTMLButtonElement;
}

function card(): HTMLElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
  } as HTMLElement;
}

const statusCard = card();
const acceptBtn = button();
const rejectBtn = button();
const revertBtn = button();
const inverseOp = { kind: 'deleteSection', sectionId: 'real-section' };
const targetAttrs = new Map<string, string>();
const target = {
  setAttribute(name: string, value: string) {
    targetAttrs.set(name, value);
  },
  removeAttribute(name: string) {
    targetAttrs.delete(name);
  },
} as HTMLElement;

const entry: EditorContext['pendingAiSuggestions'][number] = {
  op: { kind: 'insertSection', pageId: 'home' },
  toolName: 'insertSection',
  status: 'pending',
  cardEl: statusCard,
  targetNode: null,
  inverseOp: null,
  acceptBtn,
  rejectBtn,
  revertBtn,
  suggestionId: 'suggestion-1',
  ghostBlueprint: structuredClone(ghost),
};

const events: string[] = [];
const ctx = {
  state: structuredClone(preState),
  undoStack: [structuredClone(preState)],
  redoStack: [],
  undoTimer: null,
  undoRedoing: false,
  undoPersistenceFailed: false,
  siteId: 'site-ai',
  ghostSections: [structuredClone(ghost)],
  pendingAiSuggestions: [entry],
  renderAll() {
    events.push('renderAll');
  },
  scheduleSave() {
    events.push('scheduleSave');
  },
  setStatus(message: string) {
    events.push(message);
  },
  refreshAcceptAllButton() {
    events.push('refreshAcceptAllButton');
  },
  findCanvasNodeForOp() {
    return target;
  },
} as unknown as EditorContext;

ctx.state = structuredClone(acceptedState);
captureForUndo(ctx);
ctx.ghostSections = [];
entry.status = 'accepted';
entry.inverseOp = inverseOp;
acceptBtn.disabled = true;
rejectBtn.disabled = true;
revertBtn.hidden = false;
statusCard.setAttribute('data-status', 'accepted');
flushPendingUndoCapture(ctx);

undo(ctx);
assert(ctx.state?.pages[0]?.sections.length === 0, 'undo must restore the pre-accept canvas state');
const ghostCount = () => ctx.ghostSections.length;
const entryStatus = () => entry.status;
assert(ghostCount() === 1, 'undo must restore the AI proposal ghost');
assert(entryStatus() === 'pending', 'undo must restore the suggestion card to pending');
assert(
  statusCard.getAttribute('data-status') === 'pending',
  'undo must update the card DOM status',
);
assert(!acceptBtn.disabled, 'undo must re-enable Accept');
assert(!rejectBtn.disabled, 'undo must re-enable Reject');
assert(revertBtn.hidden, 'undo must hide Revert for a pending suggestion');
assert(
  targetAttrs.get('data-ai-overlay-status') === 'proposed',
  'undo must repaint the canvas overlay as proposed',
);

redo(ctx);
assert(
  ctx.state?.pages[0]?.sections[0]?.id === 'real-section',
  'redo must restore the accepted canvas state',
);
assert(ghostCount() === 0, 'redo must remove the AI proposal ghost again');
assert(entryStatus() === 'accepted', 'redo must restore the suggestion card to accepted');
assert(
  statusCard.getAttribute('data-status') === 'accepted',
  'redo must update the accepted card DOM status',
);
assert(acceptBtn.disabled, 'redo must disable Accept');
assert(rejectBtn.disabled, 'redo must disable Reject');
assert(!revertBtn.hidden, 'redo must show Revert when an inverse exists');
assert(
  targetAttrs.get('data-ai-overlay-status') === 'accepted',
  'redo must repaint the canvas overlay as accepted',
);

console.log('[ai-undo-sidecar:smoke] OK');
