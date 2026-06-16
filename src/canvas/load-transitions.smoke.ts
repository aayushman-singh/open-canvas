import {
  validateLoadExperience,
  validateRouteTransition,
  type LoadExperience,
  type RouteTransition,
} from './load-transitions';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[load-transitions:smoke] ${message}`);
}

function assertThrowsWithField(
  description: string,
  action: () => void,
  expectedField: string,
): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, `${description}: expected Error instance`);
    assert(
      error.message.includes(expectedField),
      `${description}: expected error to include "${expectedField}", got "${error.message}"`,
    );
    return;
  }

  throw new Error(`[load-transitions:smoke] ${description}: expected validation to fail`);
}

const boundedLoadExperience: LoadExperience = {
  id: 'home-load',
  run: 'once-per-session',
  gates: [
    { type: 'document-ready' },
    { type: 'fonts-ready' },
    { type: 'asset-ready', assetId: 'hero-poster' },
    { type: 'media-ready', assetId: 'hero-video', timeoutMs: 2_000 },
  ],
  timeoutMs: 4_000,
  introSequenceId: 'home-intro',
  exitSequenceId: 'home-exit',
  failureEvent: 'load-experience-failed',
};

validateLoadExperience(boundedLoadExperience);

const hydratedRouteTransition: RouteTransition = {
  id: 'same-site-page-swap',
  trigger: { type: 'same-site-navigation' },
  outgoingSequenceId: 'page-out',
  incomingSequenceId: 'page-in',
  swapAt: 'after-outgoing',
  scrollRestoration: 'top',
  focusTarget: { type: 'element', elementId: 'main-heading' },
  hydrate: true,
  failureEvent: 'route-transition-failed',
};

validateRouteTransition(hydratedRouteTransition);

assertThrowsWithField(
  'load experience empty id',
  () => validateLoadExperience({ ...boundedLoadExperience, id: '' }),
  'id',
);

assertThrowsWithField(
  'load experience without bounded timeout',
  () =>
    validateLoadExperience({
      ...boundedLoadExperience,
      timeoutMs: Number.POSITIVE_INFINITY,
    }),
  'timeoutMs',
);

assertThrowsWithField(
  'media-ready gate without bounded timeout',
  () =>
    validateLoadExperience({
      ...boundedLoadExperience,
      gates: [{ type: 'media-ready', assetId: 'hero-video' } as LoadExperience['gates'][number]],
    }),
  'gates[0].timeoutMs',
);

assertThrowsWithField(
  'route transition empty id',
  () => validateRouteTransition({ ...hydratedRouteTransition, id: '' }),
  'id',
);

assertThrowsWithField(
  'route transition without hydration',
  () =>
    validateRouteTransition({
      ...hydratedRouteTransition,
      hydrate: false as RouteTransition['hydrate'],
    }),
  'hydrate',
);

console.log('[load-transitions:smoke] OK');
