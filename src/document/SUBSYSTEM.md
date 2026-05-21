# document

## Definition

`document` owns the vocabulary of a page: the set of node and mark kinds, their attributes, the structural rules that say which children belong inside which parent, and the deterministic mapping from a document tree to an HTML string. It is the contract every other subsystem in rev01 either produces or consumes — the editor (multiplayer task) emits trees that conform here, the agent (tool-use task) constructs trees whose shape is constrained by the same registry, the template catalogue stores trees that satisfy this contract, and the public-facing renderer turns one of those trees plus a theme token set into the bytes a browser receives. It is the single point that decides what a "page" is allowed to contain and what a "page" looks like as HTML; everything downstream is bound by the answers given here. Schema versioning lands on the first breaking change to this vocabulary; until then, this is version unmarked.

## Inputs

- **template catalogue** → seed document trees that conform to this vocabulary, validated on catalogue upload.
- **editor** → a document tree as JSON whenever a page is saved; validated before persistence.
- **agent** → a sequence of operations whose target shapes (insertSection, editText, swapImage, etc.) are derived from the node + mark vocabulary defined here.
- **theme studio** → a token set (`paletteSeed`, fonts, radius, density) consumed by the renderer to derive runtime CSS custom properties.

## Outputs

- **renderer caller (the Worker request handler)** → an HTML string for a given `(document, theme)` pair, deterministic and pure.
- **catalogue + editor + agent** → a validation verdict (`{ valid: true }` or `{ valid: false, errors }`) describing what is wrong with a candidate document.
- **agent tool definitions (task #9)** → the typed node + mark + attr enumeration that constrains the agent's tool-use schemas.
- **editor runtime schema (task #8)** → the typed node + mark vocabulary that TipTap binds to in the browser.

## Conventions

- `bun run document:smoke` regenerates the fixture previews (`src/document/fixtures/*.preview.html`) and exits non-zero on any validation drift. Reviewers can open the preview HTMLs to eyeball the renderer's output without booting a Worker.
- The preview HTMLs under `src/document/fixtures/*.preview.html` are generated and gitignored by Prettier — do not hand-edit.
- Renderer throws on unknown node shapes (the only place a throw is acceptable in this codebase) because its input is supposed to be validated upstream; the validator never throws.
