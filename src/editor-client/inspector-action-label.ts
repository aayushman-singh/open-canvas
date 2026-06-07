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

import type { PersistContext, RenderContext } from './editor-context.js';
import type { ActionElement } from '../canvas/elements/action.js';
import { field } from './dom-builders.js';

// ADR 0064 — inspector action-label carve. The mount touches exactly two
// canonical clusters: render (rebuildElement to refresh the action element
// after each keystroke / clear) and persist (scheduleSave to debounce the
// server save on commit). No module-specific verbs, so no inline Pick.
export type InspectorActionLabelContext = RenderContext & PersistContext;

export function mountActionLabel(
  ctx: InspectorActionLabelContext,
  element: ActionElement,
  host: HTMLElement,
): void {
  const firstRun = Array.isArray(element.label) ? element.label[0] : undefined;
  if (!firstRun || typeof firstRun.text !== 'string') {
    throw new Error(
      'mountActionLabel: action element ' +
        element.id +
        ' label must be a non-empty InlineRun[]; validateEditableSite should reject invalid action labels before inspector mount',
    );
  }

  const wrap = document.createElement('div');

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Button label (leave empty for icon-only)';
  input.value = firstRun.text;
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
    // Icon-only is only legitimate when there IS an icon. Refuse the clear
    // when iconKind is unset so the editor never produces an action with no
    // visible content (the validator coerces that state to a "Button" label,
    // which is correct as a safety net but ugly to discover by surprise).
    if (typeof element.iconKind !== 'string' || element.iconKind.length === 0) {
      ctx.setStatus('Pick an icon first — an icon-less button needs visible text.', 'error');
      return;
    }
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
