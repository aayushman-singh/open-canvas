import { injectInteractiveRuntime } from '../interactive/inject.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import type { CanvasElement, PublishedSnapshot } from '../canvas/schema.js';
import {
  validateEditableSite,
  validatePublishedSnapshot,
  validateSeedFixture,
} from '../canvas/validate.js';
import { getTemplateSeed, instantiateTemplate } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[raydotsh-portfolio:smoke] ${message}`);
}

type FidelityStatus = 'native' | 'approximate' | 'missing' | 'omitted';

interface FidelityItem {
  id: string;
  sourceBehaviour: string;
  status: FidelityStatus;
  requiredPrimitive?: string;
}

function collectElementTree(elements: CanvasElement[]): CanvasElement[] {
  const collected: CanvasElement[] = [];
  const visit = (element: CanvasElement): void => {
    collected.push(element);
    if (element.type === 'flow-container') {
      for (const item of element.items) visit(item.element);
    } else if (element.type === 'tabs') {
      for (const tab of element.tabs) {
        for (const child of tab.elements) visit(child);
      }
    }
  };
  for (const element of elements) visit(element);
  return collected;
}

const RAYDOTSH_FIDELITY_LEDGER: FidelityItem[] = [
  {
    id: 'ascii-particle-portrait',
    sourceBehaviour:
      'Canvas ASCII particles assemble into a portrait and repel from pointer/touch input',
    status: 'missing',
    requiredPrimitive: 'Particle Field Rich Motion',
  },
  {
    id: 'typewriter-greeting',
    sourceBehaviour: 'Hero name reveals as an ordered typewriter sequence with a cursor',
    status: 'native',
  },
  {
    id: 'robot-game-overlay',
    sourceBehaviour: 'Game mode toggles a keyboard-controlled collectible platformer overlay',
    status: 'omitted',
    requiredPrimitive: 'Playable Widget ADR',
  },
  {
    id: 'sidebar-anchor-rail',
    sourceBehaviour: 'Desktop slash-styled side rail links to same-page anchors',
    status: 'missing',
    requiredPrimitive: 'Anchor Rail Navigation',
  },
  {
    id: 'scroll-reveal-sequence',
    sourceBehaviour: 'Repeated sections and list items reveal with child-index delays',
    status: 'native',
  },
  {
    id: 'responsive-project-variants',
    sourceBehaviour: 'Projects use desktop spotlight structure and separate mobile card structure',
    status: 'native',
  },
  {
    id: 'cover-grid',
    sourceBehaviour: 'Books render as responsive masonry cover grids with hover lift',
    status: 'approximate',
    requiredPrimitive: 'Cover Grid Recipe',
  },
];

const knownLedgerIds = new Set<string>();
for (const item of RAYDOTSH_FIDELITY_LEDGER) {
  assert(item.id.length > 0, 'fidelity item id must be non-empty');
  assert(!knownLedgerIds.has(item.id), `duplicate fidelity item id ${item.id}`);
  knownLedgerIds.add(item.id);
  assert(item.sourceBehaviour.length > 20, `${item.id} must describe the source behaviour`);
  if (item.status === 'missing' || item.status === 'approximate') {
    assert(
      typeof item.requiredPrimitive === 'string' && item.requiredPrimitive.length > 0,
      `${item.id} must name the primitive that closes the gap`,
    );
  }
}

const missingOrApproximate = RAYDOTSH_FIDELITY_LEDGER.filter(
  (item) => item.status === 'missing' || item.status === 'approximate',
);
assert(missingOrApproximate.length > 0, 'current template must not be reported as faithful yet');
const typewriterLedgerItem = RAYDOTSH_FIDELITY_LEDGER.find(
  (item) => item.id === 'typewriter-greeting',
);
assert(
  typewriterLedgerItem?.status === 'native',
  'Raydotsh typewriter greeting must be recorded as native after binding the primitive',
);

const seed = getTemplateSeed('raydotsh-portfolio');
assert(seed !== null, 'raydotsh-portfolio template seed must be registered');
assert(seed.name === 'Raydotsh Portfolio', 'template display name should be Raydotsh Portfolio');
assert(seed.pages.length === 2, 'template should include home and books pages');
assert(
  seed.pages.some((page) => page.slug === 'books'),
  'template should include a books gallery page',
);

const state = instantiateTemplate('raydotsh-portfolio');
assert(state.scrollBehavior?.paddingTop === 80, 'Raydotsh anchors should land below fixed nav');
assert(
  state.routeTransition?.enabled === true,
  'Raydotsh books route should use route transition metadata',
);
assert(
  state.faviconAssetId === 'seed-raydotsh-favicon',
  'Raydotsh should bind the source favicon seed asset',
);
const typewriterSequence = state.motionSequences?.find(
  (sequence) => sequence.id === 'raydotsh-typewriter-greeting',
);
assert(typewriterSequence !== undefined, 'Raydotsh should include a typewriter greeting sequence');
assert(
  typewriterSequence.trigger.type === 'page-enter' &&
    typewriterSequence.trigger.pageId === 'page-raydotsh-home',
  'Raydotsh typewriter greeting should run on home page entry',
);
const typewriterStep = typewriterSequence.steps.find(
  (step) => step.id === 'raydotsh-typewriter-heading',
);
assert(typewriterStep !== undefined, 'Raydotsh typewriter greeting should include a heading step');
assert(
  typewriterStep.textEffect === 'typewriter',
  'Raydotsh typewriter greeting should use the typewriter text effect',
);
assert(
  typewriterStep.target.type === 'text-split' &&
    typewriterStep.target.elementId === 'raydotsh-hero-heading',
  'Raydotsh typewriter greeting should target the hero heading text split',
);

const topLevelElements = state.pages.flatMap((page) =>
  page.sections.flatMap((section) => section.elements),
);
const allElements = collectElementTree(topLevelElements);
const allElementIds = new Set(allElements.map((element) => element.id));
const elementById = new Map(allElements.map((element) => [element.id, element]));

const revealSequence = state.motionSequences?.find((sequence) =>
  sequence.steps?.some((step) => step.target.type === 'children-of'),
);
assert(
  revealSequence !== undefined,
  'A Raydotsh reveal motion sequence with a children-of target must exist',
);
assert(
  revealSequence.reducedMotion !== undefined,
  'The reveal motion sequence must have reducedMotion set',
);
const revealSteps = revealSequence.steps.filter((step) => step.target.type === 'children-of');
const revealTargetIds = revealSteps.map(
  (step) => (step.target as { type: 'children-of'; elementId: string }).elementId,
);
for (const targetId of ['raydotsh-project-grid', 'raydotsh-mobile-project-list']) {
  assert(
    revealTargetIds.includes(targetId),
    `Raydotsh reveal sequence must target ${targetId} with children-of`,
  );
}
for (const step of revealSteps) {
  assert((step.staggerMs ?? 0) > 0, `${step.id} must have staggerMs > 0`);
  const revealHostId = (step.target as { type: 'children-of'; elementId: string }).elementId;
  const revealHost = elementById.get(revealHostId);
  assert(revealHost !== undefined, `children-of host "${revealHostId}" must exist`);
  const descendantIds = collectElementTree([revealHost])
    .map((element) => element.id)
    .filter((id) => id !== revealHostId);
  assert(
    descendantIds.length >= 3,
    `children-of host "${revealHostId}" must own rendered child elements`,
  );
}

const desktopRevealHost = elementById.get('raydotsh-project-grid');
assert(desktopRevealHost !== undefined, 'desktop project reveal host must exist');
const desktopRevealDescendantIds = new Set(
  collectElementTree([desktopRevealHost]).map((element) => element.id),
);
for (const elementId of [
  'raydotsh-project-pyshell',
  'raydotsh-pyshell-title',
  'raydotsh-nottosql-title',
  'raydotsh-pits-title',
]) {
  assert(
    desktopRevealDescendantIds.has(elementId),
    `desktop reveal host must own ${elementId} instead of leaving it as an ungated sibling`,
  );
}

const scrollRevealLedgerItem = RAYDOTSH_FIDELITY_LEDGER.find(
  (item) => item.id === 'scroll-reveal-sequence',
);
assert(
  scrollRevealLedgerItem?.status === 'native',
  'scroll-reveal-sequence ledger item must be "native" if the sequence exists',
);

const softwareSection = state.pages
  .flatMap((page) => page.sections)
  .find((section) => section.id === 'raydotsh-software');
assert(softwareSection !== undefined, 'The raydotsh-software section must exist');
assert(
  Array.isArray(softwareSection.responsiveVariants) &&
    softwareSection.responsiveVariants.length >= 2,
  'The raydotsh-software section must have at least 2 responsive variants',
);

const desktopVariant = softwareSection.responsiveVariants.find((v) => v.breakpoint === 'desktop');
const phoneVariant = softwareSection.responsiveVariants.find((v) => v.breakpoint === 'phone');
assert(desktopVariant !== undefined, 'software section must have a desktop responsive variant');
assert(phoneVariant !== undefined, 'software section must have a phone responsive variant');

assert(
  desktopVariant.contentSourceId === phoneVariant.contentSourceId,
  'The responsive variants must share the same contentSourceId',
);
assert(desktopVariant.contentSourceId.length > 0, 'The shared contentSourceId must be non-empty');

assert(
  desktopVariant.elementIds.length > 0 && phoneVariant.elementIds.length > 0,
  'Both responsive variants must have non-empty elementIds arrays',
);
const allVariantElementIds = new Set([...desktopVariant.elementIds, ...phoneVariant.elementIds]);
assert(
  allVariantElementIds.size === desktopVariant.elementIds.length + phoneVariant.elementIds.length,
  'The elementIds for desktop and phone variants must be distinct',
);

const sectionElementIds = new Set(softwareSection.elements.map((el) => el.id));
for (const elementId of allVariantElementIds) {
  assert(
    sectionElementIds.has(elementId),
    `Variant element ID "${elementId}" must exist in the section elements`,
  );
}
for (const elementId of [
  'raydotsh-pycaster-card',
  'raydotsh-pycaster-media',
  'raydotsh-pycaster-title',
  'raydotsh-pycaster-desc',
  'raydotsh-pycaster-tech',
  'raydotsh-pycaster-action',
  'raydotsh-project-grid',
]) {
  assert(
    desktopVariant.elementIds.includes(elementId),
    `desktop project variant must include ${elementId}`,
  );
}
assert(
  phoneVariant.elementIds.includes('raydotsh-mobile-project-list'),
  'phone project variant must include the mobile project list host',
);
const phoneRevealHost = elementById.get('raydotsh-mobile-project-list');
assert(phoneRevealHost !== undefined, 'phone project list host must exist');
const phoneRevealDescendantIds = new Set(
  collectElementTree([phoneRevealHost]).map((element) => element.id),
);
for (const elementId of [
  'raydotsh-mobile-pycaster-title',
  'raydotsh-mobile-pyshell-title',
  'raydotsh-mobile-nottosql-title',
  'raydotsh-mobile-pits-title',
]) {
  assert(
    phoneRevealDescendantIds.has(elementId),
    `phone project variant must own rendered content ${elementId}`,
  );
}
for (const elementId of [
  'raydotsh-pycaster-card',
  'raydotsh-project-grid',
  'raydotsh-mobile-project-list',
]) {
  assert(allElementIds.has(elementId), `${elementId} must exist in the rendered element tree`);
}

const responsiveProjectLedgerItem = RAYDOTSH_FIDELITY_LEDGER.find(
  (item) => item.id === 'responsive-project-variants',
);
assert(
  responsiveProjectLedgerItem?.status === 'native',
  'responsive-project-variants ledger item must be "native" if the variants exist',
);

const editValidation = validateEditableSite(state);
assert(editValidation.valid, editValidation.valid ? '' : editValidation.errors.join('\n'));

const seedValidation = validateSeedFixture(state);
assert(seedValidation.valid, seedValidation.valid ? '' : seedValidation.errors.join('\n'));

const snapshot: PublishedSnapshot = {
  ...state,
  version: 1,
  publishedAt: '2026-06-20T00:00:00.000Z',
};
const publishValidation = validatePublishedSnapshot(snapshot);
assert(publishValidation.valid, publishValidation.valid ? '' : publishValidation.errors.join('\n'));

const html = injectInteractiveRuntime(
  renderCanvasSnapshot(snapshot, '/assets', 'site_raydotsh_smoke', {
    turnstileSiteKey: '1x00000000000000000000AA',
  }),
  snapshot,
);

for (const elementId of [
  'raydotsh-pycaster-title',
  'raydotsh-pycaster-action',
  'raydotsh-project-grid',
]) {
  assert(
    new RegExp(
      `data-opencanvas-element="${elementId}"[^>]*data-opencanvas-responsive-variant="raydotsh-projects-desktop"`,
    ).test(html),
    `${elementId} must render as part of the desktop project variant`,
  );
}
assert(
  /data-opencanvas-element="raydotsh-mobile-project-list"[^>]*data-opencanvas-responsive-variant="raydotsh-projects-phone"[^>]*hidden[^>]*aria-hidden="true"[^>]*inert/.test(
    html,
  ),
  'mobile project list must render as the inactive phone project variant on desktop',
);
for (const token of [
  'data-opencanvas-element="raydotsh-mobile-pycaster-title"',
  'data-opencanvas-element="raydotsh-mobile-pyshell-title"',
  'data-opencanvas-element="raydotsh-mobile-nottosql-title"',
  'data-opencanvas-element="raydotsh-mobile-pits-title"',
]) {
  assert(html.includes(token), `rendered phone variant must include ${token}`);
}

const registeredSourceAssetIds = [
  'seed-raydotsh-yoru',
  'seed-raydotsh-pycaster',
  'seed-raydotsh-favicon',
  'seed-raydotsh-book-a-little-life',
  'seed-raydotsh-book-pride-and-prejudice',
  'seed-raydotsh-book-dracula',
  'seed-raydotsh-book-jane-eyre',
  'seed-raydotsh-book-harry-potter',
  'seed-raydotsh-book-goodnight-punpun',
  'seed-raydotsh-book-hunger-games',
  'seed-raydotsh-book-thousand-splendid-suns',
  'seed-raydotsh-book-man-called-ove',
  'seed-raydotsh-book-red-trainers',
];
for (const assetId of registeredSourceAssetIds) {
  assert(getSeedAsset(assetId) !== null, `${assetId} should be registered as a seed asset`);
}

const renderedSourceAssetIds = registeredSourceAssetIds.filter(
  (assetId) => assetId !== 'seed-raydotsh-favicon',
);
for (const assetId of renderedSourceAssetIds) {
  assert(html.includes(`/assets/${assetId}`), `rendered template should reference ${assetId}`);
}

const requiredCopy = [
  'hi, ',
  'rehana',
  'Freelance content strategist',
  '/ software',
  'pycaster',
  'A Wolfenstein 3D style raycasting rendering engine',
  '/ books',
  'A Little Life',
  '/ reading list',
  'Built and designed by Rehana Rahman.',
];
for (const token of requiredCopy) {
  assert(html.includes(token), `rendered template should include ${JSON.stringify(token)}`);
}
assert(
  html.includes('"textEffect":"typewriter"'),
  'rendered template should publish the typewriter behaviour payload',
);

const unsupportedRuntimeTokens = [
  'react-type-animation',
  'RobotGame',
  'game-toggle',
  'AsciiPortrait',
  'react-router-dom',
];
for (const token of unsupportedRuntimeTokens) {
  assert(!html.includes(token), `rendered template should not embed source runtime token ${token}`);
}

console.log('[raydotsh-portfolio:smoke] OK');
