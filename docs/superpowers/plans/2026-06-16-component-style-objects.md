# Component Style Objects Implementation Plan

> **For audit:** Completed implementation plan. Checked steps record the red/green sequence that shipped ADR 0067.

**Goal:** Ship ADR 0067 Component Style objects for Form, Accordion, Tabs, Carousel, and Collection with validator/render/editor/Yjs/agent coverage.

**Architecture:** Per-element style objects stay local to their element modules and emit component-scoped CSS variables on the outer wrapper. One shared editor Component Style panel renders per-element field metadata. Collection rendering is corrected so materialized entries are visible before CollectionStyle lands.

**Tech Stack:** TypeScript, Bun smoke tests, existing canvas render/validate/Yjs/editor-client modules.

**Execution status:** Completed on 2026-06-16. Collection assertions were folded into `src/canvas/component-style.smoke.ts`; the editor panel shipped as `src/editor-client/inspector-component-style.ts` with `bun run inspector-component-style:smoke`.

---

## File Map

- `src/canvas/elements/component-style.ts`: shared style field metadata, CSS variable mapping helpers, conflict key helpers.
- `src/canvas/component-style.smoke.ts`: validator/render/Yjs/agent smoke for Form/Accordion/Tabs/Carousel/Collection.
- `src/canvas/elements/form.ts`: extend `FormStyle`, emit Form style vars for new fields, export metadata.
- `src/canvas/elements/accordion.ts`: add `AccordionStyle`, emit metadata, agent fields.
- `src/canvas/elements/tabs.ts`: add `TabsStyle`, emit metadata, agent fields.
- `src/canvas/elements/carousel.ts`: add `CarouselStyle`, emit metadata, agent fields.
- `src/canvas/elements/collection.ts`: add `CollectionStyle`, render entries, emit metadata, agent fields.
- `src/canvas/render.ts`: emit Component Style vars after `pinnedStyle` on wrapper.
- `src/canvas/validate.ts`: validate style objects, reject unknown keys, reject modeled `pinnedStyle` conflicts.
- `src/canvas/yjs-projection.ts`: encode/decode each style object as nested sparse map.
- `src/canvas/elements/index.ts`: export new style metadata/types where needed.
- `src/editor-client/inspector-component-style.ts`: shared inspector panel.
- `src/editor-client/runtime-helpers.ts` and `src/editor-client/index.ts`: register generic mount handler.
- `src/editor-client/body-builders-data.ts`: use public component DOM/classes for styled parts and apply style variable contract.
- `src/editor-client/styles-build.ts`: include public component CSS variable selectors for editor preview.
- `package.json`: add new smoke scripts and wire them into `ci:smoke`.

## Task 1: Red Tests For Non-Collection Style Objects

- [x] Add `src/canvas/component-style.smoke.ts` with assertions:
  - validator accepts sparse `accordionStyle`, `tabsStyle`, `carouselStyle`, and extended `formStyle`
  - validator rejects unknown keys
  - validator rejects `pinnedStyle` conflicts for modeled keys
  - render emits Component Style variables on `.opencanvas-element` wrapper
  - Yjs round-trips the style objects
  - agent specs accept style patch objects and reject invalid primitive types
- [x] Add package script `"component-style:smoke": "bun run src/canvas/component-style.smoke.ts"`.
- [x] Run `bun run component-style:smoke`.
- [x] Verified red run failed before implementation because style objects/validator/renderer did not exist yet.

## Task 2: Implement Form/Accordion/Tabs/Carousel Style Objects

- [x] Add shared style metadata and helpers in `src/canvas/elements/component-style.ts`.
- [x] Extend Form, Accordion, Tabs, and Carousel element types with their style objects and metadata.
- [x] Map style fields to CSS variables on the wrapper in `src/canvas/render.ts` after `pinnedStyle`.
- [x] Add validator support for known keys, typed values, and pinned conflict rejection.
- [x] Add Yjs encode/decode for the four style objects.
- [x] Add agent patch surfaces for the four style objects.
- [x] Run `bun run component-style:smoke`.
- [x] Verified green run passed.

## Task 3: Red Tests For Generic Editor Panel

- [x] Add editor smoke coverage to `src/editor-client/inspector-component-style.smoke.ts`.
- [x] Assert the panel writes sparse style fields, clears fields, deletes empty style object, and removes conflicting pinned keys.
- [x] Assert Form/Accordion/Tabs/Carousel body builders use public component class/attr contract for styled parts.
- [x] Add package script `"inspector-component-style:smoke": "bun run src/editor-client/inspector-component-style.smoke.ts"`.
- [x] Run `bun run inspector-component-style:smoke`.
- [x] Verified red run failed before implementation because generic panel and class parity were not implemented.

## Task 4: Implement Generic Editor Panel And Preview Parity

- [x] Create `src/editor-client/inspector-component-style.ts`.
- [x] Register generic `component-style` mount handler through editor runtime helper plumbing.
- [x] Replace element-specific style mounts with metadata-driven panel where applicable.
- [x] Update body builders so styled inner DOM uses public class names/attributes.
- [x] Add editor CSS rules that consume the same component-scoped variables.
- [x] Run `bun run inspector-component-style:smoke`.
- [x] Verified green run passed.

## Task 5: Red Tests For Collection Render And CollectionStyle

- [x] Add Collection render and `collectionStyle` assertions to `src/canvas/component-style.smoke.ts`.
- [x] Assert `renderCollection` emits materialized `entries` through `renderChild`.
- [x] Assert `collectionStyle` vars live on the host wrapper and are inherited by built-in `card` / `image-only` entry chrome.
- [x] Assert `custom` display keeps template-owned chrome and does not mutate child elements.
- [x] Keep Collection assertions under package script `"component-style:smoke": "bun run src/canvas/component-style.smoke.ts"`.
- [x] Run `bun run component-style:smoke`.
- [x] Verified red run failed before implementation because `renderCollection` emitted only an empty frame and `collectionStyle` did not exist.

## Task 6: Implement Collection Render And CollectionStyle

- [x] Add `CollectionStyle` to `src/canvas/elements/collection.ts`.
- [x] Render materialized `entries` inside `.opencanvas-collection`.
- [x] Add mode-aware built-in card/image wrappers that read host variables without mutating cloned children.
- [x] Add validator/Yjs/agent/editor support for `collectionStyle`.
- [x] Run `bun run component-style:smoke`.
- [x] Verified green run passed.

## Task 7: Final Verification

- [x] Run targeted smokes:
  - `bun run component-style:smoke`
  - `bun run inspector-component-style:smoke`
  - `bun run variant-presets:smoke`
  - `bun run collection-materializer:smoke`
  - `bun run yjs-projection:smoke`
  - `bun run agent-tool-dispatch:smoke`
- [x] Run `bun run typecheck`.
- [x] Run `bun run lint`.
- [x] Review `git diff` for unrelated churn.
