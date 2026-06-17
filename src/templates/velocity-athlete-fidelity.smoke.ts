import { injectInteractiveRuntime } from '../interactive/inject.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { validateEditableSite, validatePublishedSnapshot } from '../canvas/validate.js';
import { getTemplateSeed, instantiateTemplate } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[velocity-athlete:smoke] ${message}`);
}

const seed = getTemplateSeed('velocity-athlete');
assert(seed !== null, 'velocity-athlete template seed must be registered');

const state = instantiateTemplate('velocity-athlete');
const editValidation = validateEditableSite(state);
assert(editValidation.valid, editValidation.valid ? '' : editValidation.errors.join('\n'));

const snapshot: PublishedSnapshot = {
  ...state,
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
};
const publishValidation = validatePublishedSnapshot(snapshot);
assert(publishValidation.valid, publishValidation.valid ? '' : publishValidation.errors.join('\n'));

const html = injectInteractiveRuntime(
  renderCanvasSnapshot(snapshot, '/assets', 'site_velocity_smoke', {
    turnstileSiteKey: '1x00000000000000000000AA',
  }),
  snapshot,
);

const forbidden = ['lando', 'norris', 'mclaren', 'quadrant', 'gsap', 'ScrollTrigger'];
for (const token of forbidden) {
  assert(!html.toLowerCase().includes(token.toLowerCase()), `rendered template leaks forbidden token ${token}`);
}

assert((state as { loadExperience?: unknown }).loadExperience !== undefined, 'template must define a Load Experience');
assert(((state as { motionSequences?: unknown[] }).motionSequences ?? []).length >= 3, 'template must define at least three Motion Sequences');
assert(((state as { scrollScenes?: unknown[] }).scrollScenes ?? []).length >= 1, 'template must define at least one Scroll Scene');
assert(((state as { richMotionAssets?: unknown[] }).richMotionAssets ?? []).length >= 1, 'template must define at least one Rich Motion Asset');
assert(html.includes('data-opencanvas-load-experience'), 'rendered HTML must include load-experience chrome');
assert(html.includes('data-opencanvas-rich-motion'), 'rendered HTML must include a rich-motion element');
assert(html.includes('data-opencanvas-behaviour-payload'), 'rendered HTML must include the behaviour payload');
assert(html.includes('data-opencanvas-interactive-runtime'), 'rendered HTML must include the interactive runtime');
