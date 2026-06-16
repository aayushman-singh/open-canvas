# Component Style Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ADR 0067 Component Style objects for Form, Accordion, Tabs, Carousel, and Collection with validator/render/editor/Yjs/agent coverage.

**Architecture:** Per-element style objects stay local to their element modules and emit component-scoped CSS variables on the outer wrapper. One shared editor Component Style panel renders per-element field metadata. Collection rendering is corrected so materialized entries are visible before CollectionStyle lands.

**Tech Stack:** TypeScript, Bun smoke tests, existing canvas render/validate/Yjs/editor-client modules.

---

## File Map

- `src/canvas/elements/component-style.ts`: shared style field metadata, CSS variable mapping helpers, conflict key helpers.
- `src/canvas/component-style.smoke.ts`: validator/render/Yjs/agent smoke for Form/Accordion/Tabs/Carousel.
- `src/canvas/collection-component-style.smoke.ts`: Collection render + CollectionStyle smoke.
- `src/canvas/elements/form.ts`: extend `FormStyle`, emit Form style vars for new fields, export metadata.
- `src/canvas/elements/accordion.ts`: add `AccordionStyle`, emit metadata, agent fields.
- `src/canvas/elements/tabs.ts`: add `TabsStyle`, emit metadata, agent fields.
- `src/canvas/elements/carousel.ts`: add `CarouselStyle`, emit metadata, agent fields.
- `src/canvas/elements/collection.ts`: add `CollectionStyle`, render entries, emit metadata, agent fields.
- `src/canvas/render.ts`: emit Component Style vars after `pinnedStyle` on wrapper.
- `src/canvas/validate.ts`: validate style objects, reject unknown keys, reject modeled `pinnedStyle` conflicts.
- `src/canvas/yjs-projection.ts`: encode/decode each style object as nested sparse map.
- `src/canvas/elements/index.ts`: export new style metadata/types where needed.
- `src/editor-client/component-style-panel.ts`: shared inspector panel.
- `src/editor-client/runtime-helpers.ts` and `src/editor-client/index.ts`: register generic mount handler.
- `src/editor-client/body-builders-data.ts`: use public component DOM/classes for styled parts and apply style variable contract.
- `src/editor-client/styles-build.ts`: include public component CSS variable selectors for editor preview.
- `package.json`: add new smoke scripts and wire them into `ci:smoke`.

## Task 1: Red Tests For Non-Collection Style Objects

- [ ] Add `src/canvas/component-style.smoke.ts` with assertions:
  - validator accepts sparse `accordionStyle`, `tabsStyle`, `carouselStyle`, and extended `formStyle`
  - validator rejects unknown keys
  - validator rejects `pinnedStyle` conflicts for modeled keys
  - render emits Component Style variables on `.opencanvas-element` wrapper
  - Yjs round-trips the style objects
  - agent specs accept style patch objects and reject invalid primitive types
- [ ] Add package script `"component-style:smoke": "bun run src/canvas/component-style.smoke.ts"`.
- [ ] Run `bun run component-style:smoke`.
- [ ] Expected: fail because style objects/validator/renderer do not exist yet.

## Task 2: Implement Form/Accordion/Tabs/Carousel Style Objects

- [ ] Add shared style metadata and helpers in `src/canvas/elements/component-style.ts`.
- [ ] Extend Form, Accordion, Tabs, and Carousel element types with their style objects and metadata.
- [ ] Map style fields to CSS variables on the wrapper in `src/canvas/render.ts` after `pinnedStyle`.
- [ ] Add validator support for known keys, typed values, and pinned conflict rejection.
- [ ] Add Yjs encode/decode for the four style objects.
- [ ] Add agent patch surfaces for the four style objects.
- [ ] Run `bun run component-style:smoke`.
- [ ] Expected: pass.

## Task 3: Red Tests For Generic Editor Panel

- [ ] Add editor smoke coverage to `src/editor-client/component-style-panel.smoke.ts`.
- [ ] Assert the panel writes sparse style fields, clears fields, deletes empty style object, and removes conflicting pinned keys.
- [ ] Assert Form/Accordion/Tabs/Carousel body builders use public component class/attr contract for styled parts.
- [ ] Add package script `"component-style-panel:smoke": "bun run src/editor-client/component-style-panel.smoke.ts"`.
- [ ] Run `bun run component-style-panel:smoke`.
- [ ] Expected: fail because generic panel and class parity are not implemented.

## Task 4: Implement Generic Editor Panel And Preview Parity

- [ ] Create `src/editor-client/component-style-panel.ts`.
- [ ] Register generic `component-style` mount handler through editor runtime helper plumbing.
- [ ] Replace element-specific style mounts with metadata-driven panel where applicable.
- [ ] Update body builders so styled inner DOM uses public class names/attributes.
- [ ] Add editor CSS rules that consume the same component-scoped variables.
- [ ] Run `bun run component-style-panel:smoke`.
- [ ] Expected: pass.

## Task 5: Red Tests For Collection Render And CollectionStyle

- [ ] Add `src/canvas/collection-component-style.smoke.ts`.
- [ ] Assert `renderCollection` emits materialized `entries` through `renderChild`.
- [ ] Assert `collectionStyle` vars live on the host wrapper and are inherited by built-in `card` / `image-only` entry chrome.
- [ ] Assert `custom` display keeps template-owned chrome and does not mutate child elements.
- [ ] Add package script `"collection-component-style:smoke": "bun run src/canvas/collection-component-style.smoke.ts"`.
- [ ] Run `bun run collection-component-style:smoke`.
- [ ] Expected: fail because `renderCollection` emits only an empty frame and `collectionStyle` does not exist.

## Task 6: Implement Collection Render And CollectionStyle

- [ ] Add `CollectionStyle` to `src/canvas/elements/collection.ts`.
- [ ] Render materialized `entries` inside `.opencanvas-collection`.
- [ ] Add mode-aware built-in card/image wrappers that read host variables without mutating cloned children.
- [ ] Add validator/Yjs/agent/editor support for `collectionStyle`.
- [ ] Run `bun run collection-component-style:smoke`.
- [ ] Expected: pass.

## Task 7: Final Verification

- [ ] Run targeted smokes:
  - `bun run component-style:smoke`
  - `bun run component-style-panel:smoke`
  - `bun run collection-component-style:smoke`
  - `bun run variant-presets:smoke`
  - `bun run collection-materializer:smoke`
  - `bun run yjs-projection:smoke`
  - `bun run agent-tool-dispatch:smoke`
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run lint`.
- [ ] Review `git diff` for unrelated churn.
