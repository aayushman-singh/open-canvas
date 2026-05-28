# Editor Topbar Utility Buttons (Undo / Redo / Dark Preview) — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**BUTTONS.md gaps closed:** §25 (undo/redo keyboard-only), §26 (visitor dark-mode preview missing in editor)

## WHY

Two editor capabilities exist in code but cannot be reached by mouse:

1. **Undo / Redo.** The history stacks are wired (`canvas-client.ts` ~1217-1264, `UNDO_MAX = 60`) and bound to Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, but no button surfaces them. Mouse-only owners cannot recover from a misplaced drag without keyboard knowledge.
2. **Dark-mode preview.** The published renderer ships both light and dark CSS, and visitors can flip between them when `darkModeEnabled` is on (B-PUB-006). Inside the editor, the owner cannot see the dark variant of their canvas before publishing — they have to ship and visit the live site.

Both gaps are pure UI work. Backend, schema, and runtime state are already in place.

## Success Criteria

- Owner sees `↶` and `↷` buttons in the editor top header at all times.
- Clicking Undo reverts the last change exactly as Ctrl+Z does today; clicking Redo restores it exactly as Ctrl+Y does.
- Both buttons are visually `disabled` when their stack is empty — owner can tell at a glance whether there's anything to undo.
- The existing keyboard shortcuts keep working with no behaviour change.
- Owner sees a `🌙` toggle in the floating zoom toolbar. Clicking it flips the canvas content between light and dark palette in place — no publish required.
- Dark preview state survives reload of the editor tab (`sessionStorage`) but does not leak to other tabs or persist after the tab closes.
- The dark toggle is always available, independent of `site.darkModeEnabled` — owners can design a dark palette before exposing the visitor switch.
- Editor chrome (header, sidebar, inspector, zoom toolbar) stays in its native theme; only the canvas content reflects the preview.

## Non-Goals

- No undo "stack inspector" (list of recent actions).
- No labelled tooltips ("Undo: move element"). Status text already shows the action label; tooltips stay generic.
- No `localStorage` persistence of the dark preview — `sessionStorage` only.
- No syncing the dark preview to `site.darkModeEnabled` — purely client preview.
- No global dark theme for the editor chrome.
- No new schema fields, no API changes, no migration.

## Hard Constraints

- Must not regress the existing keyboard shortcuts at `canvas-client.ts` ~8539.
- Must not break the existing zoom-toolbar dispatch (`data-mode-action` handler at `canvas-client.ts:404-407`).
- Must not introduce per-mutation DOM queries on the hot path — `captureForUndo()` is called frequently.
- Must not flash light-then-dark on reload when dark preview is active in `sessionStorage`.
- Must follow the existing button styling patterns (`title` for tooltip, `aria-label`, `aria-pressed` for toggles).

---

## 1. Components and Placement

### 1.1 Undo button

- DOM: `<button id="canvas-undo" type="button" class="rev01-header-tool" aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>`
- Lives in the top header (`canvas-index.tsx:147-184`), inserted right after `{breadcrumbs}` (line 148). Reads as part of the document-action cluster, before the address bar.

### 1.2 Redo button

- DOM: `<button id="canvas-redo" type="button" class="rev01-header-tool" aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>`
- Sits immediately after Undo in the top header.

### 1.3 Dark-mode preview toggle

- DOM: `<button id="canvas-dark-toggle" type="button" data-mode-action="dark" aria-pressed="false" aria-label="Preview dark mode" title="Preview dark mode">🌙</button>`
- Built and appended inside the existing `createZoomToolbar` flow (`canvas-client.ts:365-403`), inserted after the Select/Pan mode buttons (after line 382) and before the separator (line 383). Visually part of the "interaction mode" cluster.

## 2. State and Wiring

### 2.1 History button refresh hook

- New helper `refreshHistoryButtons()` in `canvas-client.ts`, defined adjacent to `undo` / `redo` (~line 1241).
- Caches `#canvas-undo` and `#canvas-redo` references in module-level variables on first call.
- Sets `disabled` based on `undoStack.length === 0` and `redoStack.length === 0`. Only writes the property when the desired value differs from the current — no-op on most calls.
- Called from end of `captureForUndo()`, end of `undo()`, end of `redo()`, and once on editor boot after the DOM is ready.

### 2.2 Click handlers

- Single delegated click listener on `document` inside the existing editor boot block, matched by `closest('#canvas-undo')` and `closest('#canvas-redo')`. Calls `undo()` / `redo()` directly.
- The existing keyboard handler at `canvas-client.ts` ~8539 is unchanged.

### 2.3 Dark-toggle click handler

- Extend the existing `zoomToolbar.addEventListener("click", ...)` handler (`canvas-client.ts:404-407`) so the `data-mode-action` switch recognises `"dark"` in addition to `"select"` / `"pan"`.
- On click: set `data-color-mode` on `#canvas-root` to `"dark"` when toggling on, or `"light"` when toggling off (always explicitly set — never unset, so the renderer can rely on the attribute being present). Flip `aria-pressed` on the button. Write the new mode to `sessionStorage.setItem('rev01.editor.darkPreview', 'dark' | 'light')`.
- On editor boot, before first render: read `sessionStorage.getItem('rev01.editor.darkPreview')`. If `'dark'`, set `data-color-mode="dark"` on `#canvas-root` and `aria-pressed="true"` on the toggle in the same synchronous boot step so there is no flash. If absent or `'light'`, set `data-color-mode="light"` and leave `aria-pressed="false"`.

### 2.4 Accessibility

- All three buttons have `title` (mouse tooltip) and `aria-label`.
- Undo/Redo `title` includes the keyboard shortcut: `"Undo (Ctrl+Z)"`, `"Redo (Ctrl+Y)"`.
- Disabled buttons drop out of tab order naturally via the `disabled` attribute.
- Dark toggle uses `aria-pressed="true"|"false"` — the same pattern already used by Select/Pan mode buttons (`canvas-client.ts:380`), so screen readers announce mode changes consistently.

### 2.5 Styling

- New `.rev01-header-tool` class in `canvas-styles.ts` for the Undo/Redo buttons. Compact icon-only button; matches the existing header button hover state (rule near the existing `#canvas-save` / `#canvas-publish` selectors).
- Dark toggle reuses existing zoom-toolbar button styling. The `data-mode-action[aria-pressed="true"]` rule at `canvas-styles.ts:706` already handles the pressed visual.

## 3. Testing

### 3.1 New smoke: `src/editor/topbar-history.smoke.ts`

Mirrors the pattern of `inspector-smoke.ts` and `film-reel-smoke.ts`.

- Boot the editor against a fixture site.
- Assert `#canvas-undo` and `#canvas-redo` are present and `disabled` at boot.
- Mutate the canvas → assert undo enabled, redo still disabled.
- Click Undo → assert mutation reverts and redo enabled.
- Click Redo → assert mutation re-applied and undo enabled.
- Click Undo until empty → assert disabled again.
- Regression: keyboard Ctrl+Z still works on the same fixture.

### 3.2 Dark-toggle smoke (same file)

- Assert `#canvas-dark-toggle` exists with `aria-pressed="false"` at boot.
- Click → assert `#canvas-root[data-color-mode="dark"]` and `aria-pressed="true"`.
- Re-init editor → assert state persists from `sessionStorage` and no light-then-dark flash.
- Click again → assert flip back to light and `sessionStorage` updated to `'light'`.

### 3.3 Review-smoke addition

Append `#canvas-undo`, `#canvas-redo`, `#canvas-dark-toggle` to `src/review-smoke.ts` so the cross-page selector audit catches if any disappear.

### 3.4 BUTTONS.md catalogue

- Add `B-ED-TOOL-001` Undo button, `B-ED-TOOL-002` Redo button, `B-ED-VIEW-001` Dark-mode preview toggle to the editor table.
- Update `B-ED-KEY-001/002` to note that buttons now exist for the same actions.
- Move §25 and §26 out of the "no UI entry point" section into the resolved list.

## 4. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `captureForUndo()` is on the hot path; per-call DOM query would be wasteful. | Cache `#canvas-undo` / `#canvas-redo` references in module scope; helper only writes `disabled` when value differs. |
| Renderer dark CSS may have gaps if it was only tested at publish-time. | Smoke asserts the data attribute flips; visual coverage is a follow-up if owners report gaps. Out of scope here. |
| Dark toggle blurs a focused inspector field, losing unsaved input. | The inspector save-on-blur path already covers this; the existing Select/Pan buttons have the same property — not new. |
| Status text "Undo: <label>" is invisible to mouse-only owners who never read the status bar. | Out of scope. Status-text discoverability is its own catalogue item; this spec only adds buttons. |

## 5. Out-of-Scope Follow-Ups

- Audit the dark renderer for elements that don't pick up the dark palette (owner-reported only).
- Status-text discoverability improvements.
- Per-action labelled tooltips ("Undo: drag element").
- Global editor-chrome dark theme.
