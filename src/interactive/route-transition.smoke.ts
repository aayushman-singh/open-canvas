import assert from 'node:assert/strict';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
  pages: [{ id: 'home', slug: 'home', title: 'Home', width: 1200, sections: [] }],
  routeTransition: {
    id: 'route-main',
    enabled: true,
    mode: 'wipe',
    durationMs: 240,
    easing: 'ease-in-out',
    sharedElements: [
      {
        id: 'route-shared-hero',
        sourceElementId: 'home-card',
        targetElementId: 'detail-hero',
        viewTransitionName: 'heroMorph',
      },
    ],
  },
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-route-container'));
assert.ok(html.includes('data-opencanvas-route-transition="route-main"'));
assert.ok(html.includes('data-opencanvas-route-mode="wipe"'));
assert.ok(html.includes('data-opencanvas-route-shared-elements='));
assert.ok(html.includes('heroMorph'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);
const runtime = injectInteractiveRuntime(html, snapshot);
assert.ok(runtime.includes('hydrateRouteTransition'));
assert.ok(runtime.includes('opencanvas:route-transition-failed'));
assert.ok(runtime.includes("swapTo(new URL(window.location.href), 'replace')"));
assert.ok(runtime.includes('document.startViewTransition'));
assert.ok(runtime.includes('shared-elements-api'));
assert.ok(runtime.includes('shared-elements-resolve'));
assert.ok(runtime.includes('data-opencanvas-route-shared-elements'));

console.log('[route-transition:smoke] OK');
