# Inline Link UX — Design Spec

**Date:** 2026-05-24
**Status:** Approved

## WHY

Links inside text elements have no editing affordance. Users can create links via the mark toolbar, but once placed there is no way to see where links are, edit them, open them, or remove them. The text-editing experience should make links first-class: visually distinct, hoverable for quick actions, and configurable through a dedicated modal.

## Success Criteria

- User sees accent-colored underline on linked text while editing — knows immediately what is linked.
- User hovers linked text → popover appears showing URL, with Open / Edit / Unlink actions.
- User can open the link in a new tab from the popover without leaving the editor.
- User can edit an existing link's URL and target from the popover.
- User can remove a link (unlink) while keeping the text.
- Link creation modal shows selected text preview, URL field, and "open in new tab" toggle.
- Published render respects `target="_blank"` with proper `rel="noopener noreferrer"`.

## Non-Goals

- Block-level Link element (links stay as inline marks on text).
- Auto-link detection (pasting a URL doesn't auto-create a link).
- Link analytics or tracking.
- Mobile/touch-specific interactions (this is a desktop editor).

## Hard Constraints

- Data model change must be backward-compatible (existing marks lack `target`, render as same-window).
- `isAllowedHref()` validation stays unchanged — same scheme allowlist.
- No new element types, no new database tables, no migration.
- Popover must not interfere with text editing (cursor stays `text`, click lands caret).
- Follows existing patterns: DOM-based UI, `position: fixed`, singleton lifecycle.

---

## 1. Data Model

Extend the `link` inline mark with an optional `target` field:

```typescript
// Before
{ type: 'link'; href: string }

// After
{ type: 'link'; href: string; target?: '_blank' }
```

- `target` is optional. Absent = same-window navigation (default browser behavior).
- Backward-compatible: existing marks serialize/render unchanged.
- Validation: reject any `target` value other than `'_blank'` or absent.

**Files:** `src/canvas/schema.ts` (type definition), `src/canvas/validate.ts` (validation).

## 2. Link Creation / Edit Modal

Replace the bare `openTextModal({ title: "Add link" })` with a dedicated `openLinkModal()`.

**Modal contents:**
1. **Title:** "Link"
2. **Link text** — read-only preview of the selected/linked text.
3. **URL** — text input, placeholder `https://...`, pre-filled when editing.
4. **Open in new tab** — checkbox. Default: checked for `http:`/`https:` URLs, unchecked for relative/anchor.
5. **Cancel / Apply** — standard action row.

**Behavior:**
- Same DOM lifecycle as `openTextModal`: created fresh, returns `Promise<{ href: string; target?: '_blank' } | null>`, destroyed on close.
- Respects single-modal constraint (`modalOpen` guard).
- URL validation via `isAllowedHref()` — on failure, shows inline error below the URL field (not status bar toast).
- Used for both creation (from toolbar) and editing (from popover "Edit" button).

**File:** `src/editor/canvas-client.ts` (new `openLinkModal()` function, replaces `promptForLinkHref()` call in `applyLinkMark()`).

## 3. Hover Popover

A lightweight floating element shown when the mouse enters an `<a>` tag inside the active contenteditable text element.

**Trigger mechanics:**
- `mouseenter` on `<a>` elements inside active text editor → show popover after 150ms delay.
- `mouseleave` on `<a>` → start 200ms hide timer.
- `mouseenter` on popover → cancel hide timer (bridge pattern).
- `mouseleave` on popover → hide immediately.
- `endTextEdit()` → remove popover.

**Positioning:**
- Anchored below the `<a>` element via `getBoundingClientRect()`.
- Falls back to above if near viewport bottom.
- `position: fixed`, appended to `document.body` (same as mark toolbar).
- Z-index: 190 (above mark toolbar's 180).

**Contents (horizontal row):**
- **URL** — truncated to ~40 chars, not editable.
- **Open** — `window.open(href, '_blank')`.
- **Edit** — opens `openLinkModal()` pre-populated with current href/target. On apply, updates the `<a>` element in-place.
- **Unlink** — unwraps the `<a>` tag, preserving its text content as plain text in the contenteditable.

**Lifecycle:**
- Singleton — only one popover at a time.
- Created/destroyed dynamically (not hidden/shown).

**Files:** `src/editor/canvas-client.ts` (popover logic), `src/editor/canvas-styles.ts` (popover styles).

## 4. Edit-Mode Link Styling

```css
[contenteditable="true"] a.rev01-inline-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rev01-accent);
  text-underline-offset: 2px;
  cursor: text;
}
```

- `cursor: text` — signals editability, not clickability.
- Color inherits from parent text element.
- Accent underline matches published style for WYSIWYG consistency.

**File:** `src/editor/canvas-styles.ts`.

## 5. Serialization Changes

**`activeMarksFor()` / `serializeContentToRuns()`** in `canvas-client.ts`:
- When hitting an `<a>` element while walking up the DOM tree, extract both `href` and `target` attributes.
- Emit `{ type: 'link', href, target: '_blank' }` when `target="_blank"` is present, otherwise `{ type: 'link', href }`.

**`buildRunNode()`** in `canvas-client.ts`:
- When building the `<a>` for a link mark, set `a.target = '_blank'` if `mark.target === '_blank'`.
- Keep the existing `ev.preventDefault()` on click.

## 6. Public Render Changes

**`renderRun()`** in `src/canvas/elements/text.ts`:
- When emitting `<a>`, add `target="_blank" rel="noopener noreferrer"` if `mark.target === '_blank'`.

## 7. Validation Changes

**`src/canvas/validate.ts`:**
- Allow `target` field on link marks. Only valid value: `'_blank'`.
- Reject unknown values; absent is valid (defaults to same-window).
