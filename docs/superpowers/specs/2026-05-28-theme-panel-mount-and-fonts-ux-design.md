# Theme Panel Mount + Custom Fonts UX — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**Codebase facts verified against:** `src/themes/panel.tsx`, `src/themes/route.ts`, `src/fonts/route.ts`, `src/fonts/face-emit.ts`, `src/fonts/resolve.ts`, `src/fonts/upload.ts`, `src/fonts/validate.ts`, `src/editor/canvas-index.tsx`, `src/editor/canvas-client.ts`, `src/index.ts`.

## WHY

Custom-font management is widely assumed to be missing from the dashboard. The actual gap is different: the entire ThemePanel — including a fully-wired `CustomFontsSection` with upload, list, assign-to-display/body/mono, and delete-with-confirmation — exists at `src/themes/panel.tsx` and is mounted **nowhere**. There is no import of `ThemePanel`, no sidebar tab named `theme`, no route that renders it. Owners cannot reach the panel by clicking, so they cannot manage fonts, edit the custom kit's colors, change the type-pair, or pick a surface treatment without direct API calls.

Two truths surfaced while reading the code:

1. **The fonts feature is registration-plus-application.** `@font-face` blocks emit only for fonts whose `contentHash` is referenced by a Style Kit's font tokens (`fontFamilyDisplay`, `fontFamilyBody`, `fontFamilyMono`) via the `font:<hash>` syntax. Uploading without assigning produces no visitor-visible effect. The existing CustomFontsSection already wires both halves correctly. So the missing piece is the mount, not the UI.

2. **Delete of an in-use font crashes the renderer.** `emitFontFaceBlocks` and `resolveFontFamilyValue` throw on a dangling `font:<hash>` token by design (no silent fallback). Today the panel's delete handler shows a generic confirm modal that warns vaguely; per the project's all-or-nothing failure stance, the right behavior is to refuse to delete while a kit references the hash.

3. **Filename conventions carry weight/style metadata.** Owners drop files named `Inter-Bold-Italic.woff2`. Asking them to re-type `name=Inter Bold Italic, weight=700, style=italic` after the file is already self-describing is friction with no value.

This spec mounts the existing panel as a 4th editor sidebar tab and layers two UX refinements onto the existing CustomFontsSection: smart-detect from filename, and block-delete-when-in-use.

## Success Criteria

- Editor sidebar shows a 4th tab labelled "Theme", positioned after Add / Sections / Pages.
- Clicking it activates a panel containing the full ThemePanel: colour fields, type-pair picker, surface treatment, reset + save controls, dark-variant section (when editing a custom theme), and the CustomFontsSection.
- Owner can upload, list, assign, and delete custom fonts from inside the editor with no API calls or extra navigation.
- Dropping `Inter-Bold-Italic.woff2` pre-fills the name input to `Inter Bold Italic`, weight to `700`, style to `italic`. Owner can override before clicking Upload.
- When a font's `contentHash` is referenced by any of the active kit's three font tokens, the per-row Delete button is visibly disabled with a tooltip naming the role (e.g. `Used as display — unassign first`). Clicking it is a no-op.
- Even when the Delete button reaches its handler (e.g. owner has stale list state), a server-state pre-check refuses to send DELETE if the font is still referenced.
- All existing CustomFontsSection behaviour — upload (multipart POST to `/api/sites/:id/fonts`), list (GET), assign (PUT `/custom-theme` with rewritten kit), delete (DELETE) — works unchanged.

## Non-Goals

- No Fonts UI in Site Settings. Fonts live in the theme panel where typography lives.
- No font preview ("see how this font looks").
- No reordering of fonts in the list.
- No keyboard shortcut for switching sidebar tabs.
- No persistence of which tab was last active across reloads.
- No bulk upload — single-file form per upload (matches the existing API).
- No changes to the API surface or to `src/themes/panel.tsx`'s server-rendered JSX. Edits are confined to the client script inside `CustomFontsSection` and to `canvas-index.tsx` for mount + styles.

## Hard Constraints

- The PUT `/api/sites/:siteId/custom-theme` and POST/GET/DELETE `/api/sites/:siteId/fonts` endpoints are not modified.
- `ThemePanel`'s server JSX is not modified — additive changes only.
- `THEME_PANEL_STYLES` is emitted once on the editor page and is scoped under `[data-rev01-theme-panel]`; no editor-chrome selectors are touched.
- The existing tab dispatch at `canvas-client.ts:7999-8022` handles arbitrary `data-sidebar-tab` values; no new dispatch code is added.
- The new fonts-UX logic depends on `window.__rev01Modal` (defined at `canvas-client.ts:873`), which is always loaded on the editor page.
- Smart-detect never overwrites a field the owner has already typed.

---

## 1. Mount the Theme Panel

### 1.1 New sidebar tab

In `canvas-index.tsx:187-204`, append a 4th tab button to `<div class="rev01-sidebar-tabs">`:

```jsx
<button
  type="button"
  role="tab"
  aria-selected="false"
  data-sidebar-tab="theme"
  title="Edit theme and custom fonts"
>
  Theme
</button>
```

### 1.2 New tab panel

Append a sibling panel next to the existing `add` / `sections` / `pages` panels:

```jsx
<div
  class="rev01-sidebar-panel"
  role="tabpanel"
  aria-label="Theme"
  data-sidebar-panel="theme"
  hidden
>
  <ThemePanel
    siteId={siteId}
    activeStyleKit={activeStyleKit}
    activePreset={activePreset}
  />
</div>
```

`hidden` starts collapsed; the existing tab dispatch reveals on activation.

### 1.3 State threading

`canvas-index.tsx` already receives `styleKit` as a prop. Two additions:

- `activeStyleKit: StyleKit` — direct from `state.styleKit`.
- `activePreset: StyleKitPreset` — resolved by the route handler that renders `canvas-index.tsx`:
  - When `state.styleKit === 'custom'`, use `state.customStyleKit`.
  - Otherwise, look up the preset in `BUILT_IN_STYLE_KITS` (already exported from `src/canvas/schema.ts`).

The route caller does the resolution and passes both. The exact call site is one of the `src/routes/editor/*` (or wherever `canvas-index` is rendered) — locate during implementation by tracing imports of `canvas-index`.

### 1.4 Panel styles injection

In `canvas-index.tsx`'s `<head>`, alongside existing styles, emit:

```jsx
<style>{raw(THEME_PANEL_STYLES)}</style>
```

Import from `../themes/panel.js`. Scoped under `[data-rev01-theme-panel]`; no conflict.

## 2. Smart-Detect From Filename

### 2.1 Where to hook

Modify `customFontsClientScript` inside `src/themes/panel.tsx` (around line 966). Add a `change` listener on `[data-rev01-font-file]`.

### 2.2 Parsing

```js
const WEIGHT_MAP = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  regular: 400, normal: 400, book: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
};

function parseFontFilename(filename) {
  // Strip extension
  const base = filename.replace(/\.woff2$/i, '');
  // Normalize separators: spaces and underscores become hyphens
  const tokens = base.replace(/[_ ]+/g, '-').split('-').filter(Boolean);
  // Drop leading short alphanumeric tokens that look like hashes (≤4 hex chars)
  while (tokens.length > 0 && /^[0-9a-f]{1,4}$/i.test(tokens[0])) tokens.shift();

  let weight = null;
  let style = null;
  const familyTokens = [];
  // Walk right-to-left so a weight keyword nearest the end wins;
  // family-name "BoldFont" stays in family if "-Bold" appears later.
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (weight === null && WEIGHT_MAP[lower] !== undefined) {
      weight = WEIGHT_MAP[lower];
    } else if (style === null && (lower === 'italic' || lower === 'oblique')) {
      style = 'italic';
    } else {
      familyTokens.push(tok);
    }
  }

  return {
    name: [...familyTokens, weightKeyword(weight), style].filter(Boolean).join(' '),
    weight,
    style: style ?? 'normal',
  };
}
```

`weightKeyword(weight)` returns the canonical word (`Bold` for 700, `Regular` for 400, etc.).

### 2.3 Form fill rules

On `change`:
- If `input[name="name"]` is empty, set it to `parsed.name`.
- If `input[name="weight"]` is empty or equals the default `"400"` placeholder text, set it to `parsed.weight` when not null.
- If `select[name="style"]` is at default `normal`, set it to `parsed.style`.
- Never overwrite a non-default value. The `family` dropdown (sans-serif / serif / mono / display) is **not** touched — owners pick that themselves because the filename rarely encodes it reliably.

### 2.4 Edge cases

- Empty filename or only hash-tokens → no-op.
- No recognizable weight → leave weight field at default.
- Multiple weight tokens → first found (right-to-left) wins.
- Files lacking a `.woff2` extension still trigger the parser; the upload itself will fail server-side validation if not WOFF2 (`assertValidWoff2`).

## 3. Block Delete When In Use

### 3.1 Compute usage at list-render time

In `customFontsClientScript`, when rendering each font row:

- Read the active kit's font tokens (passed in via the script payload as `state.activeFontTokens = { display, body, mono }`).
- For each token, if it equals `'font:' + font.contentHash`, mark the row as in use for that role.
- If any role matches, the per-row Delete button:
  - Has the `disabled` attribute set.
  - Has `title="Used as ${roles.join(', ')} — unassign first in the theme panel"`.
  - Has a `data-rev01-font-used-as` attribute for test introspection.

### 3.2 Serialize the kit tokens into the script payload

The script payload (`STATE` at the top of `customFontsClientScript`) is built from server state at render time. Add three string fields:

```ts
const payload = {
  siteId,
  editing,
  activeFontTokens: {
    display: activePreset.fontFamilyDisplay,
    body: activePreset.fontFamilyBody,
    mono: activePreset.fontFamilyMono,
  },
};
```

Currently `CustomFontsSection` accepts only `{ siteId, editing }`. Widen to `{ siteId, editing, activeFontTokens }` where `activeFontTokens: FontTokenTriple` (re-export the type from `src/fonts/resolve.ts`). The parent `ThemePanel` reads the triple off `props.activePreset` and passes it down. Only the section's `customFontsClientScript` consumes the new prop — the JSX above it is unchanged.

### 3.3 Server-state pre-check (defense in depth)

The list-render check uses the kit as known at editor mount. If the owner changed kits since (in another tab, or via the same panel) the list may be stale. So in the delete handler — before showing the modal:

```js
// Re-fetch current state; refuse if the font is still referenced.
const stateResp = await fetch('/api/sites/' + encodeURIComponent(siteId), { headers: { accept: 'application/json' } });
if (!stateResp.ok) { setStatus('Could not verify usage before delete.'); return; }
const liveTokens = pickActiveTokens(await stateResp.json());
const roles = checkUsage(liveTokens, deletingFontHash);
if (roles.length > 0) {
  setStatus('Cannot delete: in use as ' + roles.join(', ') + '. Unassign first.');
  return;
}
// existing __rev01Modal.confirm + DELETE flow continues unchanged
```

`pickActiveTokens(stateBody)` returns the three tokens off `customStyleKit` if `styleKit === 'custom'`, otherwise off the built-in kit. Built-in kits use literal CSS chains (no `font:` prefix) so they never match an uploaded font hash — but we check defensively so the rule generalizes if a future built-in uses an uploaded font.

### 3.4 Modal message

When delete proceeds, the existing modal message stays. Owners only see it for fonts that are genuinely unreferenced.

## 4. Testing

### 4.1 New smoke `src/themes/panel-mount.smoke.ts`

- Boot editor for a fixture site.
- Assert `[data-sidebar-tab="theme"]` exists with `aria-selected="false"`.
- Click it. Assert it gains `aria-selected="true"` and `[data-sidebar-panel="theme"]` becomes visible.
- Assert `[data-rev01-theme-panel]` is present inside.
- Assert `[data-rev01-custom-fonts]` is present inside the panel.

### 4.2 New smoke `src/themes/custom-fonts-ux.smoke.ts`

- **Smart-detect.** Construct a `File` named `Inter-Bold-Italic.woff2`. Fire `change` on `[data-rev01-font-file]`. Assert `[data-rev01-font-name]` becomes `Inter Bold Italic`, `[data-rev01-font-weight]` becomes `700`, `[data-rev01-font-style]` becomes `italic`.
- **Smart-detect skip when filled.** Pre-fill name to `My Custom`. Fire `change` with same file. Assert name stays `My Custom`.
- **Smart-detect hash prefix.** Use filename `abcd-Inter-Regular.woff2`. Assert family parsing drops `abcd` and name becomes `Inter Regular`.
- **Block delete when in use.** Upload a WOFF2 fixture; assign as display via the existing assign button. Reload the list. Find the row; assert its `[data-rev01-font-delete]` button is `disabled` and `title` contains `display`.
- **Defense-in-depth.** Stub the page state so the list shows the Delete button enabled but the live `/api/sites/:siteId` response still references the hash. Click Delete. Assert no DELETE request is sent and the status text mentions the role.
- **Unassign then delete.** Reset the kit's display token to a literal chain. Reload list. Assert Delete is enabled. Click → confirm modal shows → confirm → DELETE fires → row removed.

### 4.3 Regression checks

- Existing `src/themes/smoke.ts` and `src/fonts/smoke.ts` continue to pass unchanged. No API changes mean no contract drift.
- Existing tab dispatch handles a 4th tab — assert switching from Theme back to Add still hides the theme panel.

## 5. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Widening `CustomFontsSection` props to include `activeFontTokens` ripples into the parent and any test that constructs the section in isolation. | The parent (`ThemePanel`) already has `activePreset` in scope; pass the triple down. Existing tests instantiate `ThemePanel`, not the section directly, so the change is one new prop on one call site. If any test constructs the section directly, it must be updated to pass tokens — no silent fallback. |
| The defense-in-depth fetch on every delete click adds latency before the confirm modal appears. | One small GET; the panel already runs a GET on assign (line 1078). Latency on a single Delete click is acceptable. |
| Smart-detect filename parsing yields a weird name on legitimate-but-unusual filenames (e.g. `BoldFontFamily-Light.woff2` → `BoldFontFamily Light`). | Acceptable. Smart-detect is best-effort; owner reviews the form before clicking Upload and can edit any field. |
| `THEME_PANEL_STYLES` includes selectors like `[data-rev01-theme-panel] button` which set `background: var(--accent, …)`. Inside the editor the `--accent` CSS variable may not be defined and the fallback colour may clash with editor chrome. | The panel's CSS uses concrete fallbacks; the editor chrome doesn't define `--accent` because it doesn't need it. Confirmed visually during implementation. If needed, set `--accent` on `[data-rev01-theme-panel]` to a known editor-chrome accent. |
| Built-in kits may at some future point reference uploaded fonts via `font:<hash>` (the schema permits it). | `checkUsage` already treats built-in kits identically — it parses the token and matches by hash regardless of whether the kit is built-in or custom. |
| Owner has multiple tabs open editing the same site. Tab A unassigns a font; tab B's list still shows it as in-use. | Defense-in-depth fetch (3.3) re-reads server state, so even tab B's outdated list cannot mis-delete. The disabled-state visual is best-effort. |

## 6. Out-of-Scope Follow-Ups

- Font preview in the list ("see how Inter Bold renders" mini-preview).
- Reordering of fonts.
- Bulk multi-file upload.
- A separate Fonts manager in Site Settings.
- Theme panel mount on a `/dashboard/sites/:id/theme` page (so owners can edit theme without entering the editor). The editor sidebar mount covers the primary use case.
- Smart-detect for the `family` classification dropdown.
- Versioning + history of theme edits (the timeline already covers snapshots; theme deltas ride with state).
