import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[film-reel:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'editor', 'canvas-client.ts'), 'utf8');
const styles = readFileSync(join(process.cwd(), 'src', 'editor', 'canvas-styles.ts'), 'utf8');

assert(
  source.includes('function pointInsideRect('),
  'section drag target detection must use an explicit viewport-rect bounds check',
);
assert(
  source.includes('if (!pointInsideRect(clientX, clientY, rootRect)) return null;'),
  'section drags released outside the canvas must not produce an implicit canvas drop target',
);
assert(
  !source.includes('if (target.zone === "canvas") { dropLine.hidden = true; return; }'),
  'canvas-to-reel no-op drops must hide the insertion line in both canvas and reel zones',
);

const beginSectionDragStart = source.indexOf('function beginSectionDrag(');
const beginSectionDragGuardEnd = source.indexOf('const sectionEl', beginSectionDragStart);
assert(beginSectionDragStart >= 0, 'canvas client must define beginSectionDrag');
assert(
  beginSectionDragGuardEnd > beginSectionDragStart,
  'beginSectionDrag guard region must be found',
);
const beginSectionDragGuard = source.slice(beginSectionDragStart, beginSectionDragGuardEnd);
assert(
  beginSectionDragGuard.includes('isPinnedSection(section)'),
  'canvas grip drag must refuse header/footer sections before creating a drag ghost',
);

assert(
  source.includes('if (hasFooter && sectionNodes[endIdx]) {'),
  'placement mode must render an insert slot immediately before the footer',
);

assert(
  styles.includes('.rev01-section[data-section-role="header"] .section-grip-handle'),
  'header/footer sections must not show the canvas drag grip affordance',
);

console.log('[film-reel:smoke] OK');
