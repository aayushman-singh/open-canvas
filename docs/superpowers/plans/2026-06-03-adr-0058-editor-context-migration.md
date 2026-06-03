# ADR 0058 EditorContext Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land [ADR 0058](../../adr/0058-editor-context-as-iife-closure-mirror.md)'s gating commit (empty `EditorContext` interface + `createEditor` stub) and the Phase 2h–2q extraction sequence that decomposes the remaining ~95% of `src/editor/canvas-client.ts` into sibling modules under `src/editor-client/`.

**Architecture:** Each Phase 2 extraction moves one cohesive chunk of the inline IIFE into a sibling TS module that takes `ctx: EditorContext` as its first parameter. The IIFE in `canvas-client.ts` keeps its inline code unchanged during the migration — extracted modules are dead code paths until Phase 3 cutover. Parity smokes (where feasible) catch behavioural drift between inline IIFE and extracted module.

**Tech Stack:** TypeScript, Bun.build (`scripts/build-editor-client.ts`), pre-commit chain (lint-staged + `tsc --noEmit && tsc --noEmit -p src/editor-client` + 16 smokes), plain function exports taking `ctx: EditorContext`.

---

## Hard constraints (enforced every step)

1. **Pre-commit chain is the gate.** Every commit goes through 16 smokes + tsc + lint-staged. No `--no-verify`. No `--no-stash` (the chain runs as-configured).
2. **`editor-client:build` must keep emitting both JS and CSS.** The gating commit must NOT remove `import './styles.css'` from [`src/editor-client/index.ts`](../../../src/editor-client/index.ts). Verify with `bun run editor-client:build` and confirm both artifacts appear in the regenerated `src/_assets/manifest.generated.ts`.
3. **Failure contract preserved.** `createEditor(boot)` catches initial-load errors internally and surfaces them through the editor status line. No unhandled top-level promise rejections. No silent fallbacks.
4. **One logical change per commit.** Conventional messages: `feat:` for genuinely new modules, `chore(adr-0058):` for each migration commit, `test:` for added smokes. If a commit mixes concerns, the C3 missed-split from earlier today is the negative example — stop, split, then commit.
5. **Pushback before deviation.** If a Phase chunk reveals that the "mechanical" extraction diverges from the "right" extraction (e.g. a closure var is used in a way that suggests it should be removed entirely, or a helper has dead branches), STOP and surface to the user before deviating. The migration's goal is diff reviewability, not opportunistic cleanup — those land as separate follow-up commits.
6. **No fallbacks.** If a Phase 2 chunk can't preserve the inline IIFE's behaviour exactly, the extraction stops at a "X done, Y open question" handoff to the user. Never paper over divergence with a workaround.

---

## File structure overview

**New files (gating commit):**
- `src/editor-client/editor-context.ts` — `EditorContext` interface (starts empty) + `EditorBoot` interface (boot payload shape).

**Modified files (gating commit):**
- `src/editor-client/index.ts` — adds `createEditor(boot)` export alongside the existing import-exercising stub. Preserves `import './styles.css'`. Keeps the existing Phase 2a–2g imports + console.log.

**Per-phase files (2h–2q): one new module per phase**
- `src/editor-client/<chunk-name>.ts` — extracted module taking `ctx: EditorContext` as first parameter on each export.
- `src/editor-client/<chunk-name>.smoke.ts` — when feasible, a parity smoke comparing inline IIFE output to extracted module output for the same input. Modelled on [`src/editor/canvas-client-parse.smoke.ts`](../../../src/editor/canvas-client-parse.smoke.ts).

**Per-phase modifications:**
- `src/editor-client/editor-context.ts` — append the fields the new module touches.
- `src/editor-client/index.ts` — `createEditor`'s body wires the new module into ctx (when applicable: e.g., helpers like `scheduleSave` get attached to ctx so call sites can use `ctx.scheduleSave()`).
- `package.json` — when a phase adds a smoke, wire it into `ci:smoke` if it's fast enough to belong in the pre-commit chain. Otherwise document it as an out-of-chain smoke (like `inspector-smoke`).

**Files NOT modified during Phase 2:**
- `src/editor/canvas-client.ts` — the inline IIFE stays as the production source-of-truth until Phase 3. Extracted modules are dead code paths during the migration.
- `wrangler.toml` — no `[assets]` binding until Phase 3.
- The editor route handler — no change until Phase 3 cutover.

---

## Task 1 — Gating commit: empty `EditorContext` interface + `createEditor` stub

**Files:**
- Create: `src/editor-client/editor-context.ts`
- Modify: `src/editor-client/index.ts`

- [ ] **Step 1.1: Create the interface file**

Write `src/editor-client/editor-context.ts`:

```typescript
// src/editor-client/editor-context.ts
//
// ADR 0058 — EditorContext is a 1:1 mirror of the IIFE closure surface
// of src/editor/canvas-client.ts. The interface starts empty here and
// grows commit-by-commit as Phase 2h+ extractions add the fields their
// modules touch.
//
// Read this file to see the migration's scoreboard: when the interface
// stops growing, the IIFE is fully decomposed.

/**
 * Shape of the boot payload the editor route emits as
 * `window.__opencanvasEditorBoot`. Phase 3 cutover wires this; Phase 2
 * extractions reference the shape but do not yet consume a real boot.
 */
export interface EditorBoot {
  siteId: string;
  apiBase: string;
  wsToken: string;
  displayName: string;
  userId: string;
}

/**
 * Single mutable object mirroring the IIFE closure surface. Extracted
 * modules accept this as their first parameter and read/mutate fields
 * directly — the same shape the IIFE uses today, lifted out of closure.
 *
 * Empty at the gating commit. Each Phase 2h+ extraction appends the
 * fields its module touches. See ADR 0058 Decision 4.
 */
export interface EditorContext {
  // Populated incrementally by Phase 2h+ extractions.
}
```

- [ ] **Step 1.2: Add `createEditor` to `index.ts`**

Edit `src/editor-client/index.ts` to append the createEditor export (keep the existing imports and console.log stub untouched):

```typescript
// ...existing imports + void statements + console.log stub above...

import type { EditorBoot, EditorContext } from './editor-context.js';

export type { EditorBoot, EditorContext };

/**
 * ADR 0058 — Editor entry point. Today's IIFE body lifts into this
 * function as Phase 2h+ extractions land. The gating commit ships
 * the stub: the function declares its signature, throws if called
 * (the editor route still serves canvasClientScript() until Phase 3
 * cutover), and exists so extracted modules have a real entry point
 * to wire into.
 *
 * Failure contract: when this function fails initial-load, the error
 * is caught here and surfaced through the editor status line. No
 * unhandled top-level promise rejection.
 */
export function createEditor(_boot: EditorBoot): void {
  void _boot;
  throw new Error(
    'createEditor: stub — the editor route still serves canvasClientScript() ' +
      'until ADR 0015 Phase 3 cutover. Phase 2h+ extractions land here.',
  );
}

// Re-export the empty interface so consumers can import the type from
// the entry point and benefit from auto-import suggestions.
type _ContextSignatureCheck = EditorContext;
const _ctxCheck: _ContextSignatureCheck = {} as _ContextSignatureCheck;
void _ctxCheck;
```

- [ ] **Step 1.3: Verify the typecheck passes**

Run: `bun run typecheck`
Expected output (last line):
```
$ tsc --noEmit && tsc --noEmit -p src/editor-client
```
Exit code 0, no errors.

- [ ] **Step 1.4: Verify the build emits both JS + CSS**

Run: `bun run editor-client:build`
Expected output (three lines):
```
[build-editor-client] wrote /_assets/index-<hash>.js
[build-editor-client] wrote /_assets/index-<hash>.css
[build-editor-client] manifest at <abs-path>/src/_assets/manifest.generated.ts
```
If only the JS line appears, the CSS sidecar dropped — investigate `import './styles.css'` in `index.ts` before continuing.

- [ ] **Step 1.5: Verify nothing else regressed**

Run: `bun run ci:smoke`
Expected: all 16 smokes pass. Specifically:
- `canvas-client-parse:smoke` — the inline IIFE template literal still parses cleanly (this is the production editor's source-of-truth).
- `host-literal-guard:smoke` — no `rev01` brand literal leakage in new files.

- [ ] **Step 1.6: Commit**

```bash
git -C c:/Repo/rev01 add src/editor-client/editor-context.ts src/editor-client/index.ts
git -C c:/Repo/rev01 commit -m "$(cat <<'EOF'
chore(adr-0058): gating commit — empty EditorContext + createEditor stub

ADR 0058's Follow-up #1. Lands the interface + entry point that Phase
2h+ extractions plug into. No behavioural change: the editor route
still serves canvasClientScript() until Phase 3 cutover, and the
createEditor stub throws if called.

EditorContext is intentionally empty — Decision 4 says each Phase 2h+
extraction adds the fields its module touches when that extraction
lands. The interface is the migration's scoreboard.
EOF
)"
```

Verify the pre-commit chain prints all 16 smokes OK + tsc OK before the commit lands.

**Invariants at commit time:**
- `bun run editor-client:build` emits both JS and CSS.
- `bun run typecheck` passes both root and editor-client tsconfig.
- All 16 ci:smoke smokes pass.
- `canvas-client.ts` is byte-identical to its pre-commit state (zero production impact).

**Risk markers:**
- Adding `EditorContext` as type-only export without runtime use can trigger TS unused-warning on strict configs. The `_ContextSignatureCheck` const guards against this.
- If the existing `index.ts` console.log stub is reformatted by eslint, the diff bleeds into unrelated lines. If that happens, accept the reformat as part of the commit — the eslint output is the canonical formatting source.

---

## Task 2 — Phase 2 extraction protocol (the repeating pattern)

Tasks 3–12 each apply this protocol to one cohesive chunk. Reading this once explains the per-task structure; tasks below name only the chunk-specific details.

For each Phase 2h+ extraction:

**Step P.1: Identify the chunk**

Use Grep + Read on `src/editor/canvas-client.ts` to bound the chunk by:
- Function name(s) — e.g., "everything between `function renderInspector() {` and the next top-level `function ` declaration."
- Line range — record the inclusive start/end lines.
- Closure-var dependencies — every identifier in the chunk that isn't declared inside it AND isn't a top-level JS global (`document`, `window`, `Math`, `console`, etc.) is a candidate for `EditorContext`.

**Step P.2: Create the extracted module**

Path: `src/editor-client/<chunk-name>.ts`

Shape:

```typescript
// src/editor-client/<chunk-name>.ts
//
// ADR 0058 Phase 2<letter> — <human-readable chunk name>.
// canvas-client.ts:<start>–<end> carries the inline twin; retires on
// the Phase 3 atomic cutover.

import type { EditorContext } from './editor-context.js';
// ...imports from sibling Phase 2a–2g modules as needed...

export function <fnName>(ctx: EditorContext, ...args): <retType> {
  // Copy of the inline IIFE body, with every closure-var access
  // rewritten as `ctx.<varname>`. No structural rewrites; only the
  // ctx prefix.
}
```

Mechanical rule: each line of inline IIFE code maps to one line in the extracted module with `s/<closure-var>/ctx.<closure-var>/g`. If a line in the chunk requires structural change (a closure var becomes a parameter, a helper is renamed, a branch is collapsed), STOP and surface to the user — that's pushback territory, not the mechanical extraction the ADR commits to.

**Step P.3: Extend `EditorContext`**

Edit `src/editor-client/editor-context.ts` to append the fields the new module touches. Group by ADR 0058 Decision 3:
- Functions called from many modules → fields on ctx (`ctx.scheduleSave: () => void`).
- Functions private to this chunk → inner declarations inside the new module's file.

**Step P.4: Wire the module into `createEditor`**

If the chunk's exports include helpers that are called from many modules (e.g. `scheduleSave`, `renderAll`), `createEditor` must assign them onto ctx during boot:

```typescript
// in src/editor-client/index.ts createEditor body, after ctx construction
ctx.scheduleSave = () => scheduleSaveModule(ctx);
```

If the chunk is leaf-like (handlers called only from `createEditor` itself), `createEditor` calls them directly without attaching to ctx.

**Step P.5: Add a parity smoke when the chunk admits one**

When the chunk is a pure function of inputs (data-in, data-out), add a smoke that:
1. Imports the extracted module.
2. Imports the inline IIFE source via `canvasClientScript({...})`.
3. Calls both with identical inputs.
4. Asserts byte-identical output.

Smoke path: `src/editor-client/<chunk-name>.smoke.ts`. Wire it into `package.json`'s `ci:smoke` chain if the smoke runs in under 1s. Otherwise document it as a manual smoke (like `inspector-smoke`).

When the chunk is event-driven (drag handlers, click handlers), parity smokes are not feasible. Document the behavioural assertion the existing editor smoke (`canvas-client-parse:smoke`, `inspector-smoke`) must satisfy on the production inline path, and skip the parity smoke.

**Step P.6: Run the full verification**

```bash
bun run typecheck
bun run editor-client:build
bun run src/editor/inspector-smoke.ts  # if the chunk touches inspector code
bun run ci:smoke
```

All must pass. The `editor-client:build` output must continue to show both JS and CSS lines.

**Step P.7: Commit**

```bash
git -C c:/Repo/rev01 add src/editor-client/<chunk-name>.ts src/editor-client/editor-context.ts src/editor-client/index.ts <smoke-path-if-applicable> package.json
git -C c:/Repo/rev01 commit -m "$(cat <<'EOF'
chore(adr-0058): Phase 2<letter> — extract <chunk-name>

canvas-client.ts:<start>–<end> moves into src/editor-client/<chunk-name>.ts.
EditorContext gains <N> fields: <field list>. createEditor wires <list>.

Parity smoke / behavioural assertion: <description>.

Inline IIFE in canvas-client.ts is unchanged. Phase 3 cutover retires
the inline twin.
EOF
)"
```

**Invariants at every Phase 2 commit:**
- `canvas-client.ts` byte-identical to its pre-commit state (the inline IIFE is untouched).
- `editor-client:build` emits both JS + CSS, manifest regenerated.
- `tsc --noEmit -p src/editor-client` passes — the extracted module typechecks against the growing EditorContext.
- `tsc --noEmit` (root) passes — schema/validate/etc. unaffected.
- All 16 ci:smoke smokes pass.

**Risk markers (apply to every Phase 2h+ task):**
- *Closure leak*: an inline closure var is referenced in the chunk but doesn't appear in any other chunk → fields can be local to the new module instead of on ctx. Check before adding to ctx; smaller ctx is better even though wide is the target.
- *Helper cycles*: extracted helper A calls extracted helper B; B calls A. The current IIFE has function-declaration hoisting; the extracted modules don't (ES module imports are statically resolved). Surface cycles via the typecheck — `import` cycles compile but are fragile.
- *Mutation timing*: extracted module mutates ctx.state but inline IIFE has a debounced/queued mutation. If the extraction changes when the mutation lands, the parity smoke catches the visible state diff but the timing diff may show up as an event-order regression in `chat-session-race:smoke` or `snapshot-replay:smoke`.
- *DOM ref vs. document.getElementById drift*: cached DOM refs live on ctx, set once at boot. Extracted code must use `ctx.<refName>` not `document.getElementById(...)` — querying mid-flight is a behaviour change.

---

## Task 3 — Phase 2h: Inspector renderer + field builders

**Chunk:** `function renderInspector()` and the per-element-type inspector mounters (`mountAccordionItems`, `mountTabsItems`, etc.) — bounded roughly by lines 4400–7000 of `canvas-client.ts` (verify at extraction time via Grep).

**Target file:** `src/editor-client/inspector.ts`

**Likely EditorContext fields added:**
- `state: EditableSite | null`
- `selectedSectionId: string | null`
- `selectedElementId: string | null`
- `editingElementId: string | null`
- `inspector: HTMLElement` (the cached `#canvas-inspector` ref)
- `scheduleSave(): void`
- `renderAll(): void`
- `findElement(elementId): { section, element } | null`

**Parity-smoke feasibility:** Partial — `renderInspector` is DOM-mutating, no clean parity. But each `mount<Element>Items` helper that takes an element + a host is closer to pure (returns a DOM tree). Add per-element-type parity smokes where they admit one; document behavioural assertion for the orchestrator.

**Specific risks:**
- The inspector heavily uses dispatch from `INSPECTOR_DISPATCH` (interpolated as JSON in the inline IIFE). The extracted module must import `INSPECTOR_DISPATCH` from `../canvas/elements/index.js` (not from the JSON interpolation). Verify the typecheck catches any narrowing differences between the JSON-injected runtime shape and the TS import shape.
- `mountTabsItems` and `mountAccordionItems` mutate element state and call `renderAll()`. The extracted module must call `ctx.renderAll()` not `renderAll()`; the parity smoke catches the diff but typecheck catches it first.
- `inspector-smoke` (out-of-chain, must be run manually) covers this chunk. Run it explicitly after extraction: `bun run src/editor/inspector-smoke.ts`.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

**Commit message (after P.7):**
```
chore(adr-0058): Phase 2h — extract inspector renderer + field builders

canvas-client.ts:<start>–<end> moves into src/editor-client/inspector.ts.
EditorContext gains state/selection/inspector DOM ref + scheduleSave/
renderAll/findElement helpers. createEditor wires scheduleSave +
renderAll + findElement onto ctx.

Parity smoke for mountAccordionItems / mountTabsItems / similar pure
helpers; behavioural assertion via inspector-smoke for the orchestrator.
```

---

## Task 4 — Phase 2i: Drag/drop + resize handlers

**Chunk:** Pointer event handlers — `handlePointerDown`, `handlePointerMove`, `handlePointerUp`, resize/snap helpers. Search `canvas-client.ts` for `addEventListener("pointer` and `pointerdown`/`pointermove`/`pointerup` to bound.

**Target file:** `src/editor-client/drag.ts`

**Likely EditorContext fields added:**
- `mainEl: HTMLElement` (the canvas mount)
- `viewport: HTMLElement` (zoom/pan container)
- `camera: { zoom: number; x: number; y: number }`
- `interactionMode: 'idle' | 'dragging' | 'resizing' | ...`
- Drag-in-progress fields (drag origin, hovered element, snap guides)

**Parity-smoke feasibility:** Not feasible — pointer events depend on DOM event timing. Behavioural assertion: existing manual editor smoke (run `bun run dev:all` and exercise drag in a browser) is the only check.

**Specific risks:**
- Pointer capture / release timing. The IIFE calls `setPointerCapture(event.pointerId)` directly; the extracted module must do the same. A regression here breaks drag mid-stream.
- Snap-guide rendering touches the inspector DOM. Order with Phase 2h matters — if Phase 2h ships first and creates `ctx.renderInspector`, this phase calls it. If 2i lands first, this phase queues the call inline and 2h converts it later. Pick: 2h first.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 5 — Phase 2j: Section toolbar + section-level orchestration

**Chunk:** Section CRUD operations — `addSection`, `deleteSection`, `duplicateSection`, `moveSectionUp/Down`, section-toolbar event handlers. Search for `function addSection(`, `function deleteSection(`, etc.

**Target file:** `src/editor-client/section-ops.ts`

**Likely EditorContext fields added:**
- `state: EditableSite | null` (likely already added by 2h)
- `selectedSectionId: string | null` (likely already by 2h)
- `scheduleSave(): void` (likely already by 2h)
- Section-toolbar DOM ref(s)

**Parity-smoke feasibility:** Yes — each section CRUD operation is "state in → state out." Add `src/editor-client/section-ops.smoke.ts` modelled on `canvas-agent-smoke.ts` (which already exercises `applyCanvasAgentOp` parity).

**Specific risks:**
- Section reordering uses `nextZInArray` from `z-order.ts` (already extracted in Phase 2d). Verify the extracted module imports from the sibling module, not from a JSON-interpolated INSPECTOR_DISPATCH path.
- `addSection` and `deleteSection` both rewrite `action.href`s when a page is deleted (see ADR 0011 Step 5 territory). The extracted module must preserve this exact rewrite shape — diff-check against `restorePage`'s `actionHrefRestores` (added today in commit 3eb91cb) for the inverse pattern.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 6 — Phase 2k: Chat panel orchestration + suggestion-card lifecycle

**Chunk:** Chat panel UI orchestration — `openChatPanel`, `closeChatPanel`, suggestion-card append/accept/reject handlers, Accept-all banner state. Search for `canvas-chat-` selectors and `chatBusy`/`chatAcceptAllBtn`.

**Target file:** `src/editor-client/chat-panel.ts`

**Likely EditorContext fields added:**
- `chatBusy: boolean`
- `chatAcceptAllBtn: HTMLButtonElement | null`
- `chatMessages: HTMLElement | null`
- `chatWelcome: HTMLElement | null`
- Suggestion-tracker state (the "live" suggestions array)

**Parity-smoke feasibility:** Partial — suggestion-card lifecycle is state-machine-like; can be parity-tested against a fixed input sequence. UI bindings (opening the panel, closing it) are event-driven.

**Specific risks:**
- The chat-revert flow (Bucket A's CSS + C2's restoreOps server-side, both landed today) is **not yet wired** in canvas-client.ts. Phase 2k should not assume it exists; the wiring lands in a separate post-migration commit-set (or as part of this phase if the user chooses, but as a deliberate scope expansion not a silent inclusion — pushback territory).
- `chatBusy` is read by the orchestrator and written by the chat panel. Extraction order matters: 2k extracts the reader+writer together so the field's invariants stay local.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 7 — Phase 2l: Render orchestrators (`renderAll`, `renderInspector`, `renderCanvas`)

**Chunk:** The top-level render orchestrators — `function renderAll()` at line 3962 and friends. Search for `function renderAll(`, `function renderCanvas(`, `function renderInspector(`.

**Target file:** `src/editor-client/render.ts`

**Likely EditorContext fields added:**
- All DOM refs not yet added (`root`, any per-section/per-page roots)
- Camera/viewport state (likely already by 2i)

**Parity-smoke feasibility:** Partial — `renderCanvas` is state-in / DOM-out; can be parity-tested by snapshotting `innerHTML` of a known canvas root after rendering identical state into inline and extracted paths.

**Specific risks:**
- `renderAll` orchestrates `renderInspector` + `renderCanvas`. Extraction order: 2h (inspector) → 2l (renderAll). When 2l extracts, `renderInspector` is already a `ctx.renderInspector()` call — the extraction is mechanical from there.
- `renderAll` is called from MANY sites — drag handlers (2i), section ops (2j), chat panel (2k), keyboard handlers (2o), undo/redo (2m). Each of those phases must already use `ctx.renderAll()` before this phase lands; the typecheck catches violations.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 8 — Phase 2m: Persist orchestrator (`scheduleSave` + `authFetch`) + undo/redo

**Chunk:** Debounced persistence — `function scheduleSave()` at line 2440 and the underlying `authFetch` + undo/redo stack management.

**Target file:** `src/editor-client/persist.ts`

**Likely EditorContext fields added:**
- `undoStack: Snapshot[]`
- `redoStack: Snapshot[]`
- `savePendingTimer: ReturnType<typeof setTimeout> | null`
- `authFetch(url, opts): Promise<Response>` (helper on ctx)

**Parity-smoke feasibility:** Yes — `scheduleSave`'s debounce can be tested with `setTimeout` mocking. Add `src/editor-client/persist.smoke.ts`.

**Specific risks:**
- `scheduleSave` reads `state` and POSTs it; the debounce timing is load-bearing for `chat-session-race:smoke` (the existing smoke for ADR 0048 last-writer-wins concurrent tab writes). Verify that smoke after extraction.
- `authFetch` is also used by the chat orchestrator (Phase 2k) and the agent integration (Phase 2n). Extraction order: 2m provides `ctx.authFetch`, 2k+2n consume it. Either 2m before 2k+2n, or the consumers stage inline references that 2m converts.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 9 — Phase 2n: AI integration (canvas-agent client, busy flags)

**Chunk:** The editor-side canvas-agent client — `function callCanvasAgent`, `aiBusy` flag management, agent-tool-call dispatch.

**Target file:** `src/editor-client/ai.ts`

**Likely EditorContext fields added:**
- `aiBusy: boolean`
- `aiPanel: HTMLElement | null`
- (`authFetch` already by 2m)

**Parity-smoke feasibility:** Partial — the agent client makes network calls; pure-function parity isn't possible, but the request-shape construction (URL, headers, body) is testable.

**Specific risks:**
- The agent integration depends on `chatBusy`/`aiBusy` separation. Verify that the existing `canvas-agent:smoke` and `chat-session-race:smoke` continue to pass after extraction.
- Agent-tool dispatch reads `AGENT_TOOL_DISPATCH` (JSON-injected today). Same pattern as Phase 2h's INSPECTOR_DISPATCH — extracted module imports from `../canvas/elements/index.js` directly.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 10 — Phase 2o: Selection + keyboard handlers

**Chunk:** Selection logic — `function selectElement` (line 8012), `function selectSection`, keyboard event handlers (escape, arrow keys, delete, copy/paste).

**Target file:** `src/editor-client/selection.ts`

**Likely EditorContext fields added:**
- (Most selection state already added by 2h)
- Keyboard handler registration

**Parity-smoke feasibility:** Partial — selection state changes are testable; keyboard events are not.

**Specific risks:**
- `selectElement` triggers `renderInspector` (Phase 2h) and writes to selection state. Extraction order: 2h first, then 2o. If 2o needs to land first, surface to user.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 11 — Phase 2p: Co-edit / presence integration

**Chunk:** The Yjs co-edit client wiring — connection lifecycle, presence pill updates, peer cursor rendering.

**Target file:** `src/editor-client/co-edit.ts`

**Likely EditorContext fields added:**
- `coeditClient: CoEditClient | null` (the imported client from `src/live/co-edit/`)
- `presenceList: PresenceEntry[]`
- Reconnect attempt counter

**Parity-smoke feasibility:** Not feasible — co-edit is a long-running WebSocket connection. Behavioural assertion: existing `yjs-projection:smoke` covers projection correctness; manual testing covers reconnect behaviour.

**Specific risks:**
- `coeditClient` is imported from `src/live/co-edit/bundled.ts` (the bundled-string IIFE that ADR 0015 §"Follow-ups" plans to migrate to `Bun.build`). Extracted module imports from the current bundled location; that location is not the migration's concern.
- Presence pill DOM ref must be on ctx by this phase.

**Substeps:** Apply Task 2's P.1–P.7 protocol.

---

## Task 12 — Phase 2q: Final cleanup — what remains in `createEditor`

**Goal:** When this task starts, `createEditor`'s body should be just the boot sequence:
1. Read `boot` config (siteId, apiBase, etc.)
2. Cache DOM refs into ctx (root, inspector, sidebar, main, viewport, chatMessages, chatWelcome, presence-pill ref, etc.)
3. Initialise empty selection / camera / undo / redo fields on ctx
4. Wire `ctx.scheduleSave`, `ctx.renderAll`, `ctx.findElement`, `ctx.selectElement`, `ctx.renderInspector`, `ctx.authFetch` to the extracted module functions
5. Kick off the async initial-state fetch (caught internally; errors surfaced through the editor status line)
6. Register event listeners (pointer / keyboard / co-edit) — all delegating to extracted modules

**Final commit:** When `canvas-client.ts:580` (`let state = null`) and the few hundred lines around it are the only inline code left, Phase 2q closes the migration: extract that boot sequence too, leaving canvas-client.ts as a thin shell that returns the same template literal (still production source-of-truth until Phase 3).

**Risk markers:**
- The async initial-state fetch's error handling is the failure-contract gate. The fetch happens inside an async IIFE inside the IIFE today; the extracted `createEditor` keeps the same shape — start the fetch with `(async () => { try { ... } catch (err) { surfaceErrorToStatusLine(ctx, err) } })()`, never `await` at the top.
- The extracted shell becomes the test pyramid's natural seam for any post-Phase-3 unit testing.

**Substeps:** Apply Task 2's P.1–P.7 protocol; the extracted module is `src/editor-client/boot.ts` (or inlined into `createEditor` itself depending on size).

---

## Out of scope (this plan)

- **Phase 3 cutover** (editor route serves the bundle, retires `canvasClientScript()`). Lands as its own ADR + plan when Phase 2q completes.
- **Post-Phase-3 decomposition** into smaller named contexts (`StateContext`, `DomContext`, `RenderContext`, `PersistContext`, `SelectionContext`). Named in ADR 0058 §Follow-ups; deferred.
- **ADR 0011 Step 5 (client renderer dispatch)** as a typed `CLIENT_RENDER_DISPATCH`. This ADR's element-render dispatch unblocks at Phase 3 cutover; it's not pre-empted by Phase 2.
- **`scripts/bundle-co-edit.ts` migration to Bun.build.** ADR 0015 §Follow-ups names this as a sibling cleanup; orthogonal to Phase 2.

---

## Self-review

**Spec coverage (ADR 0058 §Decisions ↔ Tasks):**
- Decision 1 (1:1 mirror, mutable, no hierarchy) → Task 1 lands the empty interface; every Phase 2 task respects the flat shape.
- Decision 2 (`createEditor` factory, failure contract) → Task 1 lands the stub; Task 12 lands the final boot sequence with caught initial-load errors.
- Decision 3 (plain functions taking `ctx` first param) → Task 2 (the protocol) names the function shape; every Phase 2h+ task follows.
- Decision 4 (incremental growth) → Task 1 ships the interface empty; Tasks 3–12 each add fields in their own commit.
- Decision 5 (post-Phase-3 decomposition deferred) → noted in "Out of scope" + reaffirmed in commit messages.

**Placeholder scan:** Tasks 3–12 reference "likely EditorContext fields added" as a best-guess list at plan-write time. Per ADR 0058 Decision 4 the exact set is discovered at extraction. This is not a placeholder — it's a deliberate boundary the ADR commits to. The plan does not contain TBDs, TODOs, or "implement later" markers.

**Type consistency:** `EditorContext` and `EditorBoot` are the only types this plan defines. Both are introduced in Task 1 with full source. Phase 2 tasks reference `EditorContext` consistently.

**Spec requirement coverage:** ADR 0058's "Follow-ups" enumerates 2h, 2i, 2j, 2k, 2l, 2m, 2n, 2o, 2p, 2q — Tasks 3–12 in this plan cover all 10. Per-phase parity smoke (named in ADR §Follow-ups bullet 3) is implemented as Step P.5 of the protocol and called out in each Phase 2 task.

**Atomic-commit rule:** Each task lands as its own commit with a `chore(adr-0058):` prefix. No task bundles multiple concerns (the C3 negative example from earlier today is the failure mode to avoid).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-adr-0058-editor-context-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for Task 1 (gating commit, fully scripted) and for parallelisable Phase 2 chunks once extraction discovery has bounded each one.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints. Best when the next Phase's chunk boundary is unclear and the discovery work happens in the same context as the extraction.

Which approach?
