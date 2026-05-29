# ADR 0014 — Compile-time data substitution for template-literal-bound client scripts

**Status:** Proposed
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** Theme A of the rev01 OSS code review (handoff-rev01-batch-27 §"Theme A — Cross-file enum + helper mirrors") for the subset bound inside template-literal-emitted client scripts.

## Context

The editor's client-side bootstrap lives in `src/editor/canvas-client.ts` as a function that returns a string. The string is the JavaScript the browser runs. The route embeds it inline via `raw()`. Because the script body is a *template literal*, the only TS values that reach the browser script are the ones explicitly interpolated with `${...}` at function-call time. Every other constant in the body is a JS literal *spelled inside the string*.

The file's author deliberately restricts interpolation to three call-time parameters (`siteId`, `apiBase`, `wsToken`) — see the header comment:

> "The only interpolation is params.siteId, which the route validates ... Two safe interpolations: siteId and apiBase. Both are validated above. Everything inside the IIFE is plain JavaScript, not TypeScript."

The reason is explicit in another comment block and reinforced by a standing memory entry: escape sequences are interpreted twice (once by TypeScript when the template literal is parsed, once by the browser when the emitted script is parsed), and a stray backtick anywhere inside the template literal closes it silently — the build still passes, smokes still pass, the editor breaks. Every `${...}` interpolation is a hazard surface for that class of bug. The author chose to keep the interpolation surface small.

The consequence is that every constant the canvas-client script needs — every schema enum, every numeric bound, every regex shape — is *redeclared inside the template literal* as a JS literal. The redeclarations currently number around twelve, each carrying a comment that says some version of "mirrors `X`; if you add a value there, add it here too":

- `STYLE_KITS` (line 53) — mirrors `schema.ts:STYLE_KITS`
- `ACTION_VARIANTS` (line 54) — mirrors `schema.ts:ACTION_VARIANTS`
- `SURFACE_VARIANTS` (line 55) — mirrors `schema.ts:SURFACE_VARIANTS`
- `SHAPE_VARIANTS` (line 56) — mirrors `schema.ts:SHAPE_VARIANTS`
- `MOTION_PRESETS` (line 57) — mirrors `schema.ts:MOTION_PRESETS`
- `CANONICAL_MARK_ORDER` (line 70) — set matches `schema.ts:INLINE_MARK_TYPES` (different order; same membership)
- `SCROLL_TRIGGER_MODES` (line 73) — mirrors `schema.ts:SCROLL_TRIGGER_MODES`
- `MIN_ELEMENT_SIZE_PX` (line 75) — mirrors `validate.ts` bounds
- `DEFAULT_PAGE_WIDTH_PX` (line 87) — mirrors `validate.ts` page-width bounds
- `COEDIT_RECONNECT_BASE_DELAY_MS` / `MAX_DELAY_MS` / `MAX_ATTEMPTS` (lines 92, 93, 99) — mirror `src/live/co-edit/client.ts`
- `TEXT_FONT_SIZE_MIN` / `MAX` (lines 102, 103) — mirror `validate.ts`
- `TEXT_FONT_WEIGHT_CHOICES` (line 106) — mirrors `schema.ts:TextElement.fontWeight` union
- `SITE_ID_RE` (line 30, before the IIFE; checked at line 36 inside the function) — mirror of `routes/api/sites.ts:SUBDOMAIN_RE` shape concerns and a 5-place drift surface confirmed by the 2026-05-28 verification pass

The Owner-perceived failure mode is silent. A developer adds a new motion preset to `schema.ts`. Server-side rendering uses it; the inspector preset picker does not show it; the LLM-emitted designs that use the new preset render invisibly because the editor doesn't recognise the value. The Owner reports "I see this preset in the docs but not in my editor." The contributor reads `schema.ts`, sees the preset is present, and is confused. The mirror comment in canvas-client.ts is the only signal of the second edit required, and comments don't enforce.

This ADR specifies a mechanism to make those mirrors derived rather than duplicated, without losing the author's interpolation-hazard discipline.

## Decisions

1. **Compile-time substitution replaces designated tokens in template-literal-bound client scripts with JSON-serialised values from named TS exports.** A small build-step transform (an esbuild plugin in the current toolchain) walks the source of files marked for substitution, finds well-formed token identifiers, looks up the referenced TS export at build time, JSON-serialises the value, and emits the substituted source as the build artifact.

   **Why:** the author's constraint — minimise runtime template-literal interpolations because each one is a backtick/escape hazard — is real and worth respecting. Runtime injection (replacing the inline literals with `${JSON.stringify(IMPORTED_VALUE)}`) would solve the data-sharing problem at the cost of adding twelve new interpolation hazards inside a 7500-line template-literal body. Compile-time substitution moves the work to before the template-literal is ever parsed by the TS compiler: at build time the source file already has the JSON-literal values in place, and the runtime interpolation surface stays at three. The result is a script that ships with derived values without trading off the safety property that made the author duplicate them in the first place.

   This would be wrong if the build pipeline (ADR-0015, build pipeline, currently outstanding) eliminated the template-literal constraint entirely — at which point client-side code would import TS modules normally and substitution would be obsolete. This ADR scopes the substitution to template-literal-bound scripts on purpose and is explicitly replaceable when ADR-0015 lands; until then, the duplication is a daily cost the substitution mechanism removes.

2. **Tokens are well-formed JS identifiers; the pre-substitution source remains valid TypeScript that compiles and emits a working (if not derived-data-driven) build.** A token looks like `__INJECT_SCHEMA__INLINE_MARK_TYPES__` — a normal identifier the plugin recognises by prefix. Before substitution, the token resolves to a hand-maintained `const` of the same name and value declared elsewhere in the file (or to a thrown sentinel that fails loudly if reached). After substitution, every token usage site is replaced with the literal JSON serialisation of the referenced export.

   **Why:** a pre-substitution source that doesn't compile is a tooling-coupled codebase — readers can't run `bun run typecheck` against the canonical source without also running the build plugin. Keeping the source compilable means the substitution plugin is a *transformation*, not a *prerequisite*. It also keeps `bun run review:smoke` (the existing safety net the author cites for catching template-literal breakage) viable, because the smoke can run against the pre-substitution source. Readers see a token and a sentinel; they know the value is substituted at build time without needing to run anything.

3. **The substitution target scope is pure data: arrays of strings, numbers, booleans, and regex sources. Functions, classes, and Maps are out of scope.** A token references an export whose value is JSON-serialisable (or, in the regex case, has a `.source` string the plugin reads). The plugin rejects exports that don't fit — Maps, class instances, functions, anything with cycles.

   **Why:** the template-literal-bound script can only consume *data* spelled as JS literals; that's what JSON serialisation produces. Asking the substitution to handle functions or classes would require either compiling them to inline JS source (effectively reimplementing the bundler, which is ADR-0015's scope) or shipping a `Function('...')` blob (a CSP violation and a maintenance nightmare). The narrow data-only scope is exactly the slice the current mirrors occupy. Anything richer is ADR-0015's problem.

4. **The plugin fails the build loudly on any of: an unrecognised token, a referenced export that does not exist, a referenced value that is not JSON-serialisable, or a regex referenced without a `.source` accessor.** No silent skip, no "warn and continue," no default fallback that ships the pre-substitution source.

   **Why:** the rule per CLAUDE.md. The point of compile-time substitution is to make drift a build error. A plugin that fails open — substituting where it can, leaving tokens behind where it can't — produces a script with mixed derived-and-stale data, which is worse than the current "all mirrored, all stale together" state because the failure mode becomes "some values are right, some are wrong, none of the comments help you tell which."

5. **A smoke imports the emitted (post-substitution) `canvas-client.js` and asserts every previously-mirrored constant equals the corresponding export from its TS source.** The smoke is the safety net for the substitution mechanism itself: it catches "plugin transformed correctly but produced the wrong value," "schema export changed shape and the substitution still resolves but to garbage," and "new mirror was added to canvas-client.ts but no substitution token was assigned to it."

   **Why:** the plugin's loud-failure on missing tokens (decision 4) catches "added a token, forgot the export." It does not catch "added a new mirrored constant without making it a token in the first place." The smoke is the catch for that class — it enumerates the substitution registry and asserts every entry round-trips, and it greps the post-substitution source for any remaining `const FOO = [..literal..]` declarations whose name matches an export elsewhere in the codebase, failing on unexpected matches.

6. **The substitution registry lives next to the plugin (e.g. `tools/substitution-registry.ts`) and lists `{ token: string; sourceModule: string; sourceExport: string }` triples. Adding a new substitution is a single registry entry plus a token swap in the consumer file.**

   **Why:** the registry is the single source of truth for what substitutes into what. Scattering substitution metadata as plugin comments inside consumer files would reproduce the mirror-comment problem in a different shape — readers would have to grep for `// substituted from ...` to know what's derived. A central registry is greppable and reviewable; "what enums are shared across servers?" answers itself in one file.

## Out of scope

- **Removing the template-literal constraint entirely.** That is ADR-0015 (build pipeline). When it lands, this ADR's mechanism becomes redundant and is removed; its decisions are explicitly designed to be replaceable.
- **Substituting non-data values** (functions, classes, complex objects). Decision 3 carves this out; it belongs in ADR-0015's scope of "ship pre-compiled TS modules as client assets."
- **Substituting into `canvas-styles.ts` CSS strings or `public-styles.ts` server-rendered CSS.** Those are CSS, not TS-enum-derived data; if they grow shared-with-TS constants (e.g. media-query breakpoint values), they become candidates in a follow-up but the substitution shape (CSS variable, not JSON literal) is different.
- **The element registry distribution (ADR-0011 step 5 — client renderer dispatch).** That dispatch is a function table; per decision 3 it cannot ride this mechanism. ADR-0011's step 5 explicitly depends on ADR-0015 for delivery, not on this ADR.
- **`agent/canvas-tools.ts` JSON schemas referencing schema enums.** Those are server-side TS and already import the enum constants directly; the file is not template-literal-bound and has no substitution problem.
- **Replacing the existing mirror comments wholesale before the plugin ships.** The migration is per-token; comments stay until each constant has been swapped to its substitution token.

## Consequences

**Positive:**

- A developer adds a value to a schema enum, runs the build, the editor surfaces it. The mirror comments — and the class of "I forgot to update the other one" bugs they document — vanish for every migrated constant.
- The author's interpolation-hazard discipline is preserved. Runtime template-literal interpolation count stays at three. Backtick / escape risk doesn't grow as substitutions accumulate.
- Drift becomes a build error rather than a silent runtime divergence. The Owner-perceived "I see it in the docs but not the editor" failure mode disappears at the build step.
- The `SITE_ID_RE` 5-place drift surface collapses to one source for the three server-side consumers (via normal TS imports) and one substituted token for the canvas-client.ts consumer.
- The build plugin is small (well under 200 LOC for the substitution itself) and has a narrow contract — easier to audit than a full bundler restructure.

**Negative:**

- A new piece of build infrastructure exists. The plugin must be maintained; its failure modes must be understood; new contributors need to know it exists. Today the build is "esbuild + wrangler"; tomorrow it is "esbuild with one plugin + wrangler."
- The pre-substitution source has placeholder values (or sentinel `const`s); a reader looking at `canvas-client.ts` and noticing `__INJECT_SCHEMA__MOTION_PRESETS__` has to know what that means. The registry makes the answer one file away, but the indirection is real.
- The mechanism is explicitly transitional. When ADR-0015 ships and removes the template-literal constraint, this ADR is superseded, the plugin is deleted, and consumers go back to `import`. Two build-mechanism changes instead of one. The justification (decision 1's "daily cost the substitution removes today") is that ADR-0015 is not close to landing and the drift cost is incurred every time a schema field changes.
- The smoke in decision 5 needs to maintain its registry of "previously-mirrored constants" — itself a small drift surface. Less load-bearing than the runtime drift it replaces, but not zero.

## Follow-ups

- Ship the plugin (`tools/inject-substitutions.ts` or similar) plus the registry. Test it on one constant first (`STYLE_KITS` is the simplest — string array, single source, three current call sites). Migrate the rest only after the plugin's failure modes are exercised.
- Migrate the twelve mirrored constants in `canvas-client.ts` in token-by-token PRs, each PR deleting one mirror's comment and adding one registry entry. Mechanical, parallel-agent-friendly.
- Add the substitution-coverage smoke per decision 5.
- Document the plugin in the README's "Build" section: what it does, what the token shape is, how to add a substitution.
- When ADR-0015 (build pipeline) lands and removes the template-literal constraint: supersede this ADR, delete the plugin, delete the registry, convert tokens back to normal `import` statements.
- ADR-0011 (canvas element registry) step 2 (agent tool dispatch) is unaffected by this ADR — that work is server-side and proceeds independently. ADR-0011 step 5 (client renderer dispatch) is *blocked* on ADR-0015, not on this ADR.
