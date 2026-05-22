import baseSeed from '../canvas/fixtures/home.json';
import type { CanvasElement, CanvasSiteState, InlineRun, StyleKit } from '../canvas/schema';

export interface TemplateSeed {
  id: string;
  name: string;
  tagline: string;
  state: CanvasSiteState;
}

function cloneBaseState(styleKit: StyleKit, title: string): CanvasSiteState {
  const state = structuredClone(baseSeed) as CanvasSiteState;
  state.styleKit = styleKit;
  const page = state.pages[0];
  if (!page) {
    throw new Error('template registry base seed must contain a page');
  }
  page.title = title;
  return state;
}

function findElement(state: CanvasSiteState, id: string): CanvasElement {
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.id === id) return element;
      }
    }
  }
  throw new Error(`template registry base seed is missing element ${id}`);
}

function setText(state: CanvasSiteState, id: string, content: InlineRun[]): void {
  const element = findElement(state, id);
  if (element.type !== 'text') {
    throw new Error(`template registry element ${id} must be text`);
  }
  element.content = content;
}

function setActionLabel(state: CanvasSiteState, id: string, label: string): void {
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
      text: 'Publish to rev01.aayushman.dev',
      marks: [{ type: 'link', href: 'https://rev01.aayushman.dev' }],
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
    'A crisp product-launch starting point with a strong hero, proof blocks, and a direct CTA.',
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

export const allTemplateSeeds = [
  starterTemplate,
  launchTemplate,
  studioTemplate,
  localTemplate,
] as const satisfies readonly TemplateSeed[];

const templatesById = new Map(allTemplateSeeds.map((template) => [template.id, template]));

export function getTemplateSeed(id: string): TemplateSeed | null {
  return templatesById.get(id) ?? null;
}
