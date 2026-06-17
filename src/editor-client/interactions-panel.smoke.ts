export {};

import { defaultLoadExperience, defaultOverlay, defaultRouteTransition } from './interactions-panel.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[interactions-panel:smoke] ' + message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      '[interactions-panel:smoke] ' +
        message +
        ' expected=' +
        String(expected) +
        ' actual=' +
        String(actual),
    );
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      '[interactions-panel:smoke] ' +
        message +
        ' expected=' +
        expectedJson +
        ' actual=' +
        actualJson,
    );
  }
}

const overlay = defaultOverlay('overlay-a', 'Overlay A', 'page-home');
equal(overlay.id, 'overlay-a', 'overlay id');
equal(overlay.name, 'Overlay A', 'overlay name');
equal(overlay.trigger.type, 'load', 'overlay default trigger');
equal(overlay.dismissal.closeButton, true, 'overlay close button');
equal(overlay.dismissal.escape, true, 'overlay escape');
equal(overlay.dismissal.backdropClick, true, 'overlay backdrop click');
equal(overlay.dismissal.bodyScrollLock, true, 'overlay body scroll lock');
equal(overlay.dismissal.focusTrap, true, 'overlay focus trap');
equal(overlay.dismissal.returnFocus, true, 'overlay return focus');
equal(overlay.scope.type, 'pages', 'overlay scope');
deepEqual(
  overlay.scope.type === 'pages' ? overlay.scope.pageIds : [],
  ['page-home'],
  'overlay page scope',
);
equal(overlay.content.id, 'overlay-a-content', 'overlay content id');
equal(overlay.content.recipeId, 'custom', 'overlay recipe id');

const load = defaultLoadExperience();
equal(load.id, 'load-main', 'load id');
equal(load.enabled, false, 'load enabled default');
equal(load.preset, 'fade', 'load preset');
equal(load.runPolicy, 'every-visit', 'load run policy');
deepEqual(load.gates, ['document-ready'], 'load gates');
equal(load.timeoutMs, 4000, 'load timeout');

const route = defaultRouteTransition();
equal(route.id, 'route-main', 'route id');
equal(route.enabled, false, 'route enabled default');
equal(route.mode, 'fade', 'route mode');
equal(route.durationMs, 220, 'route duration');
equal(route.easing, 'ease-in-out', 'route easing');

const panelSrc = await Bun.file(new URL('./interactions-panel.ts', import.meta.url)).text();
assert(panelSrc.includes('LOAD_EXPERIENCE_PRESETS'), 'panel must use load presets');
assert(panelSrc.includes('ROUTE_TRANSITION_MODES'), 'panel must use route modes');
assert(panelSrc.includes('OVERLAY_TRIGGER_TYPES'), 'panel must use overlay trigger types');
assert(panelSrc.includes('MOTION_SEQUENCE_LITE_EFFECTS'), 'panel must use motion effects');
assert(panelSrc.includes('MOTION_SEQUENCE_LITE_TARGET_TYPES'), 'panel must use motion targets');
assert(panelSrc.includes('renderSequenceLiteEditor'), 'panel must render sequence editor');

console.log('[interactions-panel:smoke] OK');
