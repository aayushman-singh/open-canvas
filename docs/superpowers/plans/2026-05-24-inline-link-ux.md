# Inline Link UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade inline link editing in the canvas editor — hover popover with Open/Edit/Unlink, a richer creation modal with text preview and target toggle, accent-colored underline in edit mode, and `target="_blank"` support through the full stack.

**Architecture:** Links stay as inline marks (`InlineMark` union) on `InlineRun[]` inside `TextElement.content`. The only data model change is adding an optional `target?: '_blank'` field to the link variant. All new UI (modal, popover) lives in `canvas-client.ts` as DOM-based singletons following the existing mark toolbar and modal patterns. Styles go in `canvas-styles.ts`.

**Tech Stack:** Vanilla DOM (contenteditable), TypeScript types, CSS custom properties, Bun smoke tests.

**Critical constraint:** `canvas-client.ts` is a browser IIFE wrapped in a template literal. **No backticks** anywhere in the file body — they break the build. Use single quotes and string concatenation only. Smokes pass but the build will break silently if a backtick slips in.

---

### Task 1: Data Model — `target` field on link marks

**Files:**
- Modify: `src/canvas/schema.ts:133-140` (InlineMark type union)
- Modify: `src/canvas/validate.ts:251-263` (link mark validation)
- Modify: `src/canvas/smoke.ts` (add target validation smoke assertions)

- [ ] **Step 1: Extend the InlineMark union type**

In `src/canvas/schema.ts`, change the link variant from:

```typescript
  | { type: 'link'; href: string };
```

to:

```typescript
  | { type: 'link'; href: string; target?: '_blank' };
```

- [ ] **Step 2: Add target validation in validate.ts**

In `src/canvas/validate.ts`, inside `validateTextContent` at the `if (mark.type === 'link')` block (after the href validation around line 258-263), add target validation. Insert after the `isAllowedHref` check and before the closing `}` of the `if (mark.type === 'link')` block:

```typescript
        if (
          mark.target !== undefined &&
          mark.target !== '_blank'
        ) {
          errors.push(
            `text element ${idLabel}.content[${String(runIdx)}].marks[${String(markIdx)}].target must be "_blank" when present (got ${describe(mark.target)})`,
          );
        }
```

This requires adding `target` to the type narrowing. The `mark` is typed as `Record<string, unknown>` inside `validateTextContent` since it uses `isRecord` checks. The `mark.target` access is already valid on the record type.

- [ ] **Step 3: Write smoke tests for the target field**

In `src/canvas/smoke.ts`, add these assertions after the existing `javascript:alert(1)` test block (after line 112, before the `// -- Task 5.6` comment):

```typescript
// Link mark with target: '_blank' must be accepted by the validator.
const blankTargetText: TextElement = {
  id: 'link-blank-target',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [
    {
      text: 'external',
      marks: [{ type: 'link', href: 'https://example.com', target: '_blank' }],
    },
  ],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const blankTargetState: CanvasSiteState = {
  styleKit: 'charcoal',
  symbols: [],
  pages: [
    {
      id: 'page-blank-target',
      slug: 'blank-target',
      title: 'Blank Target',
      width: 1440,
      sections: [
        {
          id: 'section-blank-target',
          recipeId: 'hero-split',
          name: 'Blank Target',
          height: 400,
          elements: [blankTargetText],
        },
      ],
    },
  ],
};
const blankTargetResult = validateCanvasSiteState(blankTargetState);
assert(
  blankTargetResult.valid,
  blankTargetResult.valid
    ? ''
    : 'expected validator to accept link mark with target="_blank": ' +
        blankTargetResult.errors.join('; '),
);

// Link mark with an invalid target value must be rejected.
const badTargetText: TextElement = {
  id: 'link-bad-target',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [
    {
      text: 'bad',
      marks: [
        {
          type: 'link',
          href: 'https://example.com',
          target: '_self' as '_blank',
        },
      ],
    },
  ],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const badTargetState: CanvasSiteState = {
  styleKit: 'charcoal',
  symbols: [],
  pages: [
    {
      id: 'page-bad-target',
      slug: 'bad-target',
      title: 'Bad Target',
      width: 1440,
      sections: [
        {
          id: 'section-bad-target',
          recipeId: 'hero-split',
          name: 'Bad Target',
          height: 400,
          elements: [badTargetText],
        },
      ],
    },
  ],
};
const badTargetResult = validateCanvasSiteState(badTargetState);
assert(
  !badTargetResult.valid,
  'expected validator to reject link mark with target="_self"',
);
assert(
  !badTargetResult.valid &&
    badTargetResult.errors.some((m) => m.includes('target')),
  'expected bad-target rejection error to mention "target"',
);

// Link mark without target (existing data) must still pass — backward compat.
const noTargetText: TextElement = {
  id: 'link-no-target',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [
    { text: 'old link', marks: [{ type: 'link', href: 'https://example.com' }] },
  ],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const noTargetState: CanvasSiteState = {
  styleKit: 'charcoal',
  symbols: [],
  pages: [
    {
      id: 'page-no-target',
      slug: 'no-target',
      title: 'No Target',
      width: 1440,
      sections: [
        {
          id: 'section-no-target',
          recipeId: 'hero-split',
          name: 'No Target',
          height: 400,
          elements: [noTargetText],
        },
      ],
    },
  ],
};
const noTargetResult = validateCanvasSiteState(noTargetState);
assert(
  noTargetResult.valid,
  noTargetResult.valid
    ? ''
    : 'expected validator to accept link mark without target (backward compat): ' +
        noTargetResult.errors.join('; '),
);
```

- [ ] **Step 4: Run smoke to verify**

Run: `bun run canvas:smoke`
Expected: `[canvas:smoke] OK`

- [ ] **Step 5: Commit**

```bash
git add src/canvas/schema.ts src/canvas/validate.ts src/canvas/smoke.ts
git commit -m "feat(canvas): add optional target field to link inline mark"
```

---

### Task 2: Public Render — emit `target` and `rel` on links

**Files:**
- Modify: `src/canvas/elements/text.ts:31-34` (renderRun link output)
- Modify: `src/canvas/smoke.ts` (add render assertion)

- [ ] **Step 1: Write the smoke assertion first**

In `src/canvas/smoke.ts`, after the Task 1 assertions you just added (and before the `// -- Task 5.6` comment), add:

```typescript
// Public render: link with target="_blank" must emit target and rel attributes.
const blankTargetSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-24T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: blankTargetState.pages,
};
const blankTargetHtml = renderCanvasSnapshot(blankTargetSnapshot, '/assets');
assert(
  blankTargetHtml.includes('target="_blank"'),
  'expected rendered HTML to include target="_blank" for link mark with target set',
);
assert(
  blankTargetHtml.includes('rel="noopener noreferrer"'),
  'expected rendered HTML to include rel="noopener noreferrer" for target="_blank" links',
);

// Public render: link WITHOUT target must NOT emit target or rel attributes.
const noTargetSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-24T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: noTargetState.pages,
};
const noTargetHtml = renderCanvasSnapshot(noTargetSnapshot, '/assets');
assert(
  !noTargetHtml.includes('target='),
  'expected rendered HTML to NOT include target= for link mark without target',
);
assert(
  !noTargetHtml.includes('rel='),
  'expected rendered HTML to NOT include rel= for link mark without target',
);
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `bun run canvas:smoke`
Expected: FAIL with `expected rendered HTML to include target="_blank"`

- [ ] **Step 3: Update renderRun in text.ts**

In `src/canvas/elements/text.ts`, replace the link block (lines 31-34):

```typescript
  const link = findLinkMark(run);
  if (link) {
    inner = `<a class="rev01-inline-link" href="${escapeAttr(link.href)}">${inner}</a>`;
  }
```

with:

```typescript
  const link = findLinkMark(run);
  if (link) {
    const targetAttr = link.target === '_blank'
      ? ' target="_blank" rel="noopener noreferrer"'
      : '';
    inner = `<a class="rev01-inline-link" href="${escapeAttr(link.href)}"${targetAttr}>${inner}</a>`;
  }
```

- [ ] **Step 4: Run smoke to verify it passes**

Run: `bun run canvas:smoke`
Expected: `[canvas:smoke] OK`

- [ ] **Step 5: Commit**

```bash
git add src/canvas/elements/text.ts src/canvas/smoke.ts
git commit -m "feat(canvas): emit target and rel on public-rendered links"
```

---

### Task 3: Edit-Mode Link Styling

**Files:**
- Modify: `src/editor/canvas-styles.ts` (add contenteditable link styles)

- [ ] **Step 1: Add link styles for contenteditable**

In `src/editor/canvas-styles.ts`, find the `.rev01-mark-toolbar` block (around line 984). Insert the following CSS **before** that block:

```css
/* Inline links inside contenteditable — accent underline + text cursor so
   the Owner sees linked text at a glance without losing the ability to
   click-to-place-caret. Mirrors public-styles.ts .rev01-inline-link. */
[contenteditable="true"] a.rev01-inline-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rev01-kit-accent, var(--kit-accent, currentColor));
  text-underline-offset: 2px;
  cursor: text;
}
[contenteditable="true"] a.rev01-inline-link:hover {
  color: var(--rev01-kit-accent, var(--kit-accent, currentColor));
}
```

- [ ] **Step 2: Verify build**

Run: `bun run canvas:smoke`
Expected: `[canvas:smoke] OK` (CSS changes don't break smoke — visual-only)

- [ ] **Step 3: Commit**

```bash
git add src/editor/canvas-styles.ts
git commit -m "feat(editor): accent underline for inline links in edit mode"
```

---

### Task 4: Serialization — extract and emit `target` attribute

**Files:**
- Modify: `src/editor/canvas-client.ts:3120-3122` (activeMarksFor — extract target)
- Modify: `src/editor/canvas-client.ts:3140-3146` (marksEqual — compare target)
- Modify: `src/editor/canvas-client.ts:749-758` (buildRunNode — set target on `<a>`)

All edits are inside the browser IIFE. **No backticks allowed — use single quotes and `+` concatenation only.**

- [ ] **Step 1: Update `activeMarksFor` to extract target**

In `src/editor/canvas-client.ts`, find the `activeMarksFor` function. Replace the line (around line 3122):

```javascript
          marks.push({ type: "link", href: cur.getAttribute("href") || "" });
```

with:

```javascript
          var linkMark = { type: "link", href: cur.getAttribute("href") || "" };
          if (cur.getAttribute("target") === "_blank") {
            linkMark.target = "_blank";
          }
          marks.push(linkMark);
```

- [ ] **Step 2: Update `marksEqual` to compare target**

In `src/editor/canvas-client.ts`, find the `marksEqual` function. Replace the line (around line 3144):

```javascript
      if (a[i].type === "link" && a[i].href !== b[i].href) return false;
```

with:

```javascript
      if (a[i].type === "link") {
        if (a[i].href !== b[i].href) return false;
        if ((a[i].target || "") !== (b[i].target || "")) return false;
      }
```

- [ ] **Step 3: Update `buildRunNode` to set target on `<a>`**

In `src/editor/canvas-client.ts`, find the `buildRunNode` function. After the line that sets `href` (around line 753):

```javascript
      a.setAttribute("href", link.href);
```

Add:

```javascript
      if (link.target === "_blank") {
        a.setAttribute("target", "_blank");
      }
```

- [ ] **Step 4: Verify build**

Run: `bun run canvas:smoke`
Expected: `[canvas:smoke] OK` (client-side changes don't affect server smoke)

- [ ] **Step 5: Commit**

```bash
git add src/editor/canvas-client.ts
git commit -m "feat(editor): serialize and render target attribute on link marks"
```

---

### Task 5: Link Popover Styles

**Files:**
- Modify: `src/editor/canvas-styles.ts` (add popover CSS)

- [ ] **Step 1: Add link popover CSS**

In `src/editor/canvas-styles.ts`, insert the following CSS after the `.rev01-mark-toolbar button:hover` block (after line ~1011, before the `/* Inspector reading-order group */` comment):

```css
/* Link hover popover — singleton floating bar shown when the mouse enters
   an <a> inside a contenteditable text element. Positioned below (or above)
   the link via position: fixed. Z-index above the mark toolbar (180). */
.rev01-link-popover {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  z-index: 190;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--rev01-bg-titlebar);
  border: 1px solid var(--rev01-hairline-strong);
  box-shadow: 0 6px 18px oklch(0 0 0 / 0.35);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg);
  max-width: 420px;
  pointer-events: auto;
}
.rev01-link-popover .rev01-link-popover-url {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rev01-fg-mute);
  max-width: 240px;
  user-select: none;
}
.rev01-link-popover button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  font: inherit;
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.rev01-link-popover button:hover {
  border-color: var(--rev01-accent);
  color: var(--rev01-fg);
}
```

- [ ] **Step 2: Add link modal inline error CSS**

Also append this CSS for the inline validation error in the link modal, right after the popover styles:

```css
/* Link modal inline validation error */
.rev01-link-modal-error {
  color: var(--rev01-error, #e55);
  font-size: 11px;
  min-height: 16px;
  margin: -4px 0 0;
}
/* Link modal text preview */
.rev01-link-modal-preview {
  font-size: 12px;
  color: var(--rev01-fg-mute);
  padding: 6px 10px;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Link modal checkbox row */
.rev01-link-modal-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--rev01-fg);
  cursor: pointer;
}
.rev01-link-modal-checkbox input[type="checkbox"] {
  accent-color: var(--rev01-accent);
  cursor: pointer;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/editor/canvas-styles.ts
git commit -m "feat(editor): CSS for link hover popover and link modal"
```

---

### Task 6: Link Creation / Edit Modal

**Files:**
- Modify: `src/editor/canvas-client.ts` (new `openLinkModal`, rewire `applyLinkMark`)

All code in this task is vanilla JS inside the browser IIFE. **No backticks — single quotes and `+` concatenation only.**

- [ ] **Step 1: Add `openLinkModal` function**

In `src/editor/canvas-client.ts`, find the `promptForLinkHref` function (around line 3275). Replace **both** `promptForLinkHref` and `applyLinkMark` (lines 3275–3324) with:

```javascript
  function openLinkModal(opts) {
    if (modalOpen) {
      throw new Error('openLinkModal: another modal is already open');
    }
    var linkText = typeof opts.linkText === 'string' ? opts.linkText : '';
    var defaultHref = typeof opts.href === 'string' ? opts.href : 'https://';
    var defaultBlank = opts.blank === true;
    modalOpen = true;
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'rev01-modal-backdrop';
      var panel = document.createElement('div');
      panel.className = 'rev01-modal';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Link');

      var h = document.createElement('h3');
      h.textContent = 'Link';
      panel.appendChild(h);

      // Link text preview (read-only).
      if (linkText.length > 0) {
        var previewLabel = document.createElement('label');
        previewLabel.textContent = 'Text';
        panel.appendChild(previewLabel);
        var preview = document.createElement('div');
        preview.className = 'rev01-link-modal-preview';
        preview.textContent = linkText;
        panel.appendChild(preview);
      }

      // URL input.
      var urlLabel = document.createElement('label');
      urlLabel.textContent = 'URL';
      panel.appendChild(urlLabel);
      var urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.value = defaultHref;
      urlInput.placeholder = 'https://...';
      panel.appendChild(urlInput);

      // Inline validation error.
      var errorEl = document.createElement('div');
      errorEl.className = 'rev01-link-modal-error';
      errorEl.textContent = '';
      panel.appendChild(errorEl);

      // Open in new tab checkbox.
      var checkLabel = document.createElement('label');
      checkLabel.className = 'rev01-link-modal-checkbox';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = defaultBlank;
      checkLabel.appendChild(checkbox);
      var checkText = document.createTextNode(' Open in new tab');
      checkLabel.appendChild(checkText);
      panel.appendChild(checkLabel);

      // Auto-toggle checkbox based on URL scheme.
      function autoToggleBlank() {
        var val = urlInput.value.trim();
        if (val.startsWith('http://') || val.startsWith('https://')) {
          checkbox.checked = true;
        } else if (val.startsWith('#') || val.startsWith('/')) {
          checkbox.checked = false;
        }
      }
      // Only auto-toggle when creating (no existing href).
      if (defaultHref === 'https://') {
        urlInput.addEventListener('input', autoToggleBlank);
      }

      // Action buttons.
      var actions = document.createElement('div');
      actions.className = 'rev01-modal-actions';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      var applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.textContent = 'Apply';
      actions.appendChild(cancelBtn);
      actions.appendChild(applyBtn);
      panel.appendChild(actions);

      backdrop.appendChild(panel);

      function close(value) {
        document.removeEventListener('keydown', onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove('rev01-modal-open');
        modalOpen = false;
        resolve(value);
      }

      function tryApply() {
        var href = urlInput.value.trim();
        if (href.length === 0) {
          errorEl.textContent = 'URL cannot be empty';
          return;
        }
        if (!isAllowedHref(href)) {
          errorEl.textContent = 'URL must be http, https, mailto, tel, /relative, or #anchor';
          return;
        }
        var result = { href: href };
        if (checkbox.checked) {
          result.target = '_blank';
        }
        close(result);
      }

      function onKey(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          close(null);
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          tryApply();
        }
      }
      backdrop.addEventListener('click', function (ev) {
        if (ev.target === backdrop) close(null);
      });
      cancelBtn.addEventListener('click', function () { close(null); });
      applyBtn.addEventListener('click', function () { tryApply(); });
      // Clear error on input.
      urlInput.addEventListener('input', function () { errorEl.textContent = ''; });
      document.addEventListener('keydown', onKey, true);

      document.body.classList.add('rev01-modal-open');
      document.body.appendChild(backdrop);
      urlInput.focus();
      urlInput.select();
    });
  }

  async function applyLinkMark() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) {
      setStatus('Select some text first to add a link', 'error');
      return;
    }
    var savedRange = range.cloneRange();
    var selectedText = savedRange.toString();
    var result = await openLinkModal({
      linkText: selectedText,
      href: 'https://',
      blank: true,
    });
    if (result === null) return;
    sel.removeAllRanges();
    sel.addRange(savedRange);
    var a = document.createElement('a');
    a.className = 'rev01-inline-link';
    a.setAttribute('href', result.href);
    if (result.target === '_blank') {
      a.setAttribute('target', '_blank');
    }
    try {
      savedRange.surroundContents(a);
    } catch (_) {
      var fragment = savedRange.extractContents();
      a.appendChild(fragment);
      savedRange.insertNode(a);
    }
    sel.removeAllRanges();
    var next = document.createRange();
    next.selectNode(a);
    sel.addRange(next);
  }
```

- [ ] **Step 2: Verify build**

Run: `bun run canvas:smoke`
Expected: `[canvas:smoke] OK`

- [ ] **Step 3: Commit**

```bash
git add src/editor/canvas-client.ts
git commit -m "feat(editor): dedicated link modal with text preview and target toggle"
```

---

### Task 7: Link Hover Popover + Blur Guard

**Files:**
- Modify: `src/editor/canvas-client.ts` (popover logic, blur guard, wiring into beginTextEdit)

All code in this task is vanilla JS inside the browser IIFE. **No backticks — single quotes and `+` concatenation only.**

- [ ] **Step 1: Add popover state variables**

In `src/editor/canvas-client.ts`, find the mark toolbar state variables (around line 3207):

```javascript
  let markToolbarAnchor = null;
```

Insert **before** that line:

```javascript
  // -- Link hover popover --------------------------------------------------
  var linkPopover = null;
  var linkPopoverAnchor = null;
  var linkPopoverShowTimer = null;
  var linkPopoverHideTimer = null;

  function removeLinkPopover() {
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    if (linkPopover && linkPopover.parentNode) {
      linkPopover.parentNode.removeChild(linkPopover);
    }
    linkPopover = null;
    linkPopoverAnchor = null;
  }

  function positionLinkPopover(anchorEl) {
    if (!linkPopover || !anchorEl) return;
    var rect = anchorEl.getBoundingClientRect();
    var popoverHeight = linkPopover.offsetHeight || 32;
    var spaceBelow = window.innerHeight - rect.bottom;
    var top;
    if (spaceBelow >= popoverHeight + 8) {
      top = rect.bottom + 6;
    } else {
      top = rect.top - popoverHeight - 6;
    }
    linkPopover.style.top = Math.max(0, top) + 'px';
    linkPopover.style.left = Math.max(0, rect.left) + 'px';
  }

  function showLinkPopover(anchorEl) {
    removeLinkPopover();
    var href = anchorEl.getAttribute('href') || '';
    var bar = document.createElement('div');
    bar.className = 'rev01-link-popover';

    // URL display (truncated).
    var urlSpan = document.createElement('span');
    urlSpan.className = 'rev01-link-popover-url';
    urlSpan.textContent = href.length > 40 ? href.slice(0, 37) + '...' : href;
    urlSpan.title = href;
    bar.appendChild(urlSpan);

    // Open button.
    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    openBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      window.open(href, '_blank');
    });
    bar.appendChild(openBtn);

    // Edit button.
    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    editBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var currentHref = anchorEl.getAttribute('href') || '';
      var currentTarget = anchorEl.getAttribute('target') || '';
      var linkText = anchorEl.textContent || '';
      removeLinkPopover();
      openLinkModal({
        linkText: linkText,
        href: currentHref,
        blank: currentTarget === '_blank',
      }).then(function (result) {
        if (result === null) return;
        anchorEl.setAttribute('href', result.href);
        if (result.target === '_blank') {
          anchorEl.setAttribute('target', '_blank');
        } else {
          anchorEl.removeAttribute('target');
        }
        // Update the popover URL display.
        urlSpan.textContent = result.href.length > 40
          ? result.href.slice(0, 37) + '...'
          : result.href;
        urlSpan.title = result.href;
      }).catch(function (err) {
        setStatus('Link edit failed: ' + (err && err.message ? err.message : String(err)), 'error');
      });
    });
    bar.appendChild(editBtn);

    // Unlink button.
    var unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.textContent = 'Unlink';
    unlinkBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    unlinkBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var parent = anchorEl.parentNode;
      if (!parent) return;
      while (anchorEl.firstChild) {
        parent.insertBefore(anchorEl.firstChild, anchorEl);
      }
      parent.removeChild(anchorEl);
      removeLinkPopover();
    });
    bar.appendChild(unlinkBtn);

    // Bridge pattern: popover mouseenter cancels hide, mouseleave hides.
    bar.addEventListener('mouseenter', function () {
      if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    });
    bar.addEventListener('mouseleave', function () {
      removeLinkPopover();
    });

    linkPopover = bar;
    linkPopoverAnchor = anchorEl;
    document.body.appendChild(bar);
    positionLinkPopover(anchorEl);
  }

  function onLinkMouseEnter(ev) {
    if (!editingElementId) return;
    var target = ev.target;
    if (!target || target.tagName !== 'A') return;
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    linkPopoverShowTimer = setTimeout(function () {
      linkPopoverShowTimer = null;
      showLinkPopover(target);
    }, 150);
  }

  function onLinkMouseLeave(ev) {
    var target = ev.target;
    if (!target || target.tagName !== 'A') return;
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    linkPopoverHideTimer = setTimeout(function () {
      linkPopoverHideTimer = null;
      removeLinkPopover();
    }, 200);
  }
```

- [ ] **Step 2: Wire popover into `beginTextEdit`**

In `src/editor/canvas-client.ts`, inside the `beginTextEdit` function, find the line (around line 3410):

```javascript
    buildMarkToolbar(wrapper);
```

Insert **after** it:

```javascript
    // Attach link hover listeners to the contenteditable inner element.
    inner.addEventListener('mouseover', function (ev) {
      var node = ev.target;
      while (node && node !== inner) {
        if (node.nodeType === 1 && node.tagName === 'A') {
          onLinkMouseEnter({ target: node });
          return;
        }
        node = node.parentNode;
      }
    });
    inner.addEventListener('mouseout', function (ev) {
      var node = ev.target;
      while (node && node !== inner) {
        if (node.nodeType === 1 && node.tagName === 'A') {
          onLinkMouseLeave({ target: node });
          return;
        }
        node = node.parentNode;
      }
    });
```

- [ ] **Step 3: Update `finish` to remove popover**

In `src/editor/canvas-client.ts`, inside the `finish` function within `beginTextEdit`, find the line:

```javascript
      removeMarkToolbar();
```

Insert **after** it:

```javascript
      removeLinkPopover();
```

- [ ] **Step 4: Update `onBlur` to ignore popover clicks**

In `src/editor/canvas-client.ts`, find the `onBlur` handler inside `beginTextEdit`. Replace:

```javascript
      if (next && markToolbar && markToolbar.contains(next)) return;
```

with:

```javascript
      if (next && markToolbar && markToolbar.contains(next)) return;
      if (next && linkPopover && linkPopover.contains(next)) return;
      if (modalOpen) return;
```

The `modalOpen` guard is critical: when the popover's "Edit" button opens `openLinkModal`, focus moves to the modal's URL input. This fires a blur event on the contenteditable whose `relatedTarget` is the modal input — neither inside `markToolbar` nor `linkPopover`. Without the `modalOpen` guard, blur would call `finish(true)` and end text editing while the link edit modal is still open.

- [ ] **Step 5: Reposition popover on scroll/resize**

In `src/editor/canvas-client.ts`, find the `onMarkToolbarReflow` function (around line 3235):

```javascript
  function onMarkToolbarReflow() {
    if (markToolbarAnchor) positionMarkToolbar(markToolbarAnchor);
  }
```

Replace with:

```javascript
  function onMarkToolbarReflow() {
    if (markToolbarAnchor) positionMarkToolbar(markToolbarAnchor);
    if (linkPopoverAnchor) positionLinkPopover(linkPopoverAnchor);
  }
```

- [ ] **Step 6: Verify build**

Run: `bun run canvas:smoke`
Expected: `[canvas:smoke] OK`

- [ ] **Step 7: Commit**

```bash
git add src/editor/canvas-client.ts
git commit -m "feat(editor): link hover popover with Open, Edit, and Unlink"
```

---

### Task 8: Manual Verification

**Files:** None (read-only verification)

- [ ] **Step 1: Run all smoke tests**

```bash
bun run canvas:smoke && bun run canvas-agent:smoke
```

Expected: Both print OK.

- [ ] **Step 2: Start the dev server and test in browser**

```bash
bun run dev
```

Open the editor. Test the following scenarios:

1. **Create a link:** Select text in a text element → click "Link" in the mark toolbar (or Ctrl+K) → link modal appears with text preview, URL field, and "Open in new tab" checkbox → enter a URL → click Apply → text gets accent underline.
2. **Hover popover:** Hover over the linked text → popover appears below after ~150ms showing truncated URL + Open/Edit/Unlink buttons.
3. **Open link:** Click "Open" in the popover → link opens in new tab.
4. **Edit link:** Click "Edit" in the popover → link modal opens pre-populated with current URL and target → change URL → Apply → popover updates.
5. **Unlink:** Click "Unlink" in the popover → link removed, text preserved as plain text, accent underline gone.
6. **Target toggle:** Create a link with "Open in new tab" checked → save → publish → verify the public page opens the link in a new tab.
7. **Backward compat:** Load a page with existing links (no target field) → they render normally, hover popover works, "Open in new tab" checkbox unchecked in edit modal.
8. **Escape cancels:** Open link modal → press Escape → modal closes, no link created.
9. **Invalid URL:** Enter `javascript:alert(1)` → inline error appears, Apply blocked.
10. **Blur guard:** Click Edit in popover → modal opens → contenteditable does not lose edit mode.

- [ ] **Step 3: Final commit if any fixes were needed**

Only if manual testing revealed issues that required code changes.
