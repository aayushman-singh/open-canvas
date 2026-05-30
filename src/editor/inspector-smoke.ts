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
  'function mountFormFields(element, host) {',
  '// buildEmbedInspector + buildCodeInspector migrated to INSPECTOR_DISPATCH',
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
  renderInspector.includes('const inspectorSpec = INSPECTOR_DISPATCH[element.type];') &&
    renderInspector.includes('renderInspectorSpec(inspectorSpec, element);') &&
    !renderInspector.includes('const inspectorBuilders = {'),
  'element inspector routing must use INSPECTOR_DISPATCH directly, without the legacy named-helper branch',
);

const inspectorInterpreter = sliceBetween(
  'function renderInspectorSpec(spec, element) {',
  '// Purpose-built editor for the ActionHref DU',
);

assert(
  inspectorInterpreter.includes('if (f.emptyOmits && ti.value.length === 0)') &&
    inspectorInterpreter.includes('delete element[f.path];'),
  'text inspector fields with emptyOmits must delete optional element keys',
);
assert(
  inspectorInterpreter.includes('if (!f.noRebuild) rebuildElement(element.id);'),
  'text inspector fields with noRebuild must skip rebuildElement while still saving',
);

const accordionInspector = sliceBetween(
  'function mountAccordionItems(element, host) {',
  '// buildCarouselInspector migrated to INSPECTOR_DISPATCH',
);

assert(
  accordionInspector.includes('function wireAccordionToolbarButton(button, command) {') &&
    accordionInspector.includes('button.addEventListener("mousedown", function(ev) {') &&
    accordionInspector.includes('ev.preventDefault();') &&
    accordionInspector.includes('document.execCommand(command);'),
  'accordion rich-text toolbar must preserve the contenteditable selection before execCommand',
);

const tableInspector = sliceBetween(
  'function mountTableGrid(element, host) {',
  '// buildNavInspector migrated to INSPECTOR_DISPATCH',
);

assert(
  tableInspector.includes('host.appendChild(field("Data", gridHost));') &&
    !tableInspector.includes('inspector.appendChild(field("Zebra striping"') &&
    !tableInspector.includes('inspector.appendChild(field("Collapse on phone"'),
  'table inspector grid must mount through custom-mount while simple booleans live in INSPECTOR_DISPATCH',
);

const navInspector = sliceBetween(
  'function mountNavLinks(element, host) {',
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

const sectionInspector = sliceBetween(
  'function renderSectionInspector() {',
  '// -- Page inspector',
);

assert(
  sectionInspector.includes(
    'var roleSel = selectInput(selectableSectionRoles(section), section.role || "body");',
  ) &&
    !sectionInspector.includes(
      'var roleSel = selectInput(["body", "header", "footer"], section.role || "body");',
    ),
  'section role selector must only expose roles valid for the selected section position',
);
assert(
  source.includes('function selectableSectionRoles(section) {') &&
    source.includes('var sectionInfo = findCurrentPageSectionInfo(section.id);') &&
    source.includes('sectionInfo.index === 0') &&
    source.includes('sectionInfo.index === sectionInfo.page.sections.length - 1'),
  'section role options must be derived from page index and existing page roles',
);

const newPageModal = sliceBetween(
  'function openNewPageModal(opts) {',
  'function openAlertModal(opts) {',
);

assert(
  newPageModal.includes('{ value: "zh-CN", label: "zh-CN (Chinese simplified)" }') &&
    !newPageModal.includes('zh-Hans'),
  'new-page locale picker must use the locale grammar accepted by the router',
);

console.log('[inspector:smoke] OK');
