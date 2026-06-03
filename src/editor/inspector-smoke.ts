import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[inspector:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'editor', 'canvas-client.ts'), 'utf8');
const canvasStyles = readFileSync(join(process.cwd(), 'src', 'editor', 'canvas-styles.ts'), 'utf8');

function sliceBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert(start >= 0, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, `missing ${endNeedle} after ${startNeedle}`);
  return source.slice(start, end);
}

const clonePatchPrevHelper = sliceBetween(
  'function clonePatchPrev(target, patch) {',
  '  // Pre-state inverse',
);
const inverseHelpers = sliceBetween(
  'function clonePatchPrev(target, patch) {',
  '// Resolve the canvas node the op points at',
);
assert(
  clonePatchPrevHelper.includes('prev.__deleteFields = deletes;') &&
    !clonePatchPrevHelper.includes(': null;') &&
    inverseHelpers.includes(
      'function resolveDeferredInverse(originalOp, pre, post, consumedIds)',
    ) &&
    inverseHelpers.includes('consumedIds.elements') &&
    inverseHelpers.includes('consumedIds.sections') &&
    inverseHelpers.includes('consumedIds.pages'),
  'chat revert inverse helpers must delete absent optional fields explicitly and consume new ids across accept-all batches',
);

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

assert(
  canvasStyles.includes('[data-opencanvas-tab-panel-id]:not([data-tab-active])') &&
    canvasStyles.includes('scroll-snap-type:x mandatory'),
  'editor canvas styles must include tabs panel hiding and scroll-snap carousel rules',
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

const actionHrefField = sliceBetween(
  'function renderActionHrefField(f, element) {',
  '// Action handler + busy-flag registries',
);
assert(
  actionHrefField.includes('delete element.behavior;') &&
    actionHrefField.includes('setActionHref({ type: "external", url: urlInput.value });') &&
    actionHrefField.includes('setActionHref({ type: "page", pageId: pageSelect.value });'),
  'action href inspector must clear behavior when writing href so ActionElement stays one-of',
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

const collectionBody = sliceBetween(
  'function buildCollectionBody(element) {',
  'function buildTabsBody(element) {',
);
assert(
  collectionBody.includes('card.appendChild(buildElementNode(entry[j]));') &&
    !collectionBody.includes('child.appendChild(buildElementBody(entry[j]));'),
  'collection preview children must render as full opencanvas-element wrappers so nested editing can select them',
);

const tabsBody = sliceBetween(
  'function buildTabsBody(element) {',
  'function buildElementBody(element) {',
);
assert(
  tabsBody.includes('panel.appendChild(buildElementNode(children[i]));') &&
    !tabsBody.includes('childWrap.appendChild(buildElementBody(children[i]));'),
  'tabs panel children must render as full opencanvas-element wrappers so nested editing can select them',
);

const sidebarInsert = sliceBetween(
  'function insertElementForSidebarCommand(section, commandKey) {',
  'const STYLE_KITS =',
);
assert(
  sidebarInsert.includes('z: nextZInArray(nestedTarget.elements),'),
  'nested sidebar inserts must choose z from sibling max-z, not elements.length',
);

const elementMenu = sliceBetween(
  'function buildElementMenu(element, section, wrapper) {',
  'function toggleElementMenu(elementId, wrapper) {',
);
assert(
  elementMenu.includes('var arr = parentArrayFor(section, element);') &&
    !elementMenu.includes('section.elements.push(copy);'),
  'element context-menu duplicate must insert into the immediate parent array, not always section.elements',
);

const zOrderHelpers = sliceBetween(
  '// -- Z-order + reading-order helpers',
  'function moveInReadingOrder(section, element, direction) {',
);
assert(
  zOrderHelpers.includes('throw new Error("parentArrayFor: element "') &&
    zOrderHelpers.includes('const arr = parentArrayFor(section, element);') &&
    zOrderHelpers.includes('bringToFront(arr, element)') &&
    zOrderHelpers.includes('renormalizeZ(arr);'),
  'z-order helpers must fail loudly on missing parent arrays and operate on nested siblings, not only section.elements',
);

const duplicateElement = sliceBetween(
  'function duplicateElement(section, element) {',
  'function deleteElement(section, element) {',
);
assert(
  duplicateElement.includes('clone.box.z = nextZInArray(arr);'),
  'inspector duplicate must assign z from the immediate sibling array',
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

const plainTextPaste = sliceBetween(
  'function plainTextToFragmentHtml(plain) {',
  '// Convert arbitrary pasted HTML',
);
assert(
  plainTextPaste.includes('var afterClose = src.charAt(close1 + 1);') &&
    plainTextPaste.includes("!(afterClose >= '0' && afterClose <= '9')"),
  'plain-text paste must not parse currency-like "$5 + $3" as inline math',
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

const pageInspector = sliceBetween(
  'function renderPageInspector() {',
  '// Live-apply page-level visual properties',
);

assert(
  !pageInspector.includes('page.title = "";') && pageInspector.includes('page.title = page.slug;'),
  'clearing a page title must persist the schema-valid slug fallback instead of an empty title',
);

assert(
  source.includes('var target = ev.target;') &&
    source.includes('target instanceof Element') &&
    source.includes('!viewport.contains(target)'),
  'Figma-style mouse-follow presence must only publish moves over the canvas viewport',
);

const aiMediaModal = sliceBetween(
  'function openAiMediaModal(opts) {',
  '// Modal for the "+ New Page" flow',
);

assert(
  aiMediaModal.includes('var closed = false;') &&
    aiMediaModal.includes('closed = true;') &&
    aiMediaModal.includes('if (closed) return;'),
  'AI media modal must ignore async generation results after cancel/close',
);
assert(
  !aiMediaModal.includes('liveTiles[index] = null;'),
  'AI media modal must revoke the chosen tile object URL because preview creates its own URL',
);

console.log('[inspector:smoke] OK');
