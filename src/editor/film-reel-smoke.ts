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
  source.includes("querySelectorAll('[data-rev01-section]:not([data-section-role])')") &&
    source.includes('lastNode.parentNode.insertBefore(makeSlot(sections.length), afterLast);'),
  'placement mode must render body insert slots without treating header/footer as body sections',
);

assert(
  styles.includes('.rev01-section[data-section-role="header"] .section-grip-handle'),
  'header/footer sections must not show the canvas drag grip affordance',
);

const buildElementNodeStart = source.indexOf('function buildElementNode(element) {');
const buildElementNodeEnd = source.indexOf('function rebuildElement(elementId)', buildElementNodeStart);
assert(buildElementNodeStart >= 0, 'canvas client must define buildElementNode');
assert(buildElementNodeEnd > buildElementNodeStart, 'buildElementNode body must be found');
const buildElementNodeSource = source.slice(buildElementNodeStart, buildElementNodeEnd);
assert(
  buildElementNodeSource.includes('applyElementStyle(wrapper, element);'),
  'editor preview element builder must apply elementStyle to the wrapper',
);
assert(
  buildElementNodeSource.indexOf('applyElementStyle(wrapper, element);') >
    buildElementNodeSource.indexOf('setBoxStyle(wrapper, element.box);') &&
    buildElementNodeSource.indexOf('applyElementStyle(wrapper, element);') <
      buildElementNodeSource.indexOf('applyPinnedStyle(wrapper, element);'),
  'editor preview must apply elementStyle after box styles and before pinnedStyle',
);

assert(
  source.includes('element.elementStyle = es;'),
  'style inspector must reattach elementStyle after the last property was removed and a new property is set',
);

console.log('[film-reel:smoke] OK');
