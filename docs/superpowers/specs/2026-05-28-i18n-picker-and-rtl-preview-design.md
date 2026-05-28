# i18n Locale Picker + RTL Preview — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**Codebase facts verified against:** `src/i18n/rtl-rules.ts`, `src/i18n/mirror.ts`, `src/i18n/render-hook.ts`, `src/i18n/locale-resolve.ts`, `src/canvas/schema.ts`, `src/seo/meta-emit.ts`, `src/routes/public.ts`, `src/routes/dashboard/page-settings.tsx`, `src/routes/dashboard/site-settings.tsx`, `src/routes/api/canvas.ts`, `src/editor/canvas-client.ts`.

**Anchor note:** Cited line numbers in `canvas-client.ts` may drift; durable anchors are `createZoomToolbar`, the `data-mode-action` dispatch, and the `page.scrollTriggerMode` picker inside `renderPageInspector`. `meta-emit.ts` and `render-hook.ts` have shifted slightly since first author; re-locate `resolveLang` and `prepareRender` by name. PATCH route surface in `src/routes/api/canvas.ts` was moved into `ownerApi` sub-app by commit 5666057 — verify route mount at implementation.

## WHY

Three gaps interlock:

1. **No UI for `state.defaultLocale`.** The schema field exists, the renderer respects it (`meta-emit.ts:95` fallback chain `page.locale → snapshot.defaultLocale → 'en'`), but nothing in the dashboard sets it. Owners cannot specify their site's primary language.

2. **Per-page locale is freeform text.** The SEO panel at `page-settings.tsx:1170-1178` ships an `<input type="text">` for the BCP-47 tag. There is no autocomplete, no RTL hint, and no defense against typos like `english` or `EN_US`. The four RTL languages the renderer actually understands are hard-coded in `src/i18n/rtl-rules.ts:24` (`ar`, `fa`, `he`, `ur`), explicitly exported "for fixtures and the editor locale picker" — a picker was anticipated.

3. **Editor canvas does not run `applyRtlMirror`.** The public renderer mirrors element x-coordinates and sets `<html dir="rtl">` for RTL pages (`render-hook.ts:58` → `mirror.ts:94`). The editor canvas renders in raw LTR coordinate space regardless of `page.locale`. An owner authoring an Arabic page sees LTR while editing; the layout silently flips on publish.

Auto-translation is **out of scope** per project decision (no Gemini wiring exists; FEATURES.md §34 is aspirational). This spec covers picking a locale and previewing RTL — the two halves of i18n the renderer actually supports.

## Success Criteria

- Owner sees a "Default language" card in Site Settings with a dropdown of curated locales plus an "Other (BCP-47)…" escape hatch. Selecting an RTL locale shows `· RTL` in the option label.
- Site default persists to `state.defaultLocale`; renderer's existing fallback chain picks it up.
- Owner sees the same dropdown shape in the page SEO panel, replacing the existing freeform input. A `— site default —` choice clears the per-page override.
- Owner sees a `⇆` toggle in the editor floating zoom toolbar, next to the dark-mode preview (sub-project A).
- Clicking it flips the canvas to mirrored-x layout with `direction: rtl` on the canvas root — what the owner sees matches what publish would render for an RTL locale.
- RTL preview is read-only: pointer events on canvas elements are blocked; sidebar is dimmed; the inspector shows an "RTL preview is on — exit to edit" banner with an Exit button.
- Preview state is independent of `page.locale` — owners can always check what an LTR page would look like in RTL or vice versa.
- Preview state survives reload via `sessionStorage` and does not persist to other tabs or after the tab closes.
- All three controls share one source-of-truth locale list at `src/i18n/picker-locales.ts`.

## Non-Goals

- No auto-translation feature, no "Translate this page" button.
- No registry-level BCP-47 validation; syntax check only.
- No per-locale text-content fork — locale changes affect metadata and `dir`, not element content.
- No editable RTL preview — read-only by design.
- No autocomplete / search in the dropdowns — curated list is small.
- No mirroring of nested Collection children — see Risks; v1 limitation.
- No region detection ("which locale is this visitor reading from"); the renderer already handles that.

## Hard Constraints

- The renderer's locale path is not modified (`prepareRender`, `applyRtlMirror`, `<html lang dir>` emission stay as they are).
- `state.defaultLocale` and `page.locale` schema fields are not modified.
- The SEO POST handler continues to receive a single `locale` field — picker UI splices custom into that field before submit.
- BCP-47 syntax validation on the server uses `/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`. Empty string clears the field.
- RTL preview never writes to state — toggle state is `sessionStorage` only.
- Editor state stays in LTR coordinate space; mirror only applies at render.

---

## 1. Shared Locale Picker Module

### 1.1 New file `src/i18n/picker-locales.ts`

```ts
import { RTL_LOCALES } from './rtl-rules.js';

export interface LocaleChoice {
  tag: string;       // BCP-47, e.g. 'en-GB'
  label: string;     // human-readable, e.g. 'English (United Kingdom)'
  direction: 'ltr' | 'rtl';
}

export const CURATED_LOCALES: ReadonlyArray<LocaleChoice> = [
  { tag: 'en',    label: 'English',                    direction: 'ltr' },
  { tag: 'en-US', label: 'English (United States)',    direction: 'ltr' },
  { tag: 'en-GB', label: 'English (United Kingdom)',   direction: 'ltr' },
  { tag: 'es',    label: 'Spanish',                    direction: 'ltr' },
  { tag: 'es-MX', label: 'Spanish (Mexico)',           direction: 'ltr' },
  { tag: 'fr',    label: 'French',                     direction: 'ltr' },
  { tag: 'de',    label: 'German',                     direction: 'ltr' },
  { tag: 'it',    label: 'Italian',                    direction: 'ltr' },
  { tag: 'pt',    label: 'Portuguese',                 direction: 'ltr' },
  { tag: 'pt-BR', label: 'Portuguese (Brazil)',        direction: 'ltr' },
  { tag: 'nl',    label: 'Dutch',                      direction: 'ltr' },
  { tag: 'pl',    label: 'Polish',                     direction: 'ltr' },
  { tag: 'ru',    label: 'Russian',                    direction: 'ltr' },
  { tag: 'ja',    label: 'Japanese',                   direction: 'ltr' },
  { tag: 'ko',    label: 'Korean',                     direction: 'ltr' },
  { tag: 'zh-CN', label: 'Chinese (Simplified)',       direction: 'ltr' },
  { tag: 'zh-TW', label: 'Chinese (Traditional)',      direction: 'ltr' },
  { tag: 'vi',    label: 'Vietnamese',                 direction: 'ltr' },
  { tag: 'th',    label: 'Thai',                       direction: 'ltr' },
  { tag: 'tr',    label: 'Turkish',                    direction: 'ltr' },
  { tag: 'hi',    label: 'Hindi',                      direction: 'ltr' },
  // RTL group — matches RTL_LOCALES exactly
  { tag: 'ar',    label: 'Arabic',                     direction: 'rtl' },
  { tag: 'fa',    label: 'Persian',                    direction: 'rtl' },
  { tag: 'he',    label: 'Hebrew',                     direction: 'rtl' },
  { tag: 'ur',    label: 'Urdu',                       direction: 'rtl' },
];

export const OTHER_VALUE = '__other__';

export const BCP47_SYNTAX = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
```

Assertion at module load (in a smoke): every `direction: 'rtl'` entry in `CURATED_LOCALES` appears in `RTL_LOCALES`, and every `RTL_LOCALES` entry appears in `CURATED_LOCALES`. Prevents drift between the curated list and the renderer's RTL truth.

### 1.2 New helper `LocalePickerField`

A shared JSX helper (in the same module) that renders the select + the conditional custom-input field. Used by both Site Settings (D2) and Page Settings (D4) to keep DOM identical.

```tsx
export function LocalePickerField(props: {
  fieldName: string;          // 'defaultLocale' | 'locale'
  current: string | undefined;
  includeSiteDefaultOption?: boolean;  // true for per-page picker
}) {
  // ... renders the select with curated options, the "Other" option,
  //     and a hidden-by-default custom text input
}
```

## 2. Site Default Locale in Site Settings

### 2.1 New Card section

In `site-settings.tsx`, insert after the Hosting card (line ~1056) and before Password protection:

```jsx
<Card id="default-locale">
  <h2>Default language</h2>
  <p class="muted">
    Used when a page doesn't override its own locale. Affects
    <code>&lt;html lang&gt;</code>, hreflang in the sitemap, and RTL routing.
  </p>
  <LocalePickerField
    fieldName="defaultLocale"
    current={state.editableState.defaultLocale}
  />
</Card>
```

### 2.2 PATCH wiring

Extend the queued PATCH handler at `canvas.ts:260-314`:

- Accept `defaultLocale` as an optional key on the PATCH body.
- Validate: empty string clears the field; otherwise must match `BCP47_SYNTAX`. Reject with 400 and an error message on syntax failure.
- Persist into `editableState.defaultLocale`.

Client wiring uses the existing `queueConfigPatch` pattern (site-settings.tsx:925-973). The picker's change handler emits `{ defaultLocale: tag }` (or empty string for clear). When the dropdown is `__other__`, a `change` listener on the custom input emits the same key with the typed value.

## 3. Per-page Locale Picker

### 3.1 Replace input at `page-settings.tsx:1170-1178`

```jsx
<LocalePickerField
  fieldName="locale"
  current={localeVal}
  includeSiteDefaultOption={true}
/>
```

The "— site default —" option corresponds to `<option value="">`. Selecting it submits an empty string, which the existing handler treats as "clear override."

### 3.2 Submit splice

The SEO form is `method="post"` to the existing route. Before submit:

- If the select is `__other__`, copy the custom input's value into a hidden `locale` field.
- Otherwise the select's value is already `locale`.

Server handler unchanged; receives a single `locale` field per submit.

### 3.3 RTL hint

When the picker resolves to an RTL locale (curated or custom matching `RTL_LOCALES`), display a small inline note below the field:

> RTL — text and layout flow right-to-left. Use the editor's RTL preview toggle to see the result.

Computed on render and re-computed on change.

## 4. RTL Preview Toggle in the Editor

### 4.1 New zoom-toolbar mode button

Extend the toolbar in `canvas-client.ts:365-403`. Insert after the Pan mode button. If sub-project A has shipped the dark-mode toggle first, the RTL toggle sits after dark; otherwise it sits immediately after Pan. Order between Dark and RTL is not load-bearing.

```js
{
  label: "⇆",
  title: "Preview RTL (Right-to-Left)",
  ariaLabel: "Preview RTL layout",
  action: "rtl"
}
```

The existing `data-mode-action` switch (lines 402-411) gains an `rtl` case.

### 4.2 Apply mirror on render

A new module-level boolean `rtlPreviewOn` and a derived `getRenderSnapshot()` helper:

```js
let rtlPreviewOn = false;
function getRenderSnapshot() {
  if (!rtlPreviewOn) return state;
  return applyRtlMirror(state);  // imported from src/i18n/mirror.ts
}
```

The main render loop reads from `getRenderSnapshot()` instead of `state` directly. On toggle change, re-render. Memoize the mirrored snapshot keyed by a small mutation counter that increments on every `captureForUndo` / direct `state` write so we don't deep-clone on every render call.

**Input-shape check**: `applyRtlMirror` is currently called by `prepareRender` against a published snapshot (`mirror.ts:94`). The editor's `state` may have a slightly different shape — implementation must verify the call site accepts editor state directly. If not, either widen `applyRtlMirror` to accept the editor's shape, or extract the page-walking logic into a snapshot-shape-agnostic helper. Schema-change-free either way.

`#canvas-root` gets `data-rtl-preview="on"` and inline `style="direction: rtl"`. On toggle off, both are removed.

### 4.3 Read-only enforcement

When `rtlPreviewOn === true`:

- CSS rule emitted in `canvas-styles.ts`:
  ```css
  [data-rtl-preview="on"] [data-rev01-element],
  [data-rtl-preview="on"] [data-rev01-section],
  [data-rtl-preview="on"] .rev01-editor-sidebar {
    pointer-events: none;
  }
  [data-rtl-preview="on"] .rev01-editor-sidebar {
    opacity: 0.5;
  }
  ```
- Selection is cleared (`selectedElementId = null; selectedSectionId = null;`).
- The inspector renders a special banner mode: `RTL preview is on — exit to edit` with a single `Exit RTL preview` button that flips the toggle off.
- Keyboard mutation shortcuts (delete element, duplicate, undo, redo, paste) check `rtlPreviewOn` first and, when on, show status text `Exit RTL preview to edit` instead of running.
- Save and Publish stay enabled — they operate on the unmirrored canonical `state`, so they do the right thing whether preview is on or off.

### 4.4 Persistence

`sessionStorage.setItem('rev01.editor.rtlPreview', 'rtl' | 'ltr')`. On editor boot, read the value before first render to avoid an LTR → RTL flash.

### 4.5 Status text

Below the canvas (existing status bar in the editor): `RTL preview` chip appears next to the existing dark-mode chip (if added by sub-project A) whenever preview is on.

## 5. Testing

### 5.1 Curated list integrity smoke `src/i18n/picker-locales.smoke.ts`

- Assert every `direction: 'rtl'` entry in `CURATED_LOCALES` has its `tag` listed in `RTL_LOCALES`.
- Assert every `RTL_LOCALES` entry has a matching `CURATED_LOCALES` entry with `direction: 'rtl'`.
- Assert no two entries share the same `tag`.

### 5.2 Site Settings smoke `src/routes/dashboard/site-settings-locale.smoke.ts`

- Boot site-settings. Assert the new default-locale card renders with all curated options + Other.
- Select `ar`. Assert PATCH fires with `{ defaultLocale: 'ar' }`. Reload. Assert `ar` is selected and the `· RTL` suffix is in the option label.
- Select Other, type `ca-ES`, blur. Assert PATCH fires with `{ defaultLocale: 'ca-ES' }`. Reload. Assert Other is selected and custom input shows `ca-ES`.
- Type `english` in custom. Assert PATCH returns 400 and surfaces error to UI.
- Select the empty default option. Assert PATCH clears the field.

### 5.3 SEO panel smoke (extend or add)

- Same picker behavior as 5.2 but per-page.
- "— site default —" sends empty string; reload shows that option selected.
- Selecting `ar` shows the RTL hint below the field.

### 5.4 RTL preview smoke `src/editor/rtl-preview.smoke.ts`

- Boot editor with a fixture page containing two elements at known x-coords (e.g. 100 and 600) in a 1200-wide canvas.
- Click the RTL toggle. Assert `#canvas-root` has `data-rtl-preview="on"` and inline `direction: rtl`.
- Assert the two elements are rendered at mirrored positions: `1200 - x - w`.
- Try `click` on an element. Assert `selectedElementId === null` (pointer-events blocked).
- Assert inspector shows the banner with the Exit button.
- Click Exit. Assert canvas reverts to LTR and click selects normally.
- Try pressing `Delete` while preview is on. Assert nothing is deleted; status shows the exit message.
- Reload. Assert sessionStorage persisted the state and there is no LTR → RTL flash.

## 6. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Calling `applyRtlMirror` on every render is allocation-heavy (deep clone of the whole snapshot). | Memoize on a small mutation counter; recompute only when `state` advances. |
| Editor code paths that read coords from the DOM (drag start, snap-guides) would see mirrored coords when preview is on. | Read-only enforcement (§4.3) blocks all such paths while preview is on. Document the dependency next to the toggle handler so future drag-handler refactors don't accidentally re-enable. |
| `applyRtlMirror` mirrors only `page.sections[].elements[].box`. Collection's nested entries (sub-project B) have boxes relative to the entry cell, not the canvas. | Top-level Collection box mirrors; nested children stay un-mirrored. Documented limitation. Follow-up: extend `mirror.ts` to recurse into Collections once the editor edits them. |
| `state.defaultLocale` schema field already exists (`EditableSite.defaultLocale?: string` at schema.ts:400). PATCH route must add it without breaking existing PATCHes. | Additive optional key on the PATCH body; the existing handler ignores unknown keys today, so old clients keep working. |
| Owner types a non-BCP-47 string in the custom input (e.g. `english`). | Server returns 400 with the failing regex named. Client surfaces the error inline next to the input. No silent fallback to `'en'`. |
| Curated list drifts from `RTL_LOCALES`. | Smoke 5.1 asserts bi-directional coverage. |
| Read-only banner reuses the inspector area, which already has many render modes (element selected / section selected / page settings / film-reel open). Adding RTL preview mode increases conditional branches. | Place the RTL check at the top of `renderInspector` so it short-circuits before other branches. Documented in code comment. |
| RTL preview + dark preview both on at once: visual interaction unclear. | Both are CSS-and-attribute toggles; they compose. Smoke verifies both can be on simultaneously and both off after toggles fire. |

## 7. Out-of-Scope Follow-Ups

- Auto-translation. Project decision; tracked in memory.
- Per-locale element content variants.
- Nested-Collection RTL mirroring.
- Editable RTL preview.
- BCP-47 registry validation beyond syntax.
- `<select>` with type-ahead / search.
- Region detection on visit (renderer already handles).
