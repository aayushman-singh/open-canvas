// src/editor-client/mark-toolbar-color.smoke.ts
//
// Pins the selection-range → InlineRun[] mapping that the mark-toolbar's
// colour picker drives, fixing the original bug where the picker
// recoloured the whole TextElement instead of the selected range.
//
// The function under test (`setColorOnRuns`) is the pure step inside
// `applyColorMark`: given the serialized InlineRun[] and the [start, end)
// character bounds the active DOM Selection maps to, return the new
// InlineRun[] with the colour mark applied to exactly that slice.
//
// Coverage:
//   1. Partial selection ("Hello world", [6, 11) "world") splits the run
//      at the boundary and applies the colour only to the trailing slice.
//   2. Whole-text selection lands the colour on every run, preserving
//      pre-existing marks (bold/italic etc.) on each run.
//   3. Caret-only selection (start === end) is a no-op — matches
//      bold/italic's collapsed-range behaviour.
//   4. Adjacent runs with identical mark sets coalesce after the colour
//      applies (three same-colour runs collapse to one).
//   5. color=null clears any existing colour in the slice.
//   6. Replacing a colour in a partial slice splits the run at the slice
//      boundary and applies the NEW colour only to the inside — the
//      outside keeps its original colour.
//
// Run with `bun run mark-toolbar-color:smoke`. Bun has no `document`,
// so the function under test is exercised directly — no DOM stand-in
// needed. The single dependency on the editor context is `marksEqual`
// (used by the coalescing pass); we pass a small real implementation
// rather than a mock so the assertions reflect production behaviour.

import type { InlineMark, InlineRun } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import { setColorOnRuns } from './mark-toolbar.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[mark-toolbar-color:smoke] ${message}`);
}

// Real `marksEqual` semantics, narrowed to the fields we exercise here.
// Production lives in `mark-serialize.ts`; this mirror keeps the smoke
// free of imports that drag the full editor surface into the test boot.
function marksEqualImpl(a: InlineMark[], b: InlineMark[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (!ai || !bi) return false;
    if (ai.type !== bi.type) return false;
    if (ai.type === 'link' && bi.type === 'link') {
      if (ai.href !== bi.href) return false;
      if ((ai.target || '') !== (bi.target || '')) return false;
    }
    if (ai.type === 'fontSize' && bi.type === 'fontSize' && ai.px !== bi.px) {
      return false;
    }
    if (ai.type === 'color' && bi.type === 'color' && ai.color !== bi.color) {
      return false;
    }
  }
  return true;
}

const stubCtx = { marksEqual: marksEqualImpl } as unknown as EditorContext;

// ---------------------------------------------------------------------------
// (1) "Hello world" → select [6, 11) ("world") → run splits, colour applies
//     only to the trailing slice.
// ---------------------------------------------------------------------------

{
  const runs: InlineRun[] = [{ text: 'Hello world' }];
  const next = setColorOnRuns(stubCtx, runs, 6, 11, '#ff6600');
  assert(
    next.length === 2,
    `(1) partial selection splits into 2 runs (got ${String(next.length)}: ${JSON.stringify(next)})`,
  );
  assert(
    next[0]!.text === 'Hello ',
    `(1) first run keeps the leading slice (got ${JSON.stringify(next[0])})`,
  );
  assert(
    next[1]!.text === 'world',
    `(1) second run carries the coloured slice (got ${JSON.stringify(next[1])})`,
  );
  assert(
    !next[0]!.marks || !next[0]!.marks.some((m) => m.type === 'color'),
    `(1) leading slice must NOT carry the color mark (got ${JSON.stringify(next[0])})`,
  );
  const colored = next[1]!.marks?.find((m) => m.type === 'color');
  assert(
    colored !== undefined && colored.type === 'color' && colored.color === '#ff6600',
    `(1) trailing slice must carry color #ff6600 (got ${JSON.stringify(next[1])})`,
  );
}

// ---------------------------------------------------------------------------
// (2) Whole-text selection — every run carries the colour mark; pre-existing
//     marks on each run survive.
// ---------------------------------------------------------------------------

{
  const runs: InlineRun[] = [
    { text: 'Hello ' },
    { text: 'world', marks: [{ type: 'bold' }] },
  ];
  const total = runs.reduce((sum, r) => sum + r.text.length, 0);
  const next = setColorOnRuns(stubCtx, runs, 0, total, '#0000ff');
  assert(
    next.length === 2,
    `(2) whole-text selection keeps the two source runs (got ${String(next.length)})`,
  );
  for (let i = 0; i < next.length; i++) {
    const colored = next[i]!.marks?.find((m) => m.type === 'color');
    assert(
      colored !== undefined && colored.type === 'color' && colored.color === '#0000ff',
      `(2) run[${String(i)}] must carry color #0000ff (got ${JSON.stringify(next[i])})`,
    );
  }
  assert(
    next[1]!.marks!.some((m) => m.type === 'bold'),
    '(2) pre-existing bold mark must survive the colour application',
  );
}

// ---------------------------------------------------------------------------
// (3) Caret-only (start === end) — function returns unchanged runs.
//     Matches bold/italic behavior for collapsed ranges.
// ---------------------------------------------------------------------------

{
  const runs: InlineRun[] = [{ text: 'Hello world' }];
  const next = setColorOnRuns(stubCtx, runs, 5, 5, '#ff6600');
  assert(
    next.length === 1,
    `(3) caret-only selection leaves run count unchanged (got ${String(next.length)})`,
  );
  assert(next[0]!.text === 'Hello world', '(3) caret-only selection leaves text intact');
  assert(
    !next[0]!.marks || !next[0]!.marks.some((m) => m.type === 'color'),
    `(3) caret-only selection must NOT apply a colour mark (got ${JSON.stringify(next[0])})`,
  );
}

// ---------------------------------------------------------------------------
// (4) Adjacent runs with identical mark sets coalesce after the colour
//     mark applies.
// ---------------------------------------------------------------------------

{
  const runs: InlineRun[] = [{ text: 'aaa' }, { text: 'bbb' }, { text: 'ccc' }];
  const next = setColorOnRuns(stubCtx, runs, 0, 9, '#ff0000');
  assert(
    next.length === 1,
    `(4) three same-colour runs coalesce into one (got ${String(next.length)}: ${JSON.stringify(next)})`,
  );
  assert(
    next[0]!.text === 'aaabbbccc',
    `(4) coalesced text matches concatenation (got ${JSON.stringify(next[0])})`,
  );
  const colored = next[0]!.marks?.find((m) => m.type === 'color');
  assert(
    colored !== undefined && colored.type === 'color' && colored.color === '#ff0000',
    '(4) coalesced run carries the single colour mark',
  );
}

// ---------------------------------------------------------------------------
// (5) color=null clears any existing colour in the slice.
// ---------------------------------------------------------------------------

{
  const runs: InlineRun[] = [
    { text: 'Hello ' },
    { text: 'world', marks: [{ type: 'color', color: '#ff6600' }] },
  ];
  const total = runs.reduce((sum, r) => sum + r.text.length, 0);
  const next = setColorOnRuns(stubCtx, runs, 0, total, null);
  assert(
    next.length === 1,
    `(5) clearing all colour coalesces into one run (got ${String(next.length)}: ${JSON.stringify(next)})`,
  );
  assert(next[0]!.text === 'Hello world', '(5) clearing preserves the concatenated text');
  assert(
    !next[0]!.marks || !next[0]!.marks.some((m) => m.type === 'color'),
    `(5) color mark must be cleared (got ${JSON.stringify(next[0])})`,
  );
}

// ---------------------------------------------------------------------------
// (6) Replacing a colour in a partial slice splits the run at the slice
//     boundary and applies the NEW colour only to the inside.
// ---------------------------------------------------------------------------

{
  const runs: InlineRun[] = [
    { text: 'red text', marks: [{ type: 'color', color: '#ff0000' }] },
  ];
  // Recolour offsets [4, 8) ("text") to blue.
  const next = setColorOnRuns(stubCtx, runs, 4, 8, '#0000ff');
  assert(
    next.length === 2,
    `(6) partial recolour splits into 2 runs (got ${String(next.length)}: ${JSON.stringify(next)})`,
  );
  assert(
    next[0]!.text === 'red ',
    `(6) leading slice text "red " (got ${JSON.stringify(next[0])})`,
  );
  assert(
    next[1]!.text === 'text',
    `(6) trailing slice text "text" (got ${JSON.stringify(next[1])})`,
  );
  const leadColor = next[0]!.marks?.find((m) => m.type === 'color');
  const trailColor = next[1]!.marks?.find((m) => m.type === 'color');
  assert(
    leadColor !== undefined && leadColor.type === 'color' && leadColor.color === '#ff0000',
    `(6) leading slice keeps original red (got ${JSON.stringify(next[0])})`,
  );
  assert(
    trailColor !== undefined && trailColor.type === 'color' && trailColor.color === '#0000ff',
    `(6) trailing slice carries the new blue (got ${JSON.stringify(next[1])})`,
  );
}

console.log('[mark-toolbar-color:smoke] OK');
