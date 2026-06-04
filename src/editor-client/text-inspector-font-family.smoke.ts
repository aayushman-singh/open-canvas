// src/editor-client/text-inspector-font-family.smoke.ts
//
// Smoke for the text-inspector "Font family" picker.
//
// Layers covered:
//   1. Schema — ElementStyle.fontFamily is a valid optional string slot
//      (typecheck-only, but the assignments below would fail to compile
//      if the field were removed).
//   2. Validator — pinned-style-style "injection-safe" check on
//      elementStyle.fontFamily; structural delimiters fail loudly, plain
//      family chains pass.
//   3. @font-face emitter — emitAllFontFaceBlocks produces stable,
//      sorted-by-hash output and matches the public-page contract.
//   4. Preset catalog — Google Fonts <link> contains every preset
//      family; the cssFamily chain quotes the family name and provides
//      a generic fallback.
//   5. Dropdown builder — buildFontOptions assembles the dropdown
//      against a stub <select>: starts with "(Style kit default)",
//      lists every preset under sans/serif/mono optgroups, lists
//      uploaded custom fonts last with a "(custom)" suffix, terminates
//      with "+ Upload custom font…", and reflects the element's
//      current fontFamily value as the selected option.
//   6. Filename helpers — deriveDisplayName + guessFontFamilyClass
//      handle the common filename shapes the upload pipeline meets.
//
// The smoke deliberately avoids exercising the upload + delete network
// paths because that requires a real fetch + auth context; the
// create-editor-runtime smoke already covers `authFetch` against a stub
// fetch, and the upload route has its own server-side fonts smoke.

import { validateEditableSite } from '../canvas/validate.js';
import type { CanvasElement, CanvasSection, EditableSite } from '../canvas/schema.js';
import { emitAllFontFaceBlocks } from '../fonts/face-emit.js';
import { FONT_PRESETS, fontPresetGoogleFontsLink } from '../fonts/preset-catalog.js';

import type { SiteFontEntry } from './editor-context.js';
import {
  KIT_DEFAULT_VALUE,
  UPLOAD_TRIGGER_VALUE,
  buildFontOptions,
  deriveDisplayName,
  guessFontFamilyClass,
} from './inspector-text-font-family.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[text-inspector-font-family:smoke] ${message}`);
}

// ---- 1 + 2. Schema + validator -------------------------------------------

function makeSnapshotWithFontFamily(fontFamily: string): EditableSite {
  const element: CanvasElement = {
    id: 'el-text-1',
    type: 'text',
    box: { x: 0, y: 0, w: 200, h: 60, z: 0 },
    content: [{ text: 'Hi', marks: [] }],
    role: 'heading',
    fontSize: 32,
    fontWeight: 600,
    align: 'left',
    elementStyle: { fontFamily },
  };
  const section: CanvasSection = {
    id: 'sec-1',
    recipeId: 'custom',
    name: 'main',
    height: 400,
    role: 'body',
    elements: [element],
  };
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-1',
        slug: 'home',
        title: 'Home',
        width: 1200,
        sections: [section],
      },
    ],
  };
}

{
  // Plain family chain passes validation.
  const snap = makeSnapshotWithFontFamily("'Inter', system-ui, sans-serif");
  const result = validateEditableSite(snap);
  assert(
    result.valid === true,
    `expected plain font-family chain to pass validation; errors: ${JSON.stringify(result.valid === false ? result.errors : null)}`,
  );
}

{
  // Structural delimiter (semicolon) gets rejected.
  const snap = makeSnapshotWithFontFamily('Inter; color: red');
  const result = validateEditableSite(snap);
  assert(
    result.valid === false,
    'expected font-family with a semicolon to fail validation (injection-safe check)',
  );
}

{
  // Braces (CSS escape) get rejected.
  const snap = makeSnapshotWithFontFamily('Inter} body{display:none');
  const result = validateEditableSite(snap);
  assert(
    result.valid === false,
    'expected font-family containing braces to fail validation (injection-safe check)',
  );
}

// ---- 3. @font-face emitter -----------------------------------------------

{
  const fontA: SiteFontEntry = {
    id: 'font-a',
    name: 'Logo Font',
    family: 'sans',
    weight: 400,
    style: 'normal',
    contentHash: 'aa'.repeat(32),
  };
  const fontB: SiteFontEntry = {
    id: 'font-b',
    name: 'Body Font',
    family: 'serif',
    weight: 500,
    style: 'italic',
    contentHash: 'bb'.repeat(32),
  };
  const css = emitAllFontFaceBlocks([fontB, fontA]);
  assert(css.includes(`font-family: "Logo Font"`), 'expected emit to include Logo Font @font-face');
  assert(css.includes(`font-family: "Body Font"`), 'expected emit to include Body Font @font-face');
  assert(css.includes('font-display: swap'), 'expected font-display:swap for FOUT control');
  assert(
    css.includes(`src: url('/fonts/${fontA.contentHash}') format('woff2')`),
    'expected @font-face src to point at /fonts/<contentHash>',
  );
  // Sorted by contentHash — fontA (aa...) before fontB (bb...).
  const idxA = css.indexOf('Logo Font');
  const idxB = css.indexOf('Body Font');
  assert(idxA < idxB, 'expected emitAllFontFaceBlocks to sort by contentHash (aa before bb)');
  // Deterministic across calls.
  const cssRepeat = emitAllFontFaceBlocks([fontA, fontB]);
  assert(cssRepeat === css, 'expected emitAllFontFaceBlocks to be stable across input orderings');
}

{
  const empty = emitAllFontFaceBlocks([]);
  assert(empty === '', 'expected empty siteFonts list to emit empty string');
}

// ---- 4. Preset catalog + Google Fonts link --------------------------------

{
  const link = fontPresetGoogleFontsLink();
  assert(link.startsWith('<link rel="preconnect"'), 'expected preset link to start with preconnect');
  assert(
    link.includes('https://fonts.googleapis.com/css2?'),
    'expected preset link to point at Google Fonts CSS2 endpoint',
  );
  assert(link.includes('display=swap'), 'expected display=swap on the Google Fonts query');
  for (const preset of FONT_PRESETS) {
    const bareLabel = preset.cssFamily.split(',')[0]!.trim().replace(/^'|'$/g, '');
    const encoded = encodeURIComponent(bareLabel).replace(/%20/g, '+');
    assert(
      link.includes(`family=${encoded}`),
      `expected preset link to include family=${encoded} (preset ${preset.label})`,
    );
  }
}

{
  // Every preset's cssFamily quotes the primary name and includes a
  // generic fallback. The first token is single-quoted, the chain ends
  // in sans-serif / serif / monospace.
  for (const preset of FONT_PRESETS) {
    assert(
      preset.cssFamily.startsWith("'"),
      `expected preset ${preset.label} cssFamily to start with a single quote`,
    );
    assert(
      /sans-serif$|serif$|monospace$/.test(preset.cssFamily),
      `expected preset ${preset.label} cssFamily to end in a generic family`,
    );
  }
}

// ---- 5. Dropdown builder --------------------------------------------------
//
// Bun has no DOM, so the smoke hand-rolls a tiny <select>-like stub
// that captures the option contract buildFontOptions needs.

interface StubOption {
  value: string;
  textContent: string;
  attributes: Map<string, string>;
  parent: StubElement | null;
}
interface StubElement {
  tagName: string;
  label?: string;
  value: string;
  children: Array<StubOption | StubElement>;
  options: StubOption[];
  setAttribute(name: string, value: string): void;
  replaceChildren(): void;
  appendChild(child: StubOption | StubElement): StubOption | StubElement;
  insertBefore(node: StubOption | StubElement, ref: StubOption | StubElement | null): StubOption | StubElement;
}

function makeOption(): StubOption {
  return {
    value: '',
    textContent: '',
    attributes: new Map(),
    parent: null,
  };
}

function makeElement(tag: string): StubElement {
  return {
    tagName: tag,
    value: '',
    children: [],
    options: [],
    setAttribute(_n, _v) {
      /* noop for select-level attrs */
    },
    replaceChildren() {
      this.children.length = 0;
      this.options.length = 0;
    },
    appendChild(child) {
      this.children.push(child);
      if ('tagName' in child && child.tagName === 'OPTION') {
        // OPTION nodes carry both a .tagName (from the createElement
        // bridge) and the StubOption shape (.value/.textContent). The
        // stub document.createElement('OPTION') returns the Object.assign
        // hybrid; narrow it back here so the option lands in .options
        // for the dropdown-walk assertions.
        const opt = child as unknown as StubOption;
        this.options.push(opt);
      } else if ('options' in child) {
        // OPTGROUP — bubble its child options up so the parent <select>'s
        // .options reflects everything the dropdown would surface to the
        // user, matching the DOM HTMLSelectElement.options contract.
        for (const opt of child.options) {
          this.options.push(opt);
        }
      } else if ('attributes' in child) {
        this.options.push(child);
      }
      return child;
    },
    insertBefore(node, ref) {
      const idx = ref ? this.children.indexOf(ref) : this.children.length;
      const at = idx < 0 ? this.children.length : idx;
      this.children.splice(at, 0, node);
      if ('attributes' in node && !('tagName' in node)) {
        this.options.unshift(node);
      }
      return node;
    },
  };
}

// Monkey-patch a minimal global `document` so buildFontOptions's
// document.createElement calls resolve. The factories return the stubs
// above; nothing else in buildFontOptions touches the DOM.
const fakeDocument = {
  createElement(tag: string): unknown {
    const upper = tag.toUpperCase();
    if (upper === 'OPTION') {
      const opt = makeOption();
      // bridge: setAttribute should land in opt.attributes; tagged so the
      // type-cast back in buildFontOptions stays sound.
      return Object.assign(opt, {
        setAttribute(name: string, value: string) {
          opt.attributes.set(name, value);
        },
        tagName: upper,
      });
    }
    if (upper === 'OPTGROUP') {
      const group = makeElement(upper);
      return group;
    }
    if (upper === 'SELECT') {
      return makeElement(upper);
    }
    throw new Error(`[smoke] unexpected createElement(${tag})`);
  },
};

const globalAny = globalThis as unknown as { document: typeof fakeDocument };
const previousDocument = globalAny.document;
globalAny.document = fakeDocument;
try {
  const stubSelect = fakeDocument.createElement('SELECT') as StubElement & {
    options: Array<{ value: string; textContent: string }>;
    value: string;
  };

  const siteFonts: SiteFontEntry[] = [
    {
      id: 'font-x',
      name: 'Logo Sans',
      family: 'sans',
      weight: 400,
      style: 'normal',
      contentHash: 'cc'.repeat(32),
    },
  ];

  // No current value → "(Style kit default)" sits at position 0 and is selected.
  buildFontOptions(stubSelect as unknown as HTMLSelectElement, FONT_PRESETS, siteFonts, undefined);
  assert(stubSelect.options.length > 0, 'buildFontOptions must emit at least one option');
  const firstOpt = stubSelect.options[0]!;
  assert(
    firstOpt.value === KIT_DEFAULT_VALUE,
    `expected first option to be Style-kit-default sentinel, got ${firstOpt.value}`,
  );
  assert(
    firstOpt.textContent.toLowerCase().includes('style kit'),
    `expected first option label to mention "Style kit"; got ${firstOpt.textContent}`,
  );
  const valueList = stubSelect.options.map((o) => o.value);
  for (const preset of FONT_PRESETS) {
    assert(
      valueList.includes(preset.cssFamily),
      `expected preset ${preset.label} cssFamily to appear in dropdown values`,
    );
  }
  assert(
    valueList.includes('Logo Sans'),
    'expected custom font name to appear as a dropdown value',
  );
  const customOpt = stubSelect.options.find((o) => o.value === 'Logo Sans');
  assert(
    customOpt !== undefined && customOpt.textContent.includes('(custom)'),
    'expected custom font label to include the "(custom)" tag',
  );
  const lastOpt = stubSelect.options[stubSelect.options.length - 1]!;
  assert(
    lastOpt.value === UPLOAD_TRIGGER_VALUE,
    `expected the last option to be the upload trigger; got ${lastOpt.value}`,
  );

  // Current value is a known preset → select reflects it.
  buildFontOptions(
    stubSelect as unknown as HTMLSelectElement,
    FONT_PRESETS,
    siteFonts,
    FONT_PRESETS[0]!.cssFamily,
  );
  assert(
    stubSelect.value === FONT_PRESETS[0]!.cssFamily,
    'expected dropdown to reflect the element\'s current preset selection',
  );

  // Current value is the custom font name → select reflects it.
  const customName: string = 'Logo Sans';
  buildFontOptions(stubSelect as unknown as HTMLSelectElement, FONT_PRESETS, siteFonts, customName);
  assert(
    stubSelect.value === customName,
    'expected dropdown to reflect custom font selection',
  );

  // Current value is unknown to both lists → synthesize a "(current)" option.
  const mysteryFamily: string = "'Mystery', cursive";
  buildFontOptions(
    stubSelect as unknown as HTMLSelectElement,
    FONT_PRESETS,
    siteFonts,
    mysteryFamily,
  );
  assert(
    stubSelect.value === mysteryFamily,
    'expected unknown current value to be preserved as a synthesized option',
  );
} finally {
  if (previousDocument === undefined) {
    delete (globalAny as { document?: unknown }).document;
  } else {
    globalAny.document = previousDocument;
  }
}

// ---- 6. Filename helpers --------------------------------------------------

assert(deriveDisplayName('logo-font.woff2') === 'Logo Font', 'deriveDisplayName kebab → title case');
assert(
  deriveDisplayName('my_custom_face.ttf') === 'My Custom Face',
  'deriveDisplayName snake_case → title case',
);
assert(deriveDisplayName('Foo.otf') === 'Foo', 'deriveDisplayName single word stays title-cased');
assert(deriveDisplayName('   .woff') === 'Custom Font', 'deriveDisplayName empty base falls back');

assert(guessFontFamilyClass('jetbrains-mono-regular.woff2') === 'mono', 'mono keyword detection');
assert(guessFontFamilyClass('code-pro.woff2') === 'mono', 'code keyword detection');
assert(guessFontFamilyClass('eb-garamond.woff2') === 'serif', 'garamond → serif');
assert(guessFontFamilyClass('playfair-display.woff2') === 'serif', 'playfair → serif');
assert(guessFontFamilyClass('inter-regular.woff2') === 'sans', 'sans is the default class');

console.log('[text-inspector-font-family:smoke] OK');
