// src/editor-client/inspector-action-label.ts
//
// Inspector field mount for the action element's `label: InlineRun[]`.
// Renders a single-line `<input>` bound to `element.label[0].text` plus a
// Clear affordance that collapses the label to `[{text:''}]` (the
// at-rest icon-only contract — the validator rejects an empty array but
// the renderer skips emitting the `<span>` when every run has empty text).
//
// Why a v1 single-run input rather than a full InlineRun[] editor:
//   - The labels users actually type are short and unstyled. The on-canvas
//     RTE doesn't have an inline entry point for action labels today, so
//     before this mount the only way to edit "Action" was the agent tool.
//   - When a SECOND element wants a label input (e.g. tabs already use
//     InlineRun[] labels — see ADR 0058), generalize then.
//
// Backward compat:
//   - The label is always at-rest as `InlineRun[]` per ADR 0051 dec 1 and
//     the 2026-06-02 string -> InlineRun[] migration. This mount never
//     reads or writes the legacy string shape — the migrator handles old
//     records before they reach the inspector.
//   - When the existing first run carries marks (e.g. bold from the agent
//     tool), typing in the input only rewrites `.text` so the marks are
//     preserved. The Clear button strips marks because "icon-only" should
//     not leave a bold-empty run lying around.

import type { EditorContext } from './editor-context.js';
import type { ActionElement } from '../canvas/elements/action.js';
import { field } from './dom-builders.js';

export function mountActionLabel(
  ctx: EditorContext,
  element: ActionElement,
  host: HTMLElement,
): void {
  if (!Array.isArray(element.label) || element.label.length === 0) {
    // Defensive: at-rest the validator rejects an empty array, so this
    // branch only fires if a custom-mount handler is invoked on a record
    // that bypassed validation (e.g. an in-flight migration). Seed with
    // one empty run so the input has something to bind to.
    element.label = [{ text: '' }];
  }

  const wrap = document.createElement('div');

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Button label (leave empty for icon-only)';
  input.value = element.label[0]!.text;
  input.addEventListener('input', () => {
    // Live update on every keystroke so the canvas preview matches what
    // the user is typing. Only the first run's .text changes; marks on
    // run 0 (and any subsequent runs) are preserved. The agent tool
    // overwrites the full InlineRun[] when it wants to install marks.
    element.label[0]!.text = input.value;
    ctx.rebuildElement(element.id);
  });
  input.addEventListener('change', () => {
    // Debounced server save on commit (blur or Enter). Tracks the
    // existing inspector .change() convention so undo snapshots line up
    // with the user's logical "done editing" moments.
    ctx.scheduleSave();
  });

  wrap.appendChild(field('Label', input));

  const clearRow = document.createElement('div');
  clearRow.style.marginTop = '4px';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear label (icon-only)';
  clearBtn.setAttribute('data-action-label-clear', element.id);
  clearBtn.addEventListener('click', () => {
    // Collapse to single empty run — the at-rest icon-only contract. The
    // renderer skips the `<span>` when every run has empty text. Marks
    // are dropped because an icon-only button should not carry a stale
    // bold/italic on an invisible run.
    element.label = [{ text: '' }];
    input.value = '';
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  clearRow.appendChild(clearBtn);
  wrap.appendChild(clearRow);

  host.appendChild(wrap);
}
