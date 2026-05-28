# Section Inspector Additions — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**Codebase facts verified against:** `src/canvas/schema.ts`, `src/canvas/render.ts`, `src/editor/canvas-client.ts`, `src/interactive/popup.ts`, `src/interactive/inject.ts`.

**Anchor note:** Cited line numbers in `canvas-client.ts` may drift slightly; durable anchors: `renderSectionInspector`, `isPinnedSection`, `replayAnimations`, `buildCarouselInspector` (asset-picker pattern reference), `field`, `selectInput`. Schema and renderer citations in `schema.ts` (lines 80 / 149 / 331 / 334) and `render.ts:202-227` are still valid as of this revision.

## WHY

`renderSectionInspector` at [canvas-client.ts:3834 (`renderSectionInspector`)](src/editor/canvas-client.ts#L3811-L3871) currently exposes only section name and five action buttons (Duplicate / Move up / Move down / Save to library / Delete) plus Generate-with-AI. The schema's `CanvasSection` interface ([schema.ts:334-345](src/canvas/schema.ts#L334-L345)) defines five additional fields that the public renderer actively consumes — but no editor UI sets them:

1. **`role` (`'header' | 'footer' | 'body'`)** — read at [render.ts:220](src/canvas/render.ts#L220) into `data-section-role` and at [canvas-client.ts:2145 (`isPinnedSection`)](src/editor/canvas-client.ts#L2140-L2154) into `isPinnedSection`. Today the only thing that sets it is template seeds or AI generation; owners cannot toggle.

2. **`backgroundEffect` (`BackgroundEffect` enum)** — read at [render.ts:204, 227](src/canvas/render.ts#L204) into `data-bg-effect` for CSS hooks. Six values (`none / grain / grid / soft-light / paper / glass`).

3. **`entrance` (`MotionPreset` enum)** — read at [render.ts:205, 227](src/canvas/render.ts#L205) into `data-entrance` for motion CSS. Seventeen presets.

4. **`trigger` (`{ type: 'exit-intent' | 'delay' | 'scroll'; value?: number }`)** — read at [render.ts:211-223](src/canvas/render.ts#L211-L223) where setting any trigger flips the section to `display: none` and emits `data-rev01-popup="true"`. Runtime behavior is wired in [src/interactive/popup.ts](src/interactive/popup.ts). The popup feature is fully working end-to-end except no owner can author one without direct JSON edit.

5. **`backgroundVideoAssetId` (string)** — read at [render.ts:224-226](src/canvas/render.ts#L224-L226) to emit an absolute-positioned `<video autoplay loop muted playsinline>` that plays the asset behind the section.

All five fields are consumed by the public renderer today. Multi-phrased greps in `canvas-client.ts` confirm zero existing inspector UI for any of them; the only references are DOM-attribute emission at render time (lines 2193-2195) and isPinnedSection gating across nine sites.

This spec adds picker UI for each of the five fields, with conflict prevention for role and a discoverable Popup subsection for trigger.

## Success Criteria

- Owner selects a section. The inspector renders:
  - **Section** heading + name (existing).
  - **Role** picker: dropdown of `body / header / footer`. When another section on the same page already holds `header` or `footer`, that option is `disabled` with an inline hint naming the conflicting section.
  - **Background effect** picker: dropdown of the six `BACKGROUND_EFFECTS`.
  - **Entrance animation** picker: dropdown of the seventeen `MOTION_PRESETS` + a `▶ Replay` button.
  - **Background video** asset picker with thumb, Upload / Replace, Remove.
  - **Popup behavior** collapsible subsection: trigger-type select + conditional value input.
  - The existing five action buttons + AI Generate at the bottom, unchanged.
- Changing any field mutates state, persists via `scheduleSave()`, captures undo via `captureForUndo()`, and updates the section's rendered DOM in place (or the page if a full re-render is required).
- Setting `role: 'header'` while another section on the same page is already `header` is impossible from the UI.
- Sections with `section.trigger` set show a dashed outline and a "Popup" pill in the editor canvas so the owner can see at-a-glance which sections are popups, even though they render hidden at publish.
- All five fields persist across reload (refetch state).

## Non-Goals

- No CSS-effect preview thumbnails. Dropdown is text-only.
- No MotionPreset categorization or grouping into sub-menus.
- No video-asset library browser separate from the upload flow.
- No "Preview popup" button that simulates the trigger in-editor.
- No bulk-apply effect across all sections of a page.
- No history of who-set-what role.
- No schema changes.

## Hard Constraints

- The public renderer is not modified. All visible behavior flows through the existing `data-*` attributes and the existing `[src/interactive/popup.ts](src/interactive/popup.ts)` runtime.
- `MOTION_PRESETS`, `BACKGROUND_EFFECTS`, `SECTION_ROLES` are read from `src/canvas/schema.ts`; the inspector does not hard-code the lists.
- Field mutations call `captureForUndo()` so sub-project A's undo button reverts them.
- Role-conflict prevention is purely client-side; the server validator already accepts any single section having any role. The UI is the source of truth for "one header per page."
- Existing inspector action buttons (Duplicate / Move / Save / Delete / AI) keep their relative order at the bottom of the inspector.

---

## 1. Inspector Layout

`renderSectionInspector` is restructured into three logical groups, in this order:

1. **Role & structure** — section name (existing meta line), role picker.
2. **Visual** — background effect, entrance animation + replay, background video.
3. **Popup behavior** — collapsible `<details>` subsection containing the trigger composite.

Action buttons (Duplicate / Move up / Move down / Save to library / Delete / Generate with AI) stay at the bottom.

The existing `rev01-section-inspector-grid` class continues to wrap the action buttons. The new fields use the `field(label, input)` helper at [canvas-client.ts:2340 (`field`)](src/editor/canvas-client.ts#L2335-L2343) (the same one used by element inspectors) so the styling is consistent.

## 2. Role Picker With Conflict Prevention

### 2.1 Picker DOM

```js
var roleSel = selectInput(SECTION_ROLES.slice(), section.role || "body");
roleSel.dataset.section = section.id;
```

Source `SECTION_ROLES` from schema.ts to avoid drift.

### 2.2 Conflict scan

Before rendering the dropdown:

```js
function findRoleHolder(page, role, excludeSectionId) {
  for (var i = 0; i < page.sections.length; i++) {
    var s = page.sections[i];
    if (s.id !== excludeSectionId && s.role === role) return s;
  }
  return null;
}
```

For each of `header` and `footer`:
- If `findRoleHolder(currentPage(), role, section.id)` returns a section, that option in the dropdown gets `disabled = true`.
- A single inline hint line under the dropdown enumerates the conflicts: e.g. `"Header" used by "Top nav", "Footer" used by "Site footer".`

### 2.3 Change handler

```js
roleSel.addEventListener("change", function() {
  var v = roleSel.value;
  if (v === "body") delete section.role;
  else section.role = v;
  rebuildPage();  // pinning changes affect page layout
  renderInspector();  // action-button set differs for pinned sections
  scheduleSave();
  captureForUndo();
});
```

`rebuildPage()` is the existing page-level re-render path. If a more granular `rebuildSection(id)` exists in the codebase, prefer it; otherwise fall back to full page re-render. Implementation step verifies which exists.

### 2.4 Header / footer demotion shortcut in conflict hint

When a header or footer slot is already occupied, the inline hint includes a small `Demote "{otherSectionName}" to body` button. Clicking it sets the *other* section's role to body, then refreshes the current inspector. Keeps the owner from having to navigate away to resolve the conflict.

## 3. Background Effect Picker

### 3.1 DOM

```js
var bgEffectSel = selectInput(BACKGROUND_EFFECTS.slice(), section.backgroundEffect || "none");
```

`BACKGROUND_EFFECTS` from schema.ts:149-156.

### 3.2 Change handler

```js
bgEffectSel.addEventListener("change", function() {
  var v = bgEffectSel.value;
  if (v === "none") delete section.backgroundEffect;
  else section.backgroundEffect = v;
  rebuildSectionOrPage(section.id);
  scheduleSave();
  captureForUndo();
});
```

No conflicts to check.

## 4. Entrance Animation Picker + Replay

### 4.1 DOM

```js
var entranceSel = selectInput(MOTION_PRESETS.slice(), section.entrance || "none");
var replayBtn = document.createElement("button");
replayBtn.type = "button";
replayBtn.textContent = "▶ Replay";
replayBtn.title = "Replay this section's entrance animation";
```

`MOTION_PRESETS` from schema.ts:80-98.

### 4.2 Change handler

Same shape as background effect: delete for `"none"`, set otherwise, rebuild, save, capture undo.

### 4.3 Replay handler

Extend the existing `replayAnimations(scope)` at [canvas-client.ts:3897 (`replayAnimations`)](src/editor/canvas-client.ts#L3874-L3895) to accept a section id. New branch:

```js
} else {
  // try element id first (existing behavior)
  var el = root.querySelector('[data-rev01-element="' + cssEscape(scope) + '"]');
  if (el) {
    targets = [el];
  } else {
    // new: try section id
    var sec = root.querySelector('[data-rev01-section="' + cssEscape(scope) + '"]');
    targets = sec ? [sec] : [];
  }
}
```

`replayBtn` click handler calls `replayAnimations(section.id)`.

## 5. Background Video Asset Picker

### 5.1 DOM

Mirrors carousel slide upload at [canvas-client.ts:3406 (`buildCarouselInspector` — asset picker pattern)](src/editor/canvas-client.ts#L3397-L3426):

```js
var thumbWrap = document.createElement("div");
var thumb = buildPickerThumb(section.backgroundVideoAssetId, section.backgroundVideoAssetId, function() {
  // future: open asset picker modal scoped to videos
});
thumbWrap.appendChild(thumb);

var fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "video/mp4,video/webm";
fileInput.style.display = "none";

var uploadBtn = document.createElement("button");
uploadBtn.type = "button";
uploadBtn.textContent = section.backgroundVideoAssetId ? "Replace video" : "Upload video";

var clearBtn = document.createElement("button");
clearBtn.type = "button";
clearBtn.textContent = "Remove video";
// shown only when section.backgroundVideoAssetId is set
```

### 5.2 Upload flow

```js
uploadBtn.addEventListener("click", function() { fileInput.value = ""; fileInput.click(); });
fileInput.addEventListener("change", function() {
  var file = fileInput.files && fileInput.files[0];
  if (!file) return;
  setStatus("Uploading video...");
  postAssetUpload(file, "", section.id).then(function(result) {
    section.backgroundVideoAssetId = result.assetId;
    rebuildSectionOrPage(section.id);
    scheduleSave();
    captureForUndo();
    setStatus("Uploaded", "ok");
    renderInspector();
  }).catch(function(err) {
    setStatus("Upload failed: " + (err && err.message ? err.message : String(err)), "error");
  });
});
```

### 5.3 Clear flow

```js
clearBtn.addEventListener("click", function() {
  delete section.backgroundVideoAssetId;
  rebuildSectionOrPage(section.id);
  scheduleSave();
  captureForUndo();
  renderInspector();
});
```

### 5.4 MIME handling

The `accept` attribute filters at the OS-level picker. Server-side validation in the asset upload endpoint is the authoritative check; failures surface via `setStatus`.

## 6. Popup Behavior Subsection

### 6.1 Collapsible block

```jsx
<details data-popup-subsection {open if section.trigger != null}>
  <summary>Popup behavior</summary>
  <p class="muted">When a trigger is set, this section is hidden by default on the published site and shown when the trigger fires.</p>
  <!-- Type field -->
  <label>
    <span>Trigger</span>
    <select data-section-trigger-type>
      <option value="">— none (regular section) —</option>
      <option value="exit-intent">Exit intent (mouse leaves window)</option>
      <option value="delay">Delay (seconds after page load)</option>
      <option value="scroll">Scroll depth (% of page)</option>
    </select>
  </label>
  <!-- Conditional value -->
  <label data-trigger-value-wrap hidden={triggerType not in ['delay', 'scroll']}>
    <span data-trigger-value-label>Seconds</span>
    <input type="number" min={0} step={1} data-section-trigger-value />
  </label>
</details>
```

`<details>` starts open when the section already has a trigger so owners don't lose what's there; starts closed otherwise.

### 6.2 Change handlers

Type select:
```js
typeSel.addEventListener("change", function() {
  var t = typeSel.value;
  if (t === "") {
    delete section.trigger;
    valueWrap.hidden = true;
  } else if (t === "exit-intent") {
    section.trigger = { type: "exit-intent" };
    valueWrap.hidden = true;
  } else if (t === "delay") {
    section.trigger = { type: "delay", value: (section.trigger && section.trigger.type === "delay" ? section.trigger.value : 3) };
    valueLabel.textContent = "Seconds";
    valueInput.value = String(section.trigger.value);
    valueWrap.hidden = false;
  } else if (t === "scroll") {
    section.trigger = { type: "scroll", value: (section.trigger && section.trigger.type === "scroll" ? section.trigger.value : 50) };
    valueLabel.textContent = "% of page";
    valueInput.value = String(section.trigger.value);
    valueWrap.hidden = false;
  }
  rebuildSectionOrPage(section.id);
  scheduleSave();
  captureForUndo();
});
```

Value input:
```js
valueInput.addEventListener("change", function() {
  var n = parseInt(valueInput.value, 10);
  if (!Number.isFinite(n) || n < 0) return;
  if (section.trigger) {
    section.trigger.value = n;
    rebuildSectionOrPage(section.id);
    scheduleSave();
    captureForUndo();
  }
});
```

Defaults `delay = 3 seconds`, `scroll = 50 %` apply only the first time the type is picked; switching back keeps prior value.

### 6.3 Editor-side popup signal

New CSS rule appended to [canvas-styles.ts](src/editor/canvas-styles.ts):

```css
[data-rev01-editor-popup="true"] {
  outline: 2px dashed var(--EDITOR-ACCENT-VAR, #5b8def);
  outline-offset: 4px;
}
[data-rev01-editor-popup="true"]::before {
  content: "Popup";
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--EDITOR-ACCENT-VAR, #5b8def);
  background: rgba(91, 141, 239, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
  pointer-events: none;
  z-index: 10;
}
```

`--EDITOR-ACCENT-VAR` is a placeholder — implementation reads the actual editor-chrome accent CSS variable used elsewhere in canvas-styles.ts (likely `--accent`, `--rev01-accent`, or similar). Fallback hex `#5b8def` matches the existing editor blue.

The section wrapper renderer in canvas-client.ts sets `data-rev01-editor-popup="true"` on the section's DOM node when `section.trigger != null`. Editor-only attribute — the public renderer does not need it. Popup-tagged sections remain visible on the editor canvas; the `display: none` rule only fires at publish.

## 7. Testing

### 7.1 New smoke `src/editor/section-inspector-additions.smoke.ts`

Per field — role, backgroundEffect, entrance, backgroundVideoAssetId, trigger:
- Boot editor with a fixture page; select a section.
- Assert the field's input appears in the inspector with the schema-defined option set.
- Change the value via the UI; assert the state mutation is exactly what the spec describes.
- Assert the section's rendered DOM updates the corresponding `data-*` attribute (or, for backgroundVideoAssetId, the `<video>` child).
- Reload editor state; assert field persists.

### 7.2 Role-conflict tests

- Fixture page with section A (`role = 'header'`) and section B (no role).
- Open B's inspector. Assert the `header` option is `disabled` with the inline hint naming A.
- Click the inline "Demote A to body" button. Assert A's role is cleared and the header option becomes enabled on B's inspector.
- Set B's role to header. Assert success and the page re-renders.

### 7.3 Replay test

- Fixture section with `entrance = 'fade-up'`. Click `▶ Replay`. Assert the section's `data-motion-preset` is removed then re-added (the existing replay trick).

### 7.4 Trigger composite tests

- Pick `delay`. Assert value input becomes visible with default `3`.
- Type `7`. Assert `section.trigger = { type: 'delay', value: 7 }`.
- Change type to `exit-intent`. Assert value input hides and `section.trigger = { type: 'exit-intent' }` (no value).
- Change type to scroll. Assert value input shows with default 50, `section.trigger = { type: 'scroll', value: 50 }`.
- Change type to `""`. Assert `section.trigger` deleted.
- Assert the section DOM gains/loses `data-rev01-editor-popup` accordingly.

### 7.5 Background video test

- Upload a small `.mp4` fixture. Assert `section.backgroundVideoAssetId` set and the `<video>` element renders inside the section DOM.
- Click "Remove video". Assert field deleted, video gone.

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `rebuildSection(id)` may not exist in the codebase; full-page rebuild is the only path. | The spec uses an alias `rebuildSectionOrPage(section.id)`. At implementation, check for an existing section-level rebuild; if absent, use the page-level path. Full page rebuild is slower but correct. |
| `replayAnimations` is currently called with `"page"` or an element id from elsewhere in canvas-client.ts. Extending its signature could surprise other callers. | The extension is additive: a section id is tried only after element id fails to resolve. Existing callers' inputs continue to resolve to the same branches. |
| Two-header state already exists in some templates / AI-generated pages. The inspector flags it but the renderer's behavior with two headers is undefined. | The conflict hint with a "Demote" button is the resolution path. The renderer's behavior with two headers is outside this spec's scope; if owners report rendering bugs, file separately. |
| Popup-tagged section visible in editor + hidden at publish is a known WYSIWYG gap. | The dashed outline + "Popup" pill are the editor-side signal. Sub-project A's dark-mode preview is a precedent for editor-render-differs-from-publish — owners get used to it. |
| Asset upload may not support video MIMEs end-to-end. | `accept="video/mp4,video/webm"` is the OS-level filter; server-side rejection (if any) surfaces via setStatus. If the upload pipeline rejects videos today, this is a sub-bug to file — the schema field exists, the renderer consumes it, so the pipeline ought to accept. |
| The new fields swell the inspector vertically; users may have to scroll past pickers to reach action buttons. | Place pickers above action buttons (their natural grouping). Owners who use actions frequently can collapse the Popup `<details>`; default state of other groups is open. |
| `captureForUndo` is called after each change, but the existing flow already batches via an 800ms debounce. | Standard behavior of the existing undo capture; not new. |

## 9. Out-of-Scope Follow-Ups

- Visual chip picker for `BackgroundEffect` and `MotionPreset`.
- "Preview popup" button that simulates the trigger in-editor.
- Video-asset library browser.
- Bulk-apply effect / entrance across all sections on a page.
- Section-role audit page that surfaces all sections with role conflicts across the site.
- Multi-stage popup behavior (e.g. "show once per visitor", cookie integration).
