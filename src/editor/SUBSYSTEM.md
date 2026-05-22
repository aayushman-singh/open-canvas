# editor

## Definition

`editor` owns the authenticated Owner experience for changing a canvas site.
Given a site id that belongs to the signed-in customer, it renders a desktop
canvas where positioned primitives can be selected, dragged, resized,
restyled, reordered, edited as rich text, handed to the AI preview flow, and
published to the public address.

The subsystem makes no decisions about persistence (`src/routes/api/canvas.ts`),
public snapshot serving (`src/routes/public.ts`), AI reasoning
(`src/routes/api/canvas-agent.ts` + `src/agent/canvas-*`), or primitive-to-HTML
rendering (`src/canvas/render.ts`). It is the human-facing control surface.

## Inputs

- **site owner** -> drag, resize, type, switch kit, ask the agent, accept or
  dismiss a preview, save, and publish.
- **canvas API** -> current `CanvasSiteState` plus mutation results.
- **canvas-agent API** -> previewed op lists and accepted edit results.
- **SiteRoom** -> live presence counts shared with visitor tabs.

## Outputs

- **canvas API** -> full editable-state saves, media uploads, and style-kit
  changes.
- **canvas-agent API** -> natural-language edit prompts and accepted op lists.
- **publish API** -> explicit publish requests after pending local saves flush.
- **Owner UI** -> the canvas, inspector, style kit controls, AI preview panel,
  presence indicator, and Save/Publish status.
