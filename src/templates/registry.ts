import baseSeed from '../canvas/fixtures/home.json';
import enterpriseScaleSeed from '../canvas/fixtures/enterprise-scale.json';
import apogeeShowcaseSeed from '../canvas/fixtures/apogee-showcase.json';
import portfolioShowcaseSeed from '../canvas/fixtures/portfolio-showcase.json';
import type { CanvasElement, EditableSite, InlineRun, StyleKit } from '../canvas/schema';

export interface TemplateSeed {
  id: string;
  name: string;
  tagline: string;
  state: EditableSite;
}

function cloneBaseState(styleKit: StyleKit, title: string): EditableSite {
  const state = structuredClone(baseSeed) as EditableSite;
  state.styleKit = styleKit;
  const page = state.pages[0];
  if (!page) {
    throw new Error('template registry base seed must contain a page');
  }
  page.title = title;
  return state;
}

function findElement(state: EditableSite, id: string): CanvasElement {
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.id === id) return element;
      }
    }
  }
  throw new Error(`template registry base seed is missing element ${id}`);
}

function setText(state: EditableSite, id: string, content: InlineRun[]): void {
  const element = findElement(state, id);
  if (element.type !== 'text') {
    throw new Error(`template registry element ${id} must be text`);
  }
  element.content = content;
}

function setActionLabel(state: EditableSite, id: string, label: string): void {
  const element = findElement(state, id);
  if (element.type !== 'action') {
    throw new Error(`template registry element ${id} must be action`);
  }
  element.label = label;
}

function buildTemplate(options: {
  id: string;
  name: string;
  tagline: string;
  styleKit: StyleKit;
  title: string;
  heroHeading: InlineRun[];
  heroBody: InlineRun[];
  featureHeading: InlineRun[];
  ctaHeading: InlineRun[];
  primaryAction: string;
}): TemplateSeed {
  const state = cloneBaseState(options.styleKit, options.title);
  setText(state, 'hero-heading', options.heroHeading);
  setText(state, 'hero-body', options.heroBody);
  setText(state, 'features-heading', options.featureHeading);
  setText(state, 'cta-heading', options.ctaHeading);
  setActionLabel(state, 'hero-action', options.primaryAction);
  setActionLabel(state, 'cta-primary', options.primaryAction);
  return {
    id: options.id,
    name: options.name,
    tagline: options.tagline,
    state,
  };
}

export const starterTemplate = buildTemplate({
  id: 'starter-canvas',
  name: 'Starter Canvas',
  tagline:
    'A flexible canvas with editable sections, rich text, media, actions, shapes, surfaces, style kits, and motion.',
  styleKit: 'charcoal',
  title: 'Starter Canvas',
  heroHeading: [
    { text: 'Ship a site that feels ' },
    { text: 'lived-in', marks: [{ type: 'bold' }] },
    { text: '.' },
  ],
  heroBody: [
    { text: 'Position elements freely. Pick a style kit. ' },
    {
      text: 'Publish to opencanvas.aayushman.dev',
      marks: [{ type: 'link', href: 'https://opencanvas.aayushman.dev' }],
    },
    { text: '.' },
  ],
  featureHeading: [
    { text: 'Everything an Owner needs, ' },
    { text: 'nothing they do not', marks: [{ type: 'italic' }] },
    { text: '.' },
  ],
  ctaHeading: [{ text: 'Publish when it feels right.' }],
  primaryAction: 'Start editing',
});

export const launchTemplate = buildTemplate({
  id: 'launch-canvas',
  name: 'Launch Page',
  tagline:
    'A crisp product-launch starting point with a strong hero, proof sections, and a direct CTA.',
  styleKit: 'blue-saas',
  title: 'Launch Page',
  heroHeading: [
    { text: 'Launch the thing ' },
    { text: 'people remember', marks: [{ type: 'bold' }] },
    { text: '.' },
  ],
  heroBody: [
    { text: 'Lead with the outcome, show the product, and give visitors one clear next step.' },
  ],
  featureHeading: [{ text: 'Three reasons to try it today.' }],
  ctaHeading: [{ text: 'Turn attention into action.' }],
  primaryAction: 'Join the launch',
});

export const enterpriseScaleTemplate: TemplateSeed = {
  id: 'enterprise-scale-canvas',
  name: 'Enterprise Scale',
  tagline:
    'A proof-heavy enterprise landing page seed with governed launch messaging, outcome cards, team sections, scalability, and sales CTAs.',
  state: structuredClone(enterpriseScaleSeed) as EditableSite,
};

export const studioTemplate = buildTemplate({
  id: 'studio-canvas',
  name: 'Studio Portfolio',
  tagline:
    'A visual-first portfolio seed for studios, designers, photographers, and independent makers.',
  styleKit: 'orange-editorial',
  title: 'Studio Portfolio',
  heroHeading: [
    { text: 'Show the work ' },
    { text: 'with teeth', marks: [{ type: 'italic' }] },
    { text: '.' },
  ],
  heroBody: [{ text: 'Frame a point of view, then let the project imagery carry the page.' }],
  featureHeading: [{ text: 'Selected work, arranged for scanning.' }],
  ctaHeading: [{ text: 'Make the next commission easy.' }],
  primaryAction: 'View the work',
});

export const localTemplate = buildTemplate({
  id: 'local-canvas',
  name: 'Local Business',
  tagline:
    'A warm small-business seed for cafes, salons, classes, services, and neighborhood teams.',
  styleKit: 'green-organic',
  title: 'Local Business',
  heroHeading: [
    { text: 'A clear home for ' },
    { text: 'real-world visits', marks: [{ type: 'bold' }] },
    { text: '.' },
  ],
  heroBody: [
    { text: 'Put the offer, hours, location, and booking action where visitors can use them.' },
  ],
  featureHeading: [{ text: 'The details people check before they show up.' }],
  ctaHeading: [{ text: 'Make the next visit simple.' }],
  primaryAction: 'Book a visit',
});

export const apogeeShowcaseTemplate: TemplateSeed = {
  id: 'apogee-showcase',
  name: 'Apogee Showcase',
  tagline:
    'A multi-page showcase site — dark, bold, and loaded with every element type. Carousels, charts, forms, code snippets, accordions, embeds, and more.',
  state: structuredClone(apogeeShowcaseSeed) as EditableSite,
};

export const portfolioShowcaseTemplate: TemplateSeed = {
  id: 'portfolio-showcase',
  name: 'Engineer Portfolio',
  tagline:
    'Dark warm-toned single-page engineer portfolio: hero, tech stack, selected work, and a notes blog with four mock long-form posts that exercise the page-bound collection.',
  state: structuredClone(portfolioShowcaseSeed) as EditableSite,
};

export const pressTemplate = buildTemplate({
  id: 'press-canvas',
  name: 'Press Canvas',
  tagline:
    'A serif-led editorial canvas for writers, publications, and anyone who still believes a sentence can carry a brand.',
  styleKit: 'ivory-press',
  title: 'Press Canvas',
  heroHeading: [
    { text: 'A canvas with ' },
    { text: 'something to say', marks: [{ type: 'bold' }] },
    { text: '.' },
  ],
  heroBody: [
    {
      text: 'Set in Garamond, framed in hairlines, paced for reading. The page steps back so the writing steps forward.',
    },
  ],
  featureHeading: [{ text: 'The page, in service of the words.' }],
  ctaHeading: [{ text: 'Publish on paper, ship on the web.' }],
  primaryAction: 'Start writing',
});

export const violetLaunchTemplate = buildTemplate({
  id: 'violet-launch',
  name: 'Violet Launch',
  tagline:
    'A bold midnight launch canvas with electric violet accents — the look indie products take when they want to be noticed.',
  styleKit: 'midnight-violet',
  title: 'Violet Launch',
  heroHeading: [
    { text: 'Ship something ' },
    { text: 'loud', marks: [{ type: 'bold' }] },
    { text: '.' },
  ],
  heroBody: [
    {
      text: 'Deep midnight, vivid violet, modern type. Built for launches that need to look the part on day one.',
    },
  ],
  featureHeading: [{ text: 'Three reasons people stay past the headline.' }],
  ctaHeading: [{ text: 'Make the launch list before launch day.' }],
  primaryAction: 'Join the waitlist',
});

export const allTemplateSeeds = [
  starterTemplate,
  launchTemplate,
  enterpriseScaleTemplate,
  studioTemplate,
  localTemplate,
  pressTemplate,
  violetLaunchTemplate,
  apogeeShowcaseTemplate,
  portfolioShowcaseTemplate,
] as const satisfies readonly TemplateSeed[];

const templatesById = new Map(allTemplateSeeds.map((template) => [template.id, template]));

export function getTemplateSeed(id: string): TemplateSeed | null {
  return templatesById.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Boot-time fixture SEO check — ADRs 0040 & 0041.
//
// Built-in template fixtures must not pre-bake per-page `canonical` URLs or
// `ogImageAssetId` values. The runtime emit path composes the correct
// canonical from the request host and falls through to the live OG render
// when no asset is set; any literal in the fixture is by definition stale
// against a fork's apex or a site's per-subdomain publish host.
//
// Failing loud at module load means a fixture author who reintroduces a
// literal URL or seed asset id sees the regression at PR-author time, not
// after publishing a real site that emits the wrong meta tag.
export function assertNoFixtureSeoLeak(seeds: readonly TemplateSeed[]): void {
  const offenders: string[] = [];
  for (const seed of seeds) {
    for (const page of seed.state.pages) {
      if (typeof page.canonical === 'string' && page.canonical.length > 0) {
        offenders.push(
          `${seed.id}: page "${page.slug}" carries canonical="${page.canonical}" — built-in fixtures must leave this empty (ADR 0040)`,
        );
      }
      if (typeof page.ogImageAssetId === 'string' && page.ogImageAssetId.length > 0) {
        offenders.push(
          `${seed.id}: page "${page.slug}" carries ogImageAssetId="${page.ogImageAssetId}" — built-in fixtures must leave this empty so the lazy OG render path is used (ADR 0041)`,
        );
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Built-in template fixture SEO leak detected:\n  - ${offenders.join('\n  - ')}`,
    );
  }
}

assertNoFixtureSeoLeak(allTemplateSeeds);
