# Collection Element — Add Button + Inspector — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**Codebase facts verified against:** `src/canvas/elements/collection.ts`, `src/canvas/validate.ts`, `src/canvas/yjs-projection.ts`, `src/editor/canvas-client.ts`, `src/editor/route.tsx`.

**Anchor note:** Cited line numbers may drift slightly; the durable anchors are the named symbols (`findElement`, `addComponentFromSidebar`, the inspector dispatch object). The file `route.tsx` was formerly named `canvas-index.tsx` — all references updated. `validate.ts` was refactored after this spec was first authored (extract `assertOneOf` + `validateInjectionSafeString`); re-verify the cited collection-validation region by symbol at implementation.

## WHY

Collection is the 15th element type in the canvas schema. Its renderer exists ([src/canvas/elements/collection.ts:87-107](src/canvas/elements/collection.ts#L87-L107)), validation exists, and yjs projection round-trips it. The editor has no way to create one and no inspector for one. The only way to get a Collection on a page today is direct JSON edit of `editableState` or a template seed.

Two truths surfaced while reading the code:

1. **The renderer uses `entries` and `layout` to lay out children, and emits `mode` as a `data-collection-mode` attribute on the wrapper.** It does not read `filter`, `sort`, `cardTemplate`, or `fieldBindings`. Those fields are validated by `src/canvas/validate.ts` and round-tripped by yjs-projection but no materializer code populates `entries` from page metadata. So `mode: 'page-bound'` is currently a silent no-op — picking it would let the owner save config that never renders.
2. **`findElement()` does not recurse into Collection.** Existing click-to-inspect is broken for nested children: clicking a text inside a Collection entry walks past `[data-rev01-element]`, looks up the id in the flat top-level elements list ([canvas-client.ts:1127 (`findElement`)](src/editor/canvas-client.ts#L1128-L1148)), misses, and silently hides the inspector.

This spec ships a manual-only Collection UI and fixes the click-through path. Page-bound mode and its associated config UI are explicitly deferred until a materializer exists.

## Success Criteria

- Owner sees a 15th button labelled "Collection" in the editor Add panel.
- Clicking it drops a working Collection on the canvas with default 2-column layout, 24px gap, and one seed entry containing a placeholder text element.
- The seed text inside the entry is selectable on the canvas; clicking it opens the standard text inspector, edits land, save and re-render work.
- Selecting the Collection itself shows an inspector with: Columns (number), Gap px (number), an entries list with reorder + remove, and a `+ entry` button.
- `+ entry` deep-clones the most recent entry (or `entryTemplate` if the list is empty) with fresh ids and pushes onto `entries`.
- Reorder ▴ ▾ and remove ✕ update `entries` and re-render in place.
- The standard top-level element actions (duplicate, delete, z-order, etc.) keep working on the Collection itself.
- No silent failure when an owner clicks nested children — every click either selects or is a deliberate no-op with a documented reason.

## Non-Goals

- No mode picker. `mode` defaults to `'manual'` in the factory and is shown as a read-only label.
- No page-bound mode UI: no filter, no sort, no `cardTemplate`, no `fieldBindings`.
- No `entryTemplate` visual editor — template is established by the seed factory and clone-from-most-recent.
- No nested-child drag on main canvas (entries have their own coordinate space; v1 punts).
- No entry preview thumbnail in the inspector list.
- No drag-to-reorder for entries — buttons only.
- No bulk operations across all entries.

## Hard Constraints

- Must not break existing inspectors (13-element dispatch at canvas-client.ts:4219-4231 must still resolve correctly).
- Must not break the existing flat-element click path — recursion into Collection is appended after the flat search misses.
- All cloned children must have globally-unique ids — no reuse of existing element ids.
- Schema (`src/canvas/elements/collection.ts`, `src/canvas/validate.ts`) is not modified.
- `addComponentFromSidebar` continues to share its existing factory shape — new branch is added, no existing branch changes.

---

## 1. Add Panel + Canvas Drop

### 1.1 Add panel button

Insert as the 15th button in `route.tsx` inside `<div class="rev01-sidebar-command-grid">` after the existing 14th button (around line 337):

```jsx
<button
  type="button"
  class="rev01-sidebar-command"
  data-sidebar-add-component="collection"
  title="Add a collection grid"
>
  Collection
</button>
```

The existing `[data-sidebar-add-component]` delegated listener at canvas-client.ts:8339-8344 calls `addComponentFromSidebar(component)`. No new wiring required at that layer.

### 1.2 Factory branch

Add a `'collection'` case to the switch inside `addComponentFromSidebar`:

```js
{
  type: 'collection',
  id: newElementId(),
  box: { x: 80, y: 80, w: 720, h: 360, z: nextZ() },
  mode: 'manual',
  entryTemplate: [
    { type: 'text', id: newElementId(),
      box: { x: 0, y: 0, w: 320, h: 60, z: 0 },
      content: [{ text: 'Entry title' }] }
  ],
  entries: [
    [
      { type: 'text', id: newElementId(),
        box: { x: 0, y: 0, w: 320, h: 60, z: 0 },
        content: [{ text: 'Entry title' }] }
    ]
  ],
  layout: { columns: 2, gap: 24 }
}
```

The seed entry guarantees the canvas shows a real, clickable text element immediately.

## 2. `findElement()` Recursion (Load-Bearing Fix)

### 2.1 Extended lookup

Modify `findElement(elementId)` at canvas-client.ts:1127 (`findElement`). After the existing flat search misses, walk each section's top-level elements for Collection, then walk each Collection's `entries[][]`:

```js
function searchInCollection(collectionEl, section) {
  if (collectionEl.type !== 'collection') return null;
  for (var ei = 0; ei < collectionEl.entries.length; ei++) {
    var entry = collectionEl.entries[ei];
    for (var ci = 0; ci < entry.length; ci++) {
      if (entry[ci].id === elementId) {
        return {
          section: section,
          element: entry[ci],
          collection: collectionEl,
          entryIndex: ei
        };
      }
    }
  }
  return null;
}
```

Apply across `state.header.elements`, `state.footer.elements`, and `currentPage().sections[].elements`. Returns the enriched record `{ section, element, collection?, entryIndex? }`.

### 2.2 Save path

`scheduleSave()` round-trips the whole `state` tree, so no save change is needed once `findElement` resolves to the same object reference.

`rebuildElement(element.id)` is called by inspectors after every mutation. When the found result has a `.collection` key, callers must use `found.collection.id` so the parent Collection re-renders. The shared call helper inside `renderInspector` (canvas-client.ts:4161-4169) is the one place to thread this through — child inspector builders themselves stay unchanged because they receive `element` only.

### 2.3 Selection visuals

The selection-outline writer (canvas-client.ts:5439) uses `[data-rev01-element="${selectedElementId}"]`. The renderer at [collection.ts:99](src/canvas/elements/collection.ts#L99) already emits that attribute on each Collection child, so the outline lands without further change.

## 3. Collection Inspector

### 3.1 Register the builder

Add `collection: buildCollectionInspector` to the dispatch object at canvas-client.ts:4219-4231.

### 3.2 `buildCollectionInspector(element)`

Top to bottom, the inspector renders:

#### 3.2.1 Columns

`<input type="number" min="1" max="6" step="1">` bound to `element.layout.columns`. On `change`, clamp 1–6, write, `rebuildElement(element.id)`, `scheduleSave()`, `captureForUndo()`.

#### 3.2.2 Gap (px)

`<input type="number" min="0" max="200" step="4">` bound to `element.layout.gap`. Same handler shape as columns.

#### 3.2.3 Entries list

A list host using the existing `.inspector-list-card` styling (precedent: accordion items at canvas-client.ts:3286+). One row per entry:

```
Entry 1   ▴ ▾ ✕
Entry 2   ▴ ▾ ✕
Entry 3   ▴ ▾ ✕
[ + entry ]
```

- Label is `Entry N` (1-indexed). No content preview.
- ▴ / ▾ swap with neighbour in `element.entries`.
- ✕ removes via `entries.splice(idx, 1)`.
- No content-editing affordance on the row — children are edited by direct click on the canvas.

#### 3.2.4 `+ entry` button

On click:
- If `entries.length === 0`, deep-clone `entryTemplate`.
- Otherwise deep-clone `entries[entries.length - 1]`.
- Recursively regenerate every cloned element's `id` via `regenerateIds(clone)` (new local helper that walks `CanvasElement` and any nested arrays the schema permits).
- Push to `entries`, re-render the inspector list, `rebuildElement(element.id)`, `scheduleSave()`, `captureForUndo()`.

#### 3.2.5 Mode label

A read-only `<span class="inspector-readonly">Manual</span>` for debug clarity. No picker — `page-bound` is not selectable in v1.

### 3.3 Child-element inspector — no separate work needed

When the owner clicks a Text / Image / Shape inside an entry, the existing element-type inspector builder runs. The found-via-Collection wrapper from §2.1 means the post-mutation rebuild call uses `found.collection.id`. The builder itself stays unchanged.

### 3.4 Top-level Collection actions

Duplicate, delete, z-order, reorder among section.elements all work because Collection is a top-level element in `section.elements[]`. No additional wiring.

## 4. Testing

### 4.1 New smoke `src/editor/collection.smoke.ts`

Mirrors `inspector-smoke.ts` and `film-reel-smoke.ts`.

- Boot editor; click `[data-sidebar-add-component="collection"]`.
- Assert a `collection` exists in the current section's elements with `layout.columns === 2`, `layout.gap === 24`, and exactly one entry containing one text child.
- Click the rendered text inside the entry on the canvas.
- Assert `selectedElementId` equals the child's id; the text inspector renders, not the Collection inspector.
- Edit the text content. Assert the change persists into `state.pages[i].sections[j].elements[k].entries[0][0].content`.
- Re-select the Collection wrapper.
- Click `+ entry`. Assert `entries.length === 2` and every child id in the new entry is unique vs entry 0 (no id collisions).
- Click ✕ on entry 1. Assert `entries.length === 1`.
- Change Columns 2 → 3. Assert the rendered Collection root inline style contains `grid-template-columns:repeat(3,1fr)`.
- Reorder via ▴ on entry 2 (after adding back to 2). Assert positions swap in `entries`.

### 4.2 Inspector-dispatch regression

In `src/editor/inspector-smoke.ts` (or a new entry there), assert that the dispatch table now contains a `collection` key whose value is a function. Don't pin a total count — the existing 13 entries may not be exhaustive over all schema types and counting them in a test would be brittle.

### 4.3 `findElement` recursion regression

Standalone unit-style assertion (or part of the smoke above): construct a state with a Collection containing a text child; assert `findElement(childId)` returns `{ collection, entryIndex }` keys populated. Assert it still returns the flat shape for top-level elements.

## 5. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `findElement` is called from ~20 sites in canvas-client.ts. Existing callers that destructure or compare the result shape might break when the new `collection` and `entryIndex` keys are present. | Sweep all call sites before merge. Keys are additive; readers that don't expect them ignore them. No call site is known to read by Object.keys length. |
| Nested children share x/y origin at top-left of their entry cell. Drag handlers compute world coordinates from the top-level canvas, so dragging a nested child would land at the wrong position. | v1 punts: drag is disabled for nested children. The pointer-down handler bails early when `closest('[data-collection-mode]')` is non-null. Documented as a known limitation. |
| Deep-clone via `structuredClone(entry)` plus id regeneration assumes all element fields are JSON-safe (no functions, no DOM refs). | Schema validation already ensures plain serializable shapes. Confirmed by reading `src/canvas/validate.ts`. Use `structuredClone` (modern, no JSON edge cases like `NaN`/`undefined`). |
| Owner expects to drag entries to reorder, not use buttons. | v1 ships buttons only. Drag-reorder follows the existing page-list reorder pattern; tracked as a follow-up. |
| `entryTemplate` is set once by the factory and overwritten only via JSON. Owners can't reset to a "blank entry" shape if they want to. | Acceptable for v1. The +/− entries loop covers the common case; entryTemplate-editing is its own feature. |

## 6. Out-of-Scope Follow-Ups

- Page-bound mode + filter / sort / cardTemplate / fieldBindings — blocked on a materializer that walks page metadata to populate `entries`.
- Drag of nested children on main canvas (coordinate-space translation).
- Drag-to-reorder of entries.
- Visual `entryTemplate` editor.
- Entry preview thumbnails in the inspector list.
