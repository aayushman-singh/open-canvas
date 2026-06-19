import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCanvasSnapshot } from './render.js';
import { validatePublishedSnapshot } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';
import { OVERLAY_RUNTIME_SRC } from '../interactive/overlay-v1.js';
import type { EditableSite, Overlay, PublishedSnapshot } from './schema.js';

const thisDir = dirname(fileURLToPath(import.meta.url));

const fullscreenOverlay = {
  id: 'overlay-menu',
  name: 'Fullscreen menu',
  trigger: { type: 'element-click', targetElementId: 'nav-menu-button' },
  scope: { type: 'site' },
  presentation: {
    mode: 'fullscreen-menu',
    chrome: 'glass-panel',
    backdrop: 'blur',
    closePlacement: 'top-left',
  },
  dismissal: {
    closeButton: true,
    escape: true,
    backdropClick: true,
    bodyScrollLock: true,
    focusTrap: true,
    returnFocus: true,
  },
  content: {
    id: 'overlay-menu-content',
    recipeId: 'custom',
    name: 'Overlay menu content',
    height: 720,
    elements: [
      {
        id: 'overlay-menu-title',
        type: 'text',
        box: { x: 96, y: 96, w: 640, h: 96, z: 1 },
        content: [{ text: 'Editorial menu' }],
        role: 'heading',
        fontSize: 72,
        fontWeight: 700,
        align: 'left',
        elementStyle: { color: '#f7f1de' },
      },
    ],
  },
} as unknown as Overlay;

const editable: EditableSite = {
  styleKit: 'charcoal',
  overlays: [fullscreenOverlay],
  pages: [
    {
      id: 'home',
      slug: 'index',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'hero',
          recipeId: 'custom',
          name: 'Hero',
          height: 640,
          elements: [
            {
              id: 'nav-menu-button',
              type: 'action',
              box: { x: 48, y: 48, w: 180, h: 56, z: 1 },
              label: [{ text: 'Open menu' }],
              href: { type: 'external', url: '#' },
              variant: 'solid',
            },
          ],
        },
      ],
    },
  ],
};

const snapshot: PublishedSnapshot = {
  ...editable,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};

const validation = validatePublishedSnapshot(snapshot);
assert.equal(validation.valid, true, validation.valid ? undefined : validation.errors.join('\n'));

const invalid = structuredClone(snapshot) as PublishedSnapshot;
(invalid.overlays![0] as unknown as { presentation: { mode: string } }).presentation.mode = 'drawer';
const invalidResult = validatePublishedSnapshot(invalid);
assert.equal(invalidResult.valid, false, 'unsupported overlay presentation mode must fail validation');
assert.ok(
  invalidResult.errors.some((error) => error.includes('overlays[0].presentation.mode')),
  `validation error must name overlay presentation path, got ${invalidResult.valid ? 'ok' : invalidResult.errors.join(' | ')}`,
);

const invalidChrome = structuredClone(snapshot) as PublishedSnapshot;
(invalidChrome.overlays![0] as unknown as { presentation: { backdrop: string } }).presentation.backdrop =
  'fog';
const invalidChromeResult = validatePublishedSnapshot(invalidChrome);
assert.equal(invalidChromeResult.valid, false, 'unsupported overlay chrome backdrop must fail validation');
assert.ok(
  invalidChromeResult.errors.some((error) => error.includes('overlays[0].presentation.backdrop')),
  `validation error must name overlay backdrop path, got ${invalidChromeResult.valid ? 'ok' : invalidChromeResult.errors.join(' | ')}`,
);

const html = renderCanvasSnapshot(snapshot, '/assets', 'overlay-v2-site', { turnstileSiteKey: 'test-key' });
assert.ok(
  html.includes('data-opencanvas-overlay-presentation="fullscreen-menu"'),
  'renderer must emit fullscreen overlay presentation metadata',
);
assert.ok(
  html.includes('data-opencanvas-overlay-chrome="glass-panel"'),
  'renderer must emit overlay chrome preset metadata',
);
assert.ok(
  html.includes('data-opencanvas-overlay-backdrop-style="blur"'),
  'renderer must emit overlay backdrop style metadata',
);
assert.ok(
  html.includes('data-opencanvas-overlay-close-placement="top-left"'),
  'renderer must emit overlay close placement metadata',
);
assert.ok(
  html.includes('data-opencanvas-overlay-content-canvas="overlay-menu-content"'),
  'renderer must emit overlay content canvas ownership metadata',
);
assert.ok(html.includes('data-opencanvas-overlay-surface'), 'renderer must keep overlay surface hydration target');
assert.ok(html.includes('opencanvas-overlay--fullscreen-menu'), 'renderer must expose fullscreen menu styling hook');
assert.ok(html.includes('opencanvas-overlay--chrome-glass-panel'), 'renderer must expose overlay chrome styling hook');

const roundTrip = decodeYDoc(encodeYDoc(editable));
assert.equal(
  roundTrip.overlays?.[0]?.presentation?.mode,
  'fullscreen-menu',
  'Yjs projection must preserve fullscreen overlay presentation',
);
assert.equal(
  roundTrip.overlays?.[0]?.presentation?.chrome,
  'glass-panel',
  'Yjs projection must preserve overlay chrome preset',
);

assert.ok(
  OVERLAY_RUNTIME_SRC.includes('data-opencanvas-overlay-presentation'),
  'overlay runtime must read presentation metadata',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('data-opencanvas-overlay-close-placement'),
  'overlay runtime must read close placement metadata',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('overlay-presentation'),
  'overlay runtime must emit named presentation failure events',
);

const interactionsPanel = readFileSync(join(thisDir, '../editor-client/interactions-panel.ts'), 'utf8');
assert.ok(interactionsPanel.includes('OVERLAY_PRESENTATION_MODES'), 'editor panel must expose overlay presentation modes');
assert.ok(interactionsPanel.includes('OVERLAY_CHROME_PRESETS'), 'editor panel must expose overlay chrome presets');
assert.ok(interactionsPanel.includes('Presentation'), 'editor panel must label overlay presentation controls');
assert.ok(interactionsPanel.includes('Backdrop style'), 'editor panel must label overlay backdrop controls');
assert.ok(interactionsPanel.includes('Close placement'), 'editor panel must label overlay close placement controls');
assert.ok(interactionsPanel.includes('Edit content canvas'), 'editor panel must expose overlay content canvas editing action');

const editorIndex = readFileSync(join(thisDir, '../editor-client/index.ts'), 'utf8');
assert.ok(
  editorIndex.includes('data-opencanvas-overlay-chrome'),
  'editor preview shell must emit overlay chrome metadata',
);

const publicStyles = readFileSync(join(thisDir, 'public-styles.ts'), 'utf8');
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-presentation="fullscreen-menu"'),
  'public styles must include fullscreen overlay presentation rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-chrome="glass-panel"'),
  'public styles must include overlay chrome preset rules',
);

console.log('[overlay-v2:smoke] OK');



