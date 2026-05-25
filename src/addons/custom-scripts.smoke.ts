// src/addons/custom-scripts.smoke.ts
//
// Smoke test for the Custom Scripts addon. Verifies that the emit functions
// pass through owner-pasted HTML verbatim and that the addon is discoverable
// via both id and slug lookups.
//
// Run with `bun.cmd run custom-scripts:smoke`.

import { allAddons, getAddon, getAddonBySlug } from './registry.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// --- Lookup tests ---

const byId = getAddon('addon_custom_scripts');
assert(byId !== undefined, 'getAddon should find addon_custom_scripts');
assert(byId!.id === 'addon_custom_scripts', 'id mismatch');

const bySlug = getAddonBySlug('custom-scripts');
assert(bySlug !== undefined, 'getAddonBySlug should find custom-scripts');
assert(bySlug!.slug === 'custom-scripts', 'slug mismatch');

assert(byId === bySlug, 'id and slug lookups should return the same object');

// Ensure allAddons includes both GA and custom scripts
assert(allAddons.length >= 2, 'allAddons must include at least 2 addons');
assert(
  allAddons.some((a) => a.id === 'addon_google_analytics'),
  'allAddons must include google-analytics',
);
assert(
  allAddons.some((a) => a.id === 'addon_custom_scripts'),
  'allAddons must include custom-scripts',
);

// --- emitHeadScripts tests ---

const addon = byId!;

const headHtml = '<script src="https://example.com/widget.js"></script>';
const headResult = addon.emitHeadScripts({ headScripts: headHtml });
assert(headResult === headHtml, `emitHeadScripts should pass through verbatim, got: ${headResult}`);

const emptyHeadResult = addon.emitHeadScripts({});
assert(emptyHeadResult === '', `emitHeadScripts with empty config should return empty string, got: "${emptyHeadResult}"`);

// --- emitBodyScripts tests ---

assert(addon.emitBodyScripts !== undefined, 'addon must have emitBodyScripts');

const bodyHtml = '<script>console.log("loaded")</script>';
const bodyResult = addon.emitBodyScripts!({ bodyScripts: bodyHtml });
assert(bodyResult === bodyHtml, `emitBodyScripts should pass through verbatim, got: ${bodyResult}`);

const emptyBodyResult = addon.emitBodyScripts!({});
assert(emptyBodyResult === '', `emitBodyScripts with empty config should return empty string, got: "${emptyBodyResult}"`);

// Mixed config — each emitter only returns its own field
const mixedConfig = { headScripts: '<script>head</script>', bodyScripts: '<script>body</script>' };
assert(
  addon.emitHeadScripts(mixedConfig) === '<script>head</script>',
  'emitHeadScripts should only return headScripts field',
);
assert(
  addon.emitBodyScripts!(mixedConfig) === '<script>body</script>',
  'emitBodyScripts should only return bodyScripts field',
);

console.log('✓ custom-scripts smoke passed');
