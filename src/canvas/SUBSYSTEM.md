# canvas

## Definition

`canvas` owns the **canvas-first document model**: the set of positioned
design primitives that make up an Editable Site, the deterministic Style
Kits that paint them, the validator that decides whether a candidate
`EditableSite` is well-formed, the pure-function renderer that turns one
into HTML for the Published Address, the seed media + Template Seed fixture
that bootstraps a fresh site, and the recipe registry the AI agent consults
when proposing previewed edits. It is the single source of truth for what
"a site" is in rev01 today; the editor, the canvas API, the canvas-agent
endpoint, and the public host all conform to the vocabulary defined here.

Domain language (see `CONTEXT.md`): an **Editable Site** is a set of
**Canvas Pages**, each made of **Canvas Sections**, each containing
**Positioned Elements**. A **Published Snapshot** wraps the same Canvas
Pages with publish metadata for the Visitor-facing site. A **Style Kit** is
a deterministic bundle of palette + typography + surfaces + shapes +
actions + motion tokens — switching kits never mutates element content.

## Inputs

- **canvas API** — a candidate `EditableSite` (created on site creation
  from the Template Seed, then mutated by the editor and the AI agent),
  validated before persistence.
- **canvas-agent** — a typed canvas op (`CanvasAgentOp`), applied to the
  current state with the same validator gating both the preview and the
  apply step.
- **publish pipeline** — the current editable state to snapshot.
- **editor (browser)** — drag / resize / restyle / reorder intents,
  applied via the canvas API.

## Outputs

- **canvas API + canvas-agent + publish** — a validation verdict (`{ valid:
true }` or `{ valid: false, errors }`) describing what is wrong with a
  candidate state or snapshot. Validation never throws.
- **public host** — a deterministic HTML string for a `(EditableSite,
StyleKit, assets)` triple (`render.ts`). The renderer throws on unknown
  shapes because its input is supposed to be validated upstream.
- **canvas-agent** — the recipe catalogue (`recipes.ts`) the agent consults
  when proposing previewed edits.

## Files

- `schema.ts` — type aliases + enum literal lists (`STYLE_KITS`,
  `ELEMENT_TYPES`, `MEDIA_KINDS`, `ACTION_VARIANTS`, etc.) and the
  `EditableSite` / `PublishedSnapshot` shapes.
- `validate.ts` — pure-function validator. Also exports `isAllowedHref` for
  the agent-tool surface.
- `render.ts` — pure-function renderer (`renderCanvasSnapshot`) that emits
  the Published Address HTML.
- `style-kits.ts` — deterministic Style Kit registry (palette, typography,
  surfaces, shapes, actions, motion).
- `public-styles.ts` — CSS string emission for the public renderer.
- `recipes.ts` — the AI agent's recipe registry (typed factories for the
  canvas ops the agent is allowed to propose).
- `seed-assets.ts` — the canonical seed media bundled with a fresh site.
- `fixtures/home.json` — the canonical Template Seed.
- `smoke.ts` — `bun.cmd run canvas:smoke`. Round-trips the seed through the
  validator + renderer and asserts byte-for-byte stability.

## Conventions

- `bun.cmd run canvas:smoke` exits non-zero on any drift. Never edit
  `fixtures/home.json` without re-running the smoke.
- The renderer is the only place a throw is acceptable in this subsystem;
  the validator never throws.
- Style Kit changes are deterministic — adding a new variant requires
  updating the kit registry + the validator + the renderer in lockstep, and
  the smoke catches any miss.
