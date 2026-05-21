# editor

## Definition

`editor` owns the experience an authenticated owner has when they want to change the contents of one of their pages. Its contract is: given a page identity and a signed-in customer who owns the site that owns the page, present a rich-text editing surface that is permanently in sync with every other editor of the same page, surface the live participant list so the user always knows who else is in the room, and offer a chat panel next to the document where the user can drive the AI agent over the page in plain language. The subsystem makes no decisions about how the document is stored, transported, or merged — those belong to `multiplayer` — no decisions about how a page is published or rendered to the public — those belong to `document` and the renderer — and no decisions about how the agent reasons or which tools exist — those belong to `agent`. It is purely the human-facing edge of the multiplayer experience for owners, including the seat next to the agent.

## Inputs

- **page owner (signed-in customer)** → the intent to edit a specific page (typed keystrokes) or to ask the AI agent for a change (chat-panel prompt), identified by site and page in the URL.
- **multiplayer** → the merged document state and the live stream of other participants' presence (identity, colour) for the same page.
- **identity provider** → the current signed-in user's identity (display name, stable id) used to colour and label this editor in the participant list.

## Outputs

- **multiplayer** → a stream of local document operations and presence updates expressing what this editor is doing.
- **agent (Worker endpoint)** → a chat-panel POST carrying the page identity and the user's prompt; consumes the NDJSON stream of agent events to render thinking / tool calls / replies in the panel while the actual document edits arrive via the multiplayer wire.
- **page owner** → a continuously updated rich-text view of the page, the participant list of everyone currently editing it (with a distinct `<agent>` chip while the agent is active on this page), a connection-health indicator, and a chat panel that streams the agent's reasoning + actions in real time.

## Schema coverage

The editor's ProseMirror schema is hand-rolled from the rev01 document vocabulary in `src/document/schema.ts`. Every node from `NODE_SCHEMA` (`doc`, `section`, `heading`, `paragraph`, `media`, `actions`, `action`, `columns`, `column`, `divider`, `list`, `listItem`, `text`) and every mark from `MARK_TYPES` (`bold`, `italic`, `underline`, `code`, `link`, `color`, `highlight`) is declared via `Node.create` / `Mark.create` from `@tiptap/core`. No `@tiptap/starter-kit`: that vocabulary covers only the StarterKit subset (basic headings + paragraphs + lists), which would silently truncate any save of a real rev01 page.

Names, attr keys, content groups, and defaults match `src/multiplayer/pm-schema.ts` exactly, so the Y.XmlFragments produced on either side of the wire decode losslessly on the other. Optional attrs default to `null`, atom nodes (`media`, `action`, `divider`) declare `atom: true`, and `code` marks declare `excludes: '_'` to satisfy spec §1.3. `parseHTML` selectors mirror the `data-*` attributes emitted by `src/document/render.ts` so server-rendered HTML rehydrates cleanly when pasted in.
