// src/editor-client/custom-kit-css.smoke.ts
//
// Regression guard for the "transparent active tab + missing accents in the
// editor for sites with styleKit === 'custom'" bug.
//
// Root cause: the editor's prebuilt stylesheet (editor-client/styles.css,
// generated from buildAllStyleKitsCss()) emits per-kit `[data-style-kit="X"]
// { --kit-accent: ...; ... }` blocks for the BUILT-IN kits only. The 'custom'
// kit preset lives on `EditableSite.customStyleKit` (per-site, runtime), so it
// never makes it into the editor's static stylesheet. Without a runtime
// injection, the editor's `<main class="opencanvas-editor" data-style-kit="custom">`
// has zero matching `[data-style-kit="custom"]` rule and every `var(--kit-accent)`
// reference paints transparent.
//
// The published renderer dodged this by injecting `buildStyleKitCss('custom',
// resolvedKit)` into the page's inline `<style>` block per request — see
// src/routes/public.ts. The editor previously had no equivalent.
//
// This smoke pins two contracts:
//   1. The editor-client modules that mirror `data-style-kit` onto
//      `<main class="opencanvas-editor">` ALSO call `applyCustomKitCss(state)`.
//      A missed callsite would silently revert the bug.
//   2. `buildStyleKitCss('custom', preset)` emits the legacy `--kit-accent` /
//      `--kit-bg` / `--kit-fg` aliases (and a non-empty `[data-style-kit="custom"]`
//      selector). Those aliases are what the editor canvas CSS reads. A drift
//      in style-kits.ts that drops the alias would re-break this path.
//
// Pure source-grep + import-and-invoke style — matches the existing
// editor-client smokes (no jsdom dependency in this directory).

declare const Bun: {
  file(input: URL): {
    text(): Promise<string>;
  };
};

import type { StyleKitPreset } from '../canvas/schema.js';
import { buildStyleKitCss } from '../canvas/style-kits.js';
import { CUSTOM_KIT_STYLE_ID } from './custom-kit-css.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[custom-kit-css:smoke] ${message}`);
}

async function source(name: string): Promise<string> {
  return Bun.file(new URL(name, import.meta.url)).text();
}

// --------------------------------------------------------------------------
// Contract 1: every editor-client module that mirrors data-style-kit onto
// `ctx.mainEl` for a freshly-loaded / mutated `ctx.state` must also call
// `applyCustomKitCss(ctx.state)` so the `<style id="opencanvas-editor-custom-
// kit-css">` block stays in sync. Without this, switching a site between
// custom and a built-in kit (or loading a custom-kit site) leaves the
// editor without `--kit-accent`/`--kit-bg`/`--kit-fg`.
// --------------------------------------------------------------------------

const WIRED_FILES = [
  './index.ts',
  './render.ts',
  './sidebar.ts',
  './ai-preview-panel.ts',
  './ai-integration.ts',
  './co-edit.ts',
  './sections-picker.ts',
] as const;

for (const file of WIRED_FILES) {
  const text = await source(file);
  assert(
    text.includes("from './custom-kit-css.js'") || text.includes("from './custom-kit-css.ts'"),
    `${file} must import applyCustomKitCss from ./custom-kit-css`,
  );
  assert(
    text.includes('applyCustomKitCss('),
    `${file} must call applyCustomKitCss(...) — kit-mirroring callsites would otherwise leave [data-style-kit="custom"] without a matching CSS block`,
  );
  // For every `setAttribute('data-style-kit'` call there must be an
  // `applyCustomKitCss(` call in the same file. The string count is a coarse
  // proxy that catches a future contributor adding a new mirror callsite
  // without the companion CSS injection.
  const mirrorCount = text.split("setAttribute('data-style-kit'").length - 1;
  const applyCount = text.split('applyCustomKitCss(').length - 1;
  assert(
    applyCount >= mirrorCount,
    `${file}: found ${String(mirrorCount)} setAttribute('data-style-kit') call(s) but only ${String(applyCount)} applyCustomKitCss(...) call(s). Every kit-mirror must pair with the custom-kit CSS injector.`,
  );
}

// --------------------------------------------------------------------------
// Contract 2: buildStyleKitCss('custom', preset) emits the [data-style-kit=
// "custom"] block AND the legacy `--kit-accent` / `--kit-bg` / `--kit-fg`
// aliases. The editor + public canvas CSS still reads the legacy aliases
// (e.g. `.opencanvas-tab[data-tab-active] { background: var(--kit-accent); }`)
// — if style-kits.ts drops the alias, the prebuilt editor stylesheet still
// works for built-in kits but the custom-kit path silently breaks again.
// --------------------------------------------------------------------------

const customPreset: StyleKitPreset = {
  bg: '#16140f',
  panel: '#1b1916',
  text: '#f6f4f0',
  muted: '#a39c92',
  accent: '#5b94ff',
  accentText: '#16140f',
  fontFamilyDisplay: 'Inter',
  fontFamilyBody: 'Inter',
  fontFamilyMono: 'JetBrains Mono',
  headingScale: 1,
  bodyScale: 1,
  labelScale: 0.85,
  lineHeight: 1.45,
  radius: '8px',
  borderWidth: '1px',
  shadow: 'none',
  shapeFill: '#5b94ff',
  shapeStroke: '#a39c92',
  shapeStrokeWidth: '1px',
  actionRadius: '8px',
  actionPadding: '10px 18px',
  motionDurationMs: 320,
  motionEasing: 'ease-out',
  surfaceVariants: {
    flat: {},
    raised: {},
    glass: {},
    outlined: {},
    sticker: {},
    'editorial-frame': {},
    'soft-panel': {},
  },
  actionVariants: {
    solid: {},
    outline: {},
    ghost: {},
    pill: {},
    glass: {},
    brutalist: {},
    underline: {},
  },
  motionPresets: {
    none: {},
    'fade-up': {},
    'fade-down': {},
    'fade-in': {},
    'fade-right': {},
    'slide-left': {},
    'slide-up': {},
    'slide-right': {},
    'scale-in': {},
    'zoom-out': {},
    'blur-in': {},
    'rotate-in': {},
    'flip-in': {},
    'bounce-in': {},
    'stagger-children': {},
    'slow-drift': {},
    'parallax-soft': {},
  },
};

const customCss = buildStyleKitCss('custom', customPreset);
assert(
  customCss.includes('[data-style-kit="custom"]'),
  'buildStyleKitCss("custom", preset) must emit a [data-style-kit="custom"] selector — otherwise the editor injection never matches the wrapper attribute',
);
assert(
  customCss.includes('--kit-accent: #5b94ff;'),
  'buildStyleKitCss must emit the legacy --kit-accent alias — .opencanvas-tab[data-tab-active] / .opencanvas-shape / .opencanvas-action read it directly',
);
assert(
  customCss.includes('--kit-bg: #16140f;'),
  'buildStyleKitCss must emit the legacy --kit-bg alias — .opencanvas-tab[data-tab-active] foreground reads it directly',
);
assert(
  customCss.includes('--kit-fg: #f6f4f0;'),
  'buildStyleKitCss must emit the legacy --kit-fg alias',
);
assert(
  customCss.includes('--opencanvas-kit-accent: #5b94ff;'),
  'buildStyleKitCss must emit the canonical --opencanvas-kit-accent token',
);

// --------------------------------------------------------------------------
// Contract 3: applyCustomKitCss is a no-op without `document`. Smoke-time
// safety so smokes calling it indirectly through createEditor stubs stay
// green.
// --------------------------------------------------------------------------

assert(
  typeof CUSTOM_KIT_STYLE_ID === 'string' && CUSTOM_KIT_STYLE_ID.length > 0,
  'CUSTOM_KIT_STYLE_ID must be a non-empty string — the editor needs a stable element id to dedupe the injected <style>',
);

// --------------------------------------------------------------------------
// Contract 4: the runtime behaviour itself, exercised against a minimal
// DOM stub. We install a fake `document` for the duration of the call so
// the helper's `typeof document === 'undefined'` guard does not skip.
// --------------------------------------------------------------------------

interface StubStyle {
  id: string;
  textContent: string;
  remove(): void;
}
interface StubHead {
  children: StubStyle[];
  appendChild(el: StubStyle): void;
}
interface StubDocument {
  head: StubHead;
  createElement(tag: string): StubStyle;
  getElementById(id: string): StubStyle | null;
}

const stubHead: StubHead = {
  children: [],
  appendChild(el: StubStyle): void {
    stubHead.children.push(el);
  },
};

const stubDocument: StubDocument = {
  head: stubHead,
  createElement(_tag: string): StubStyle {
    const id = '';
    const node: StubStyle = {
      id,
      textContent: '',
      remove(): void {
        const idx = stubHead.children.indexOf(node);
        if (idx >= 0) stubHead.children.splice(idx, 1);
      },
    };
    return node;
  },
  getElementById(id: string): StubStyle | null {
    for (const child of stubHead.children) {
      if (child.id === id) return child;
    }
    return null;
  },
};

// Pin globals — Bun lets us assign onto globalThis directly. We use
// untyped index access because the smoke's stub Document and stub
// HTMLStyleElement intentionally lie about being structural matches for
// the DOM types (everything the helper touches is mirrored; the rest is
// out of scope for this contract).
const g = globalThis as unknown as Record<string, unknown>;
const prevDocument = g.document;
const prevHtmlStyleElement = g.HTMLStyleElement;
g.document = stubDocument;
// Our stub StubStyle objects are not HTMLStyleElement instances. The helper
// uses `existing instanceof HTMLStyleElement` to differentiate a fresh
// element from a stale tag belonging to a different element type. Pin the
// constructor to a sentinel that accepts every stub style we ever create so
// the instanceof check returns true.
class FakeHtmlStyleElement {}
Object.setPrototypeOf(stubDocument, FakeHtmlStyleElement.prototype);
// instanceof relies on the right-hand side's prototype chain; mark every
// stub style as an instance by linking its prototype too.
const baseProto = {};
Object.setPrototypeOf(baseProto, FakeHtmlStyleElement.prototype);
const originalCreate = stubDocument.createElement.bind(stubDocument);
stubDocument.createElement = (tag: string): StubStyle => {
  const node = originalCreate(tag);
  Object.setPrototypeOf(node, baseProto);
  return node;
};
g.HTMLStyleElement = FakeHtmlStyleElement;

try {
  const { applyCustomKitCss } = await import('./custom-kit-css.js');

  // Case A: state with styleKit === 'custom' injects the <style> tag.
  const customState = {
    styleKit: 'custom' as const,
    customStyleKit: customPreset,
    pages: [],
  };
  applyCustomKitCss(customState);
  const injected = stubDocument.getElementById(CUSTOM_KIT_STYLE_ID);
  assert(injected !== null, 'applyCustomKitCss must inject the <style> tag for custom-kit state');
  assert(
    injected.textContent.includes('--kit-accent: #5b94ff;'),
    'injected <style> textContent must carry the resolved --kit-accent (the active-tab background reads this var)',
  );
  assert(
    injected.textContent.includes('[data-style-kit="custom"]'),
    'injected <style> textContent must include the [data-style-kit="custom"] selector',
  );

  // Case B: switching to a built-in kit removes the injected tag so the
  // stale custom block does not pollute the cascade.
  const builtInState = {
    styleKit: 'charcoal' as const,
    pages: [],
  };
  applyCustomKitCss(builtInState);
  assert(
    stubDocument.getElementById(CUSTOM_KIT_STYLE_ID) === null,
    'applyCustomKitCss must REMOVE the injected <style> when state.styleKit !== "custom" — otherwise the prior custom kit block stays in the cascade after a built-in switch',
  );

  // Case C: custom selector without customStyleKit is invalid at the
  // validator gate. The editor must fail loudly instead of silently
  // removing the style tag and painting a degraded no-accent preview.
  let missingCustomError = '';
  try {
    applyCustomKitCss({ styleKit: 'custom' as const, pages: [] });
  } catch (err) {
    missingCustomError = err instanceof Error ? err.message : String(err);
  }
  assert(
    missingCustomError.includes('customStyleKit'),
    'applyCustomKitCss must throw when styleKit === "custom" but customStyleKit is missing',
  );

  // Case D: null state is a no-op (boot order — pre-state-load callers may
  // hit this). Should still clear any stale tag.
  applyCustomKitCss(null);
  assert(
    stubDocument.getElementById(CUSTOM_KIT_STYLE_ID) === null,
    'applyCustomKitCss(null) must leave the head without the custom-kit <style>',
  );

  // Case E: re-injecting same CSS is idempotent (no orphan duplicate tags).
  applyCustomKitCss(customState);
  applyCustomKitCss(customState);
  let injectedCount = 0;
  for (const child of stubHead.children) {
    if (child.id === CUSTOM_KIT_STYLE_ID) injectedCount++;
  }
  assert(
    injectedCount === 1,
    `applyCustomKitCss must be idempotent — found ${String(injectedCount)} tags after two consecutive applies for the same state, expected 1`,
  );
} finally {
  if (prevDocument === undefined) {
    delete g.document;
  } else {
    g.document = prevDocument;
  }
  if (prevHtmlStyleElement === undefined) {
    delete g.HTMLStyleElement;
  } else {
    g.HTMLStyleElement = prevHtmlStyleElement;
  }
}

console.log('[custom-kit-css:smoke] OK');
