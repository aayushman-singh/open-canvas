import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasPage, CanvasSection, EditableSite, PublishedSnapshot } from '../schema.js';
import { validateEditableSite } from '../validate.js';
import { decodeYDoc, encodeYDoc } from '../yjs-projection.js';
import { embedInspectorSpec, renderEmbed, type EmbedElement } from './embed.js';
import { INTERACTIVE_RUNTIME_SRC } from '../../interactive/build.js';
import { snapshotNeedsInteractiveRuntime } from '../../interactive/inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[embed-drill-in:smoke] ' + message);
}

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoSrcDir = join(thisDir, '..', '..');

function makeEmbed(overrides: Partial<EmbedElement> = {}): EmbedElement {
  return {
    id: 'embed-drill-in',
    type: 'embed',
    box: { x: 0, y: 0, w: 720, h: 405, z: 1 },
    url: 'https://example.com/drill-in',
    title: 'Telemetry board',
    aspectRatio: 16 / 9,
    drillInEnabled: true,
    drillInReducedMotion: 'allow',
    ...overrides,
  };
}

function makeSite(embed: EmbedElement): EditableSite {
  const section: CanvasSection = {
    id: 'embed-section',
    recipeId: 'custom',
    name: 'Embed section',
    height: 640,
    elements: [embed],
  };
  const page: CanvasPage = {
    id: 'embed-page',
    slug: 'embed',
    title: 'Embed',
    width: 1200,
    sections: [section],
  };
  return { styleKit: 'charcoal', pages: [page] };
}

const goodState = makeSite(makeEmbed());
const good = validateEditableSite(goodState);
assert(good.valid, good.valid ? 'valid drill-in embed should pass' : good.errors.join('; '));

const invalidState = makeSite(
  makeEmbed({ drillInReducedMotion: 'slow' as unknown as NonNullable<EmbedElement['drillInReducedMotion']> }),
);
const invalid = validateEditableSite(invalidState);
assert(!invalid.valid, 'invalid drill-in reduced-motion mode must fail validation');
assert(
  invalid.errors.some((error) => error.includes('drillInReducedMotion')),
  `validation error must name drillInReducedMotion; got ${invalid.valid ? 'valid' : invalid.errors.join(' | ')}`,
);

const html = renderEmbed(makeEmbed(), { styleKit: 'charcoal' });
assert(html.includes('data-opencanvas-embed-drill-in="true"'), 'renderer must emit drill-in flag');
assert(
  html.includes('data-opencanvas-embed-drill-in-src="https://example.com/drill-in"'),
  'renderer must emit resolved drill-in iframe src',
);
assert(
  html.includes('data-opencanvas-embed-drill-in-title="Telemetry board"'),
  'renderer must emit drill-in title metadata',
);
assert(
  html.includes('data-opencanvas-embed-drill-in-reduced-motion="allow"'),
  'renderer must emit drill-in reduced-motion metadata',
);
assert(html.includes('role="button"'), 'drill-in embed wrapper must be keyboard-addressable');

const decoded = decodeYDoc(encodeYDoc(goodState));
const decodedEmbed = decoded.pages[0]!.sections[0]!.elements[0]! as EmbedElement;
assert(decodedEmbed.drillInEnabled === true, 'Yjs projection must preserve drill-in enabled');
assert(
  decodedEmbed.drillInReducedMotion === 'allow',
  'Yjs projection must preserve drill-in reduced-motion policy',
);

const snapshot: PublishedSnapshot = {
  ...goodState,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
assert(snapshotNeedsInteractiveRuntime(snapshot), 'drill-in embed must require visitor runtime');
assert(
  INTERACTIVE_RUNTIME_SRC.includes('hydrateEmbedDrillIns'),
  'Runtime Hydrator bundle must include embed drill-in hydration',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes('opencanvas:embed-drill-in-failed'),
  'embed drill-in runtime must emit a named failure event',
);

assert(
  embedInspectorSpec.fields.some((field) => field.kind === 'checkbox' && field.path === 'drillInEnabled'),
  'embed inspector must expose drill-in enabled toggle',
);
assert(
  embedInspectorSpec.fields.some((field) => field.kind === 'select' && field.path === 'drillInReducedMotion'),
  'embed inspector must expose drill-in reduced-motion select',
);

const publicStyles = readFileSync(join(repoSrcDir, 'canvas', 'public-styles.ts'), 'utf8');
assert(
  publicStyles.includes('data-opencanvas-embed-drill-in="true"'),
  'public styles must include drill-in affordance selectors',
);

const packageJson = JSON.parse(readFileSync(join(repoSrcDir, '..', 'package.json'), 'utf8')) as {
  scripts: Record<string, string | undefined>;
};
assert(
  packageJson.scripts['embed-drill-in:smoke'] === 'bun run src/canvas/elements/embed-drill-in.smoke.ts',
  'package.json must expose embed-drill-in:smoke',
);
assert(
  packageJson.scripts['ci:smoke']?.includes('embed-drill-in:smoke') === true,
  'ci:smoke must include embed-drill-in:smoke',
);

console.log('[embed-drill-in:smoke] OK');

