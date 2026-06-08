// src/editor-client/selection.smoke.ts
//
// ADR 0063 dec 6 — pins the click-bubbling behaviour that routes clicks
// inside a Collection's rendered DOM to the Collection element instead
// of the inner clicked node.
//
// ADR 0065 dec 7 — pins the inversion of that rule when the editor is
// actively editing a specific Collection's custom template. Inside that
// Collection's template the clicked child element is selected directly;
// clicks inside any OTHER Collection still bubble to that Collection.
//
// Coverage:
//   (1) A click on an inner card element (data-element-type="container")
//       nested under data-element-type="collection" resolves to the
//       Collection's element-id.
//   (2) A click on the Collection wrapper itself resolves to its own id.
//   (3) A click on an element with data-element-type !== "collection"
//       and no Collection ancestor returns null (let the default
//       resolveElementWrapperAtPoint result stand).
//   (4) A click on a nested element with a non-collection ancestor
//       FIRST (e.g. container > inner) returns null even if there's a
//       Collection above the container — first data-element-type
//       ancestor wins, mirroring Tabs / Carousel.
//   (5) Click target is null → returns null (defensive, no throw).
//   (6) Source guard — canvas-root-events.ts imports the helper and
//       calls it before falling through to the default selectElement
//       branch.
//   (7) ADR 0065 D7 — null edit-state preserves D6 behaviour
//       (regression coverage when callers pass an explicit null).
//   (8) ADR 0065 D7 — editing THIS Collection's template short-circuits
//       the bubble, returning null so the default selection picks the
//       clicked child element directly.
//   (9) ADR 0065 D7 — editing a DIFFERENT Collection's template still
//       bubbles for an unrelated Collection (per-Collection scoping).
//  (10) ADR 0065 D7 — click outside any Collection while edit mode is
//       active behaves like edit mode were off (D7 only affects clicks
//       under the actively-edited Collection).
//  (11) ADR 0065 D7 failure path — editingCollectionTemplate.collectionId
//       references a missing Collection: helper degrades to plain D6
//       behaviour, no crash. The next render-pass clears the field per
//       the ADR; selection in the meantime acts as if the field were null.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[selection:smoke] ' + message);
}

// ---- Stub DOM ----------------------------------------------------------

interface StubEl {
  tagName: string;
  attrs: Map<string, string>;
  children: StubEl[];
  parentNode: StubEl | null;
  parentElement: StubEl | null;
  appendChild(c: StubEl): StubEl;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
}

function makeEl(tagName: string): StubEl {
  const el: StubEl = {
    tagName: tagName.toUpperCase(),
    attrs: new Map(),
    children: [],
    parentNode: null,
    parentElement: null,
    appendChild(c: StubEl): StubEl {
      this.children.push(c);
      c.parentNode = this;
      c.parentElement = this;
      return c;
    },
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    },
    getAttribute(name: string): string | null {
      return this.attrs.has(name) ? this.attrs.get(name)! : null;
    },
  };
  return el;
}

// Install HTMLElement / Element / document so the import succeeds and
// `instanceof HTMLElement` resolves true for StubEl instances.
const g = globalThis as unknown as Record<string, unknown>;
g.document = { createElement: makeEl };
g.HTMLElement = class HTMLElement {
  constructor() {
    throw new Error('stub HTMLElement is never instantiated');
  }
};
g.Element = class Element {
  constructor() {
    throw new Error('stub Element is never instantiated');
  }
};
const matchEverything = (instance: unknown): boolean =>
  typeof instance === 'object' &&
  instance !== null &&
  'tagName' in (instance as Record<string, unknown>) &&
  'attrs' in (instance as Record<string, unknown>);
Object.defineProperty(g.HTMLElement, Symbol.hasInstance, { value: matchEverything });
Object.defineProperty(g.Element, Symbol.hasInstance, { value: matchEverything });

const { resolveCollectionAncestorForClick } = await import('./selection.js');

// (1) Click on inner element inside a Collection wrapper.
{
  const collectionWrapper = makeEl('div');
  collectionWrapper.setAttribute('data-element-type', 'collection');
  collectionWrapper.setAttribute('data-opencanvas-element', 'coll-1');
  const innerFrame = makeEl('div');
  innerFrame.setAttribute('class', 'opencanvas-collection');
  collectionWrapper.appendChild(innerFrame);
  const cardImage = makeEl('div');
  cardImage.setAttribute('class', 'opencanvas-collection-preview-card-image');
  innerFrame.appendChild(cardImage);

  const result = resolveCollectionAncestorForClick(cardImage as never);
  assert(
    result === 'coll-1',
    '(1) click on inner card inside Collection must resolve to Collection id but got: ' + result,
  );
}

// (2) Click on the Collection wrapper itself.
{
  const collectionWrapper = makeEl('div');
  collectionWrapper.setAttribute('data-element-type', 'collection');
  collectionWrapper.setAttribute('data-opencanvas-element', 'coll-2');

  const result = resolveCollectionAncestorForClick(collectionWrapper as never);
  assert(
    result === 'coll-2',
    '(2) click directly on Collection must resolve to its own id but got: ' + result,
  );
}

// (3) Click on a non-collection element with no collection ancestor.
{
  const textWrapper = makeEl('div');
  textWrapper.setAttribute('data-element-type', 'text');
  textWrapper.setAttribute('data-opencanvas-element', 'text-1');
  const span = makeEl('span');
  textWrapper.appendChild(span);

  const result = resolveCollectionAncestorForClick(span as never);
  assert(
    result === null,
    '(3) click on text-with-no-collection-ancestor must return null but got: ' + result,
  );
}

// (4) Click on a Container element nested inside a Collection: the
// closest data-element-type ancestor is the Container, NOT the Collection.
// The helper returns null so the default resolveElementWrapperAtPoint
// result wins. (This case represents authoring intent: even inside a
// Collection's grid, an outer Container with its own data-element-type
// is itself an authorable element and should be selected directly.)
{
  const collectionWrapper = makeEl('div');
  collectionWrapper.setAttribute('data-element-type', 'collection');
  collectionWrapper.setAttribute('data-opencanvas-element', 'coll-4');
  const containerWrapper = makeEl('div');
  containerWrapper.setAttribute('data-element-type', 'container');
  containerWrapper.setAttribute('data-opencanvas-element', 'cont-4');
  collectionWrapper.appendChild(containerWrapper);
  const innerSpan = makeEl('span');
  containerWrapper.appendChild(innerSpan);

  const result = resolveCollectionAncestorForClick(innerSpan as never);
  assert(
    result === null,
    '(4) first data-element-type ancestor (container) wins; helper must return null but got: ' +
      result,
  );
}

// (5) Click target is null.
{
  const result = resolveCollectionAncestorForClick(null);
  assert(result === null, '(5) null click target must return null');
}

// (6) Source guard — canvas-root-events.ts imports + uses the helper.
const canvasRootSrc = await Bun.file(new URL('./canvas-root-events.ts', import.meta.url)).text();
assert(
  canvasRootSrc.includes('import { resolveCollectionAncestorForClick }'),
  '(6) canvas-root-events.ts must import resolveCollectionAncestorForClick',
);
assert(
  canvasRootSrc.includes('resolveCollectionAncestorForClick(target, ctx.editingCollectionTemplate)'),
  '(6) canvas-root-events.ts must call resolveCollectionAncestorForClick(target, ctx.editingCollectionTemplate) in click handler',
);
// The Collection-ancestor branch must run BEFORE the normal selectElement
// fallback — otherwise inner-card clicks select the inner element first.
const callIdx = canvasRootSrc.indexOf(
  'resolveCollectionAncestorForClick(target, ctx.editingCollectionTemplate)',
);
const fallbackIdx = canvasRootSrc.indexOf(
  'if (id !== ctx.selectedElementId) ctx.selectElement(id);',
);
assert(callIdx > 0 && fallbackIdx > 0, '(6) markers must exist in canvas-root-events.ts');
assert(
  callIdx < fallbackIdx,
  '(6) Collection-ancestor selection must run BEFORE the default selectElement(id) fallback',
);

// (7) ADR 0065 D7 — explicit null edit-state matches default D6 behaviour.
{
  const collectionWrapper = makeEl('div');
  collectionWrapper.setAttribute('data-element-type', 'collection');
  collectionWrapper.setAttribute('data-opencanvas-element', 'coll-A');
  const innerFrame = makeEl('div');
  collectionWrapper.appendChild(innerFrame);
  const cardChild = makeEl('div');
  cardChild.setAttribute('class', 'opencanvas-collection-preview-card-image');
  innerFrame.appendChild(cardChild);

  const result = resolveCollectionAncestorForClick(cardChild as never, null);
  assert(
    result === 'coll-A',
    '(7) editingCollectionTemplate === null must preserve D6 bubble; got: ' + result,
  );
}

// (8) ADR 0065 D7 — editing THIS Collection's template: click on its
// template child falls through (helper returns null) so the default
// selectElement path picks the clicked child.
{
  const collectionWrapper = makeEl('div');
  collectionWrapper.setAttribute('data-element-type', 'collection');
  collectionWrapper.setAttribute('data-opencanvas-element', 'coll-A');
  const innerFrame = makeEl('div');
  collectionWrapper.appendChild(innerFrame);
  const templateChild = makeEl('div');
  templateChild.setAttribute('class', 'opencanvas-text');
  innerFrame.appendChild(templateChild);

  const result = resolveCollectionAncestorForClick(templateChild as never, {
    collectionId: 'coll-A',
  });
  assert(
    result === null,
    '(8) editing template of clicked Collection must invert bubble to null; got: ' + result,
  );
}

// (9) ADR 0065 D7 — per-Collection scoping: editing Collection A's
// template does NOT affect clicks landing inside Collection B.
{
  const otherCollectionWrapper = makeEl('div');
  otherCollectionWrapper.setAttribute('data-element-type', 'collection');
  otherCollectionWrapper.setAttribute('data-opencanvas-element', 'coll-B');
  const innerFrame = makeEl('div');
  otherCollectionWrapper.appendChild(innerFrame);
  const cardChild = makeEl('div');
  cardChild.setAttribute('class', 'opencanvas-collection-preview-card-image');
  innerFrame.appendChild(cardChild);

  const result = resolveCollectionAncestorForClick(cardChild as never, {
    collectionId: 'coll-A',
  });
  assert(
    result === 'coll-B',
    '(9) editing coll-A must NOT affect bubble inside coll-B; got: ' + result,
  );
}

// (10) ADR 0065 D7 — click outside any Collection while edit mode is
// active behaves identically to edit mode being off.
{
  const textWrapper = makeEl('div');
  textWrapper.setAttribute('data-element-type', 'text');
  textWrapper.setAttribute('data-opencanvas-element', 'text-1');
  const span = makeEl('span');
  textWrapper.appendChild(span);

  const result = resolveCollectionAncestorForClick(span as never, { collectionId: 'coll-A' });
  assert(
    result === null,
    '(10) edit mode active but click outside any Collection must return null; got: ' + result,
  );
}

// (11) ADR 0065 D7 failure path — editingCollectionTemplate references a
// Collection that no longer exists in the DOM (e.g. concurrent
// deletion). The walk never matches, so the helper degrades to plain D6
// bubble — no crash, no zombie selection of nothing.
{
  const collectionWrapper = makeEl('div');
  collectionWrapper.setAttribute('data-element-type', 'collection');
  collectionWrapper.setAttribute('data-opencanvas-element', 'coll-A');
  const innerFrame = makeEl('div');
  collectionWrapper.appendChild(innerFrame);
  const cardChild = makeEl('div');
  innerFrame.appendChild(cardChild);

  const result = resolveCollectionAncestorForClick(cardChild as never, {
    collectionId: 'deleted-id',
  });
  assert(
    result === 'coll-A',
    '(11) deleted-id edit-state must fall through to D6 bubble; got: ' + result,
  );
}

console.log('[selection:smoke] OK');
