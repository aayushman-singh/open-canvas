// src/editor-client/inspector-action-buttons.ts
//
// ADR 0058 Phase 2h.1.a — DOM builders for the inspector element-action
// cluster. Wrap the verbs in ./inspector-actions.js in HTMLElement
// scaffolding. Split from inspector-actions.ts because builders cannot
// be smoke-tested under bare Bun (no `document` global); the smoke's
// structural inability to cover them proves the responsibilities differ.

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import {
  applyZOrderAction,
  deleteElement,
  duplicateElement,
  moveInReadingOrder,
  parentArrayFor,
  type ZOrderAction,
} from './inspector-actions.js';

export function buildReorderGroup(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'opencanvas-reorder-buttons';
  const arr = parentArrayFor(ctx, section, element);
  const idx = arr.indexOf(element);
  const total = arr.length;
  const caption = document.createElement('div');
  caption.className = 'opencanvas-reorder-caption';
  caption.textContent = 'Reading order: ' + (idx + 1) + ' of ' + total;

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.textContent = 'Move up in reading order';
  upBtn.disabled = idx <= 0;
  upBtn.addEventListener('click', () => {
    moveInReadingOrder(ctx, section, element, -1);
  });

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.textContent = 'Move down in reading order';
  downBtn.disabled = idx >= total - 1;
  downBtn.addEventListener('click', () => {
    moveInReadingOrder(ctx, section, element, 1);
  });

  group.appendChild(upBtn);
  group.appendChild(downBtn);

  const wrap = document.createElement('div');
  wrap.appendChild(caption);
  wrap.appendChild(group);
  return wrap;
}

export function buildZOrderGroup(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'opencanvas-zorder-buttons';
  const defs: { label: string; action: ZOrderAction }[] = [
    { label: 'Bring to front', action: 'front' },
    { label: 'Send to back', action: 'back' },
    { label: 'Forward', action: 'forward' },
    { label: 'Backward', action: 'backward' },
  ];
  for (let i = 0; i < defs.length; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const def = defs[i];
    if (!def) continue;
    btn.textContent = def.label;
    const action = def.action;
    btn.addEventListener('click', () => {
      applyZOrderAction(ctx, section, element, action);
    });
    group.appendChild(btn);
  }
  return group;
}

// Section-level Duplicate/Delete live in the section toolbar; this
// group surfaces the same verbs for elements so Owners don't have to
// remember a keyboard shortcut (Delete still works for deletion).
export function buildElementActionsGroup(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'opencanvas-zorder-buttons';
  const dup = document.createElement('button');
  dup.type = 'button';
  dup.textContent = 'Duplicate';
  dup.addEventListener('click', () => {
    duplicateElement(ctx, section, element);
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = 'Delete';
  del.addEventListener('click', () => {
    deleteElement(ctx, section, element);
  });
  group.appendChild(dup);
  group.appendChild(del);
  return group;
}
