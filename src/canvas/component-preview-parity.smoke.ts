// src/canvas/component-preview-parity.smoke.ts
//
// Guards the editor preview against drifting from the published component
// contract for interactive components whose CSS depends on wrapper metadata
// and published DOM class names.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canvasEditorStyles } from '../editor-client/styles-build.js';

const here = dirname(fileURLToPath(import.meta.url));
const editorClientDir = join(here, '../editor-client');
const elementMenuSrc = readFileSync(join(editorClientDir, 'element-menu.ts'), 'utf8');
const bodyBuildersSrc = readFileSync(join(editorClientDir, 'body-builders-data.ts'), 'utf8');
const generatedEditorStyles = readFileSync(join(editorClientDir, 'styles.css'), 'utf8');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[component-preview-parity:smoke] ${message}`);
}

for (const type of ['form', 'accordion', 'carousel', 'tabs']) {
  assert(
    elementMenuSrc.includes(`element.type === '${type}'`),
    `editor wrapper must mirror published data-variant for ${type}`,
  );
}

for (const cls of [
  'opencanvas-accordion',
  'opencanvas-accordion-item',
  'opencanvas-accordion-header',
  'opencanvas-accordion-body',
]) {
  assert(
    bodyBuildersSrc.includes(cls),
    `editor accordion preview must emit published ${cls} DOM`,
  );
}

assert(
  !bodyBuildersSrc.includes('opencanvas-accordion-preview'),
  'editor accordion preview must not use a private preview-only DOM contract',
);

for (const selector of [
  '.opencanvas-element[data-element-type="accordion"][data-variant="cards"]',
  '.opencanvas-element[data-element-type="tabs"][data-variant="segmented"]',
  '.opencanvas-tabs[data-variant="segmented"] .opencanvas-tab-bar',
]) {
  assert(
    canvasEditorStyles.includes(selector),
    `editor stylesheet must mirror published variant selector ${selector}`,
  );
  assert(
    generatedEditorStyles.includes(selector),
    `generated editor CSS must include published variant selector ${selector}`,
  );
}

console.log('[component-preview-parity:smoke] OK');
