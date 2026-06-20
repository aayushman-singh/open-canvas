import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCanvasSnapshot } from './render.js';
import { validatePublishedSnapshot } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';
import { OVERLAY_RUNTIME_SRC } from '../interactive/overlay-v1.js';
import {
  OVERLAY_CHOREOGRAPHY_PRESETS,
  OVERLAY_CHOREOGRAPHY_REDUCED_MOTION_MODES,
  OVERLAY_LAYOUT_PRESETS,
  type EditableSite,
  type Overlay,
  type PublishedSnapshot,
} from './schema.js';

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
    layout: 'split-rail',
    choreography: 'stagger-rise',
    reducedMotion: 'instant',
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
assert.ok(
  (OVERLAY_CHOREOGRAPHY_PRESETS as readonly string[]).includes('stagger-rise'),
  'schema must expose stagger-rise overlay choreography',
);
assert.ok(
  (OVERLAY_CHOREOGRAPHY_PRESETS as readonly string[]).includes('mask-sweep'),
  'schema must expose mask-sweep overlay choreography',
);
assert.ok(
  (OVERLAY_CHOREOGRAPHY_PRESETS as readonly string[]).includes('slide-stack'),
  'schema must expose slide-stack overlay choreography',
);
assert.ok(
  (OVERLAY_CHOREOGRAPHY_REDUCED_MOTION_MODES as readonly string[]).includes('instant'),
  'schema must expose explicit overlay choreography reduced-motion modes',
);
assert.ok(
  (OVERLAY_LAYOUT_PRESETS as readonly string[]).includes('split-rail'),
  'schema must expose split-rail overlay layout preset',
);
assert.ok(
  (OVERLAY_LAYOUT_PRESETS as readonly string[]).includes('mega-menu-grid'),
  'schema must expose mega-menu-grid overlay layout preset',
);

const lightboxSnapshot = structuredClone(snapshot) as PublishedSnapshot;
(lightboxSnapshot.overlays![0] as unknown as { presentation: { mode: string; chrome: string } }).presentation.mode =
  'lightbox';
(lightboxSnapshot.overlays![0] as unknown as { presentation: { mode: string; chrome: string } }).presentation.chrome =
  'editorial-frame';
const lightboxValidation = validatePublishedSnapshot(lightboxSnapshot);
assert.equal(
  lightboxValidation.valid,
  true,
  lightboxValidation.valid ? undefined : lightboxValidation.errors.join('\n'),
);

const commandPaletteSnapshot = structuredClone(snapshot) as PublishedSnapshot;
(commandPaletteSnapshot.overlays![0] as unknown as { presentation: { mode: string; chrome: string } }).presentation.mode =
  'command-palette';
(commandPaletteSnapshot.overlays![0] as unknown as { presentation: { mode: string; chrome: string } }).presentation.chrome =
  'glass-panel';
const commandPaletteValidation = validatePublishedSnapshot(commandPaletteSnapshot);
assert.equal(
  commandPaletteValidation.valid,
  true,
  commandPaletteValidation.valid ? undefined : commandPaletteValidation.errors.join('\n'),
);

const productTourSnapshot = structuredClone(snapshot) as PublishedSnapshot;
(productTourSnapshot.overlays![0] as unknown as { presentation: { mode: string; chrome: string } }).presentation.mode =
  'product-tour';
(productTourSnapshot.overlays![0] as unknown as { presentation: { mode: string; chrome: string } }).presentation.chrome =
  'editorial-frame';
const productTourValidation = validatePublishedSnapshot(productTourSnapshot);
assert.equal(
  productTourValidation.valid,
  true,
  productTourValidation.valid ? undefined : productTourValidation.errors.join('\n'),
);

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

const invalidChoreography = structuredClone(snapshot) as PublishedSnapshot;
(invalidChoreography.overlays![0] as unknown as { presentation: { choreography: string } }).presentation.choreography =
  'timeline-js';
const invalidChoreographyResult = validatePublishedSnapshot(invalidChoreography);
assert.equal(
  invalidChoreographyResult.valid,
  false,
  'unsupported overlay choreography preset must fail validation',
);
assert.ok(
  invalidChoreographyResult.errors.some((error) => error.includes('overlays[0].presentation.choreography')),
  `validation error must name overlay choreography path, got ${invalidChoreographyResult.valid ? 'ok' : invalidChoreographyResult.errors.join(' | ')}`,
);

const invalidReducedMotion = structuredClone(snapshot) as PublishedSnapshot;
(invalidReducedMotion.overlays![0] as unknown as { presentation: { reducedMotion: string } }).presentation.reducedMotion =
  'auto-fallback';
const invalidReducedMotionResult = validatePublishedSnapshot(invalidReducedMotion);
assert.equal(
  invalidReducedMotionResult.valid,
  false,
  'unsupported overlay choreography reduced-motion mode must fail validation',
);
assert.ok(
  invalidReducedMotionResult.errors.some((error) => error.includes('overlays[0].presentation.reducedMotion')),
  `validation error must name overlay reduced-motion path, got ${invalidReducedMotionResult.valid ? 'ok' : invalidReducedMotionResult.errors.join(' | ')}`,
);

const invalidLayout = structuredClone(snapshot) as PublishedSnapshot;
(invalidLayout.overlays![0] as unknown as { presentation: { layout: string } }).presentation.layout =
  'owner-css-grid';
const invalidLayoutResult = validatePublishedSnapshot(invalidLayout);
assert.equal(invalidLayoutResult.valid, false, 'unsupported overlay layout preset must fail validation');
assert.ok(
  invalidLayoutResult.errors.some((error) => error.includes('overlays[0].presentation.layout')),
  `validation error must name overlay layout path, got ${invalidLayoutResult.valid ? 'ok' : invalidLayoutResult.errors.join(' | ')}`,
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
  html.includes('data-opencanvas-overlay-layout="split-rail"'),
  'renderer must emit overlay layout metadata',
);
assert.ok(
  html.includes('data-opencanvas-overlay-choreography="stagger-rise"'),
  'renderer must emit overlay choreography metadata',
);
assert.ok(
  html.includes('data-opencanvas-overlay-reduced-motion="instant"'),
  'renderer must emit overlay choreography reduced-motion metadata',
);
assert.ok(
  html.includes('data-opencanvas-overlay-content-canvas="overlay-menu-content"'),
  'renderer must emit overlay content canvas ownership metadata',
);
assert.ok(html.includes('data-opencanvas-overlay-surface'), 'renderer must keep overlay surface hydration target');
assert.ok(html.includes('opencanvas-overlay--fullscreen-menu'), 'renderer must expose fullscreen menu styling hook');
assert.ok(html.includes('opencanvas-overlay--chrome-glass-panel'), 'renderer must expose overlay chrome styling hook');
assert.ok(html.includes('opencanvas-overlay--layout-split-rail'), 'renderer must expose overlay layout styling hook');
assert.ok(
  html.includes('opencanvas-overlay--choreography-stagger-rise'),
  'renderer must expose overlay choreography styling hook',
);

const lightboxHtml = renderCanvasSnapshot(lightboxSnapshot, '/assets', 'overlay-lightbox-site', {
  turnstileSiteKey: 'test-key',
});
assert.ok(
  lightboxHtml.includes('data-opencanvas-overlay-presentation="lightbox"'),
  'renderer must emit lightbox overlay presentation metadata',
);
assert.ok(
  lightboxHtml.includes('opencanvas-overlay--lightbox'),
  'renderer must expose lightbox overlay styling hook',
);

const commandPaletteHtml = renderCanvasSnapshot(commandPaletteSnapshot, '/assets', 'overlay-command-palette-site', {
  turnstileSiteKey: 'test-key',
});
assert.ok(
  commandPaletteHtml.includes('data-opencanvas-overlay-presentation="command-palette"'),
  'renderer must emit command-palette overlay presentation metadata',
);
assert.ok(
  commandPaletteHtml.includes('opencanvas-overlay--command-palette'),
  'renderer must expose command-palette overlay styling hook',
);

const productTourHtml = renderCanvasSnapshot(productTourSnapshot, '/assets', 'overlay-product-tour-site', {
  turnstileSiteKey: 'test-key',
});
assert.ok(
  productTourHtml.includes('data-opencanvas-overlay-presentation="product-tour"'),
  'renderer must emit product-tour overlay presentation metadata',
);
assert.ok(
  productTourHtml.includes('opencanvas-overlay--product-tour'),
  'renderer must expose product-tour overlay styling hook',
);

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
assert.equal(
  roundTrip.overlays?.[0]?.presentation?.choreography,
  'stagger-rise',
  'Yjs projection must preserve overlay choreography preset',
);
assert.equal(
  roundTrip.overlays?.[0]?.presentation?.layout,
  'split-rail',
  'Yjs projection must preserve overlay layout preset',
);
assert.equal(
  roundTrip.overlays?.[0]?.presentation?.reducedMotion,
  'instant',
  'Yjs projection must preserve overlay choreography reduced-motion policy',
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
  OVERLAY_RUNTIME_SRC.includes('data-opencanvas-overlay-choreography'),
  'overlay runtime must read choreography metadata',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('data-opencanvas-overlay-layout'),
  'overlay runtime must read layout metadata',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('data-opencanvas-overlay-reduced-motion'),
  'overlay runtime must read choreography reduced-motion metadata',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('overlay-presentation'),
  'overlay runtime must emit named presentation failure events',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('overlay-choreography'),
  'overlay runtime must emit named choreography failure events',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('overlay-layout'),
  'overlay runtime must emit named layout failure events',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes('data-opencanvas-overlay-choreography-active'),
  'overlay runtime must mark active choreography state for visitor/editor parity',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes("presentation !== 'lightbox'"),
  'overlay runtime must explicitly allow lightbox presentation',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes("presentation !== 'command-palette'"),
  'overlay runtime must explicitly allow command-palette presentation',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes("presentation !== 'product-tour'"),
  'overlay runtime must explicitly allow product-tour presentation',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes("layout !== 'split-rail'"),
  'overlay runtime must explicitly allow split-rail layout',
);
assert.ok(
  OVERLAY_RUNTIME_SRC.includes("layout !== 'mega-menu-grid'"),
  'overlay runtime must explicitly allow mega-menu-grid layout',
);

const interactionsPanel = readFileSync(join(thisDir, '../editor-client/interactions-panel.ts'), 'utf8');
assert.ok(interactionsPanel.includes('OVERLAY_PRESENTATION_MODES'), 'editor panel must expose overlay presentation modes');
assert.ok(interactionsPanel.includes('OVERLAY_CHROME_PRESETS'), 'editor panel must expose overlay chrome presets');
assert.ok(interactionsPanel.includes('OVERLAY_LAYOUT_PRESETS'), 'editor panel must expose overlay layout presets');
assert.ok(
  interactionsPanel.includes('OVERLAY_CHOREOGRAPHY_PRESETS'),
  'editor panel must expose overlay choreography presets',
);
assert.ok(
  interactionsPanel.includes('OVERLAY_CHOREOGRAPHY_REDUCED_MOTION_MODES'),
  'editor panel must expose overlay choreography reduced-motion modes',
);
assert.ok(interactionsPanel.includes('Presentation'), 'editor panel must label overlay presentation controls');
assert.ok(interactionsPanel.includes('Backdrop style'), 'editor panel must label overlay backdrop controls');
assert.ok(interactionsPanel.includes('Close placement'), 'editor panel must label overlay close placement controls');
assert.ok(interactionsPanel.includes('Layout preset'), 'editor panel must label overlay layout controls');
assert.ok(interactionsPanel.includes('Choreography'), 'editor panel must label overlay choreography controls');
assert.ok(
  interactionsPanel.includes('Choreography reduced motion'),
  'editor panel must label overlay choreography reduced-motion controls',
);
assert.ok(interactionsPanel.includes('Edit content canvas'), 'editor panel must expose overlay content canvas editing action');

const editorIndex = readFileSync(join(thisDir, '../editor-client/index.ts'), 'utf8');
assert.ok(
  editorIndex.includes('data-opencanvas-overlay-chrome'),
  'editor preview shell must emit overlay chrome metadata',
);
assert.ok(
  editorIndex.includes('data-opencanvas-overlay-choreography'),
  'editor preview shell must emit overlay choreography metadata',
);
assert.ok(
  editorIndex.includes('data-opencanvas-overlay-layout'),
  'editor preview shell must emit overlay layout metadata',
);

const publicStyles = readFileSync(join(thisDir, 'public-styles.ts'), 'utf8');
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-presentation="fullscreen-menu"'),
  'public styles must include fullscreen overlay presentation rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-presentation="lightbox"'),
  'public styles must include lightbox overlay presentation rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-presentation="command-palette"'),
  'public styles must include command-palette overlay presentation rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-presentation="product-tour"'),
  'public styles must include product-tour overlay presentation rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-chrome="glass-panel"'),
  'public styles must include overlay chrome preset rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-layout="split-rail"'),
  'public styles must include split-rail overlay layout rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-layout="mega-menu-grid"'),
  'public styles must include mega-menu-grid overlay layout rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-choreography="stagger-rise"'),
  'public styles must include overlay stagger-rise choreography rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-choreography="mask-sweep"'),
  'public styles must include overlay mask-sweep choreography rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-choreography="slide-stack"'),
  'public styles must include overlay slide-stack choreography rules',
);
assert.ok(
  publicStyles.includes('data-opencanvas-overlay-reduced-motion-active="instant"'),
  'public styles must include explicit instant reduced-motion choreography rules',
);

const editorStylesBuild = readFileSync(join(thisDir, '../editor-client/styles-build.ts'), 'utf8');
const editorStylesCss = readFileSync(join(thisDir, '../editor-client/styles.css'), 'utf8');
assert.ok(
  editorStylesBuild.includes('data-opencanvas-overlay-choreography="stagger-rise"'),
  'editor generated styles must mirror overlay choreography rules',
);
assert.ok(
  editorStylesBuild.includes('data-opencanvas-overlay-layout="split-rail"'),
  'editor generated styles must mirror overlay layout rules',
);
assert.ok(
  editorStylesCss.includes('data-opencanvas-overlay-choreography="stagger-rise"'),
  'editor CSS must mirror overlay choreography rules',
);
assert.ok(
  editorStylesCss.includes('data-opencanvas-overlay-layout="split-rail"'),
  'editor CSS must mirror overlay layout rules',
);

console.log('[overlay-v2:smoke] OK');
