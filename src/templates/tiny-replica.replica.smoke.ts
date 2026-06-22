import { renderBuiltInTemplatePreviewBodyHtml } from './built-in-preview.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import { validateEditableSite, validatePublishedSnapshot, validateSeedFixture } from '../canvas/validate.js';
import { getTemplateSeed, instantiateTemplate } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[tiny-replica:replica-smoke] ' + message);
}

const seed = getTemplateSeed('tiny-replica');
assert(seed !== null, 'getTemplateSeed(\'tiny-replica\') must resolve generated template');

const state = instantiateTemplate('tiny-replica');

const editable = validateEditableSite(state);
if (!editable.valid) {
  throw new Error('[tiny-replica:replica-smoke] ' + editable.errors.join('\\n'));
}

const seedFixture = validateSeedFixture(state);
if (!seedFixture.valid) {
  throw new Error('[tiny-replica:replica-smoke] ' + seedFixture.errors.join('\\n'));
}

const published = validatePublishedSnapshot({ ...state, version: 1, publishedAt: '2026-06-22T00:00:00.000Z' });
if (!published.valid) {
  throw new Error('[tiny-replica:replica-smoke] ' + published.errors.join('\\n'));
}

const html = renderBuiltInTemplatePreviewBodyHtml('tiny-replica', {
  turnstileSiteKey: '1x00000000000000000000AA',
});
for (const token of [
  "Tiny Replica",
  "Deterministic hero"
]) {
  assert(html.includes(token), 'preview must include required copy ' + JSON.stringify(token));
}
for (const assetId of [
  "seed-tiny-replica-mark"
]) {
  assert(getSeedAsset(assetId) !== null, 'seed asset must be registered ' + assetId);
  assert(html.includes(assetId), 'preview must include seed asset id ' + assetId);
}
for (const token of [
  "React",
  "gsap",
  "ScrollTrigger"
]) {
  assert(!html.toLowerCase().includes(String(token).toLowerCase()), 'preview must not include forbidden runtime token ' + token);
}
for (const token of [
  "Tiny Replica",
  "Deterministic hero",
  "seed-tiny-replica-mark"
]) {
  assert(html.includes(token), 'native fidelity evidence missing ' + JSON.stringify(token));
}
for (const unsupportedId of [
  "custom-cursor"
]) {
  assert(unsupportedId.length > 0, 'unsupported finding id must be non-empty');
}

console.log('[tiny-replica:replica-smoke] OK');
