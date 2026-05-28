import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[inspector:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'editor', 'canvas-client.ts'), 'utf8');

function sliceBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert(start >= 0, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, `missing ${endNeedle} after ${startNeedle}`);
  return source.slice(start, end);
}

const formInspector = sliceBetween(
  'function buildFormInspector(element) {',
  'function buildEmbedInspector(element) {',
);

assert(
  !formInspector.includes('f.options = ["Option 1", "Option 2"];'),
  'form inspector must not write select options as strings',
);
assert(
  !formInspector.includes('f.options.push("Option " +'),
  'form inspector must append object-shaped select options',
);
assert(
  formInspector.includes('return { value: label, label: label };') &&
    formInspector.includes('f.options = [formOption("Option 1"), formOption("Option 2")]') &&
    formInspector.includes('value: optInput.value, label: optInput.value'),
  'form inspector select options must match FormFieldDef { value, label } shape',
);

const renderInspector = sliceBetween(
  'function renderInspector() {',
  '// -- Element style controls',
);

assert(
  renderInspector.includes('const inspectorBuilders = {') &&
    renderInspector.includes('const inspectorBuilder = inspectorBuilders[element.type];') &&
    renderInspector.includes('if (inspectorBuilder) inspectorBuilder(element);'),
  'element inspector routing must use the named-helper dispatch table',
);

const accordionInspector = sliceBetween(
  'function buildAccordionInspector(element) {',
  'function buildCarouselInspector(element) {',
);

assert(
  accordionInspector.includes('function wireAccordionToolbarButton(button, command) {') &&
    accordionInspector.includes('button.addEventListener("mousedown", function(ev) {') &&
    accordionInspector.includes('ev.preventDefault();') &&
    accordionInspector.includes('document.execCommand(command);'),
  'accordion rich-text toolbar must preserve the contenteditable selection before execCommand',
);

const navInspector = sliceBetween(
  'function buildNavInspector(element) {',
  '// Revoke any blob URLs',
);

assert(
  navInspector.includes('function validateNavLinkEdit(kind, href) {') &&
    navInspector.includes('Anchor targets must start with #.') &&
    navInspector.includes('if (!validateNavLinkEdit(lnk.kind, hrefInput.value))') &&
    navInspector.includes('hrefInput.value = lnk.href;') &&
    navInspector.includes('if (!validateNavLinkEdit(kindSel.value, lnk.href))') &&
    navInspector.includes('kindSel.value = lnk.kind;'),
  'canvas nav inspector must reject non-fragment hrefs for anchor links',
);

const elementStyleControls = sliceBetween('// -- Element style controls', '// Motion controls.');

assert(
  elementStyleControls.includes('resetBtn.textContent = "Reset all";') &&
    elementStyleControls.includes('delete element.elementStyle;') &&
    elementStyleControls.includes('scheduleSave();'),
  'element style controls must include a Reset all button that deletes elementStyle and persists',
);
assert(
  elementStyleControls.includes('bgImgClear.title = "Clear only the background image override";'),
  'background-image clear button must disclose that it only clears the image override',
);

console.log('[inspector:smoke] OK');
