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
  },
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-route-container'));
assert.ok(html.includes('data-opencanvas-route-transition="route-main"'));
assert.ok(html.includes('data-opencanvas-route-mode="wipe"'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);
assert.ok(injectInteractiveRuntime(html, snapshot).includes('hydrateRouteTransition'));
assert.ok(injectInteractiveRuntime(html, snapshot).includes('opencanvas:route-transition-failed'));
assert.ok(injectInteractiveRuntime(html, snapshot).includes("swapTo(new URL(window.location.href), 'replace')"));

console.log('[route-transition:smoke] OK');
