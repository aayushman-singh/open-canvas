import assert from 'node:assert/strict';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'section-body',
          recipeId: 'custom',
          name: 'Body',
          height: 300,
          elements: [],
        },
      ],
    },
  ],
  overlays: [
    {
      id: 'overlay-welcome',
      name: 'Welcome',
      scope: { type: 'site' },
      trigger: { type: 'load' },
      content: {
        id: 'overlay-content',
        recipeId: 'custom',
        name: 'Overlay content',
        height: 320,
        elements: [],
      },
      dismissal: {
        closeButton: true,
        escape: true,
        backdropClick: true,
        bodyScrollLock: true,
        focusTrap: true,
        returnFocus: true,
      },
    },
  ],
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-overlays-root'));
assert.ok(html.includes('data-opencanvas-overlay="overlay-welcome"'));
assert.ok(html.includes('data-opencanvas-overlay-trigger-type="load"'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);

const injected = injectInteractiveRuntime(html, snapshot);
assert.ok(injected.includes('hydrateOverlays'));
assert.ok(injected.includes('opencanvas:overlay-failed'));

console.log('[overlay-v1:smoke] OK');
