import assert from 'node:assert/strict';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
  pages: [{ id: 'home', slug: 'home', title: 'Home', width: 1200, sections: [] }],
  loadExperience: {
    id: 'load-main',
    enabled: true,
    preset: 'progress-bar',
    runPolicy: 'once-per-session',
    gates: ['document-ready', 'fonts-ready'],
    timeoutMs: 3000,
  },
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-load-experience'));
assert.ok(html.includes('data-opencanvas-load-part="shell"'));
assert.ok(html.includes('data-opencanvas-load-preset="progress-bar"'));
assert.ok(html.includes('data-opencanvas-load-gates="document-ready fonts-ready"'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);
assert.ok(injectInteractiveRuntime(html, snapshot).includes('hydrateLoadExperience'));
assert.ok(injectInteractiveRuntime(html, snapshot).includes('opencanvas:load-experience-failed'));

console.log('[load-experience:smoke] OK');
