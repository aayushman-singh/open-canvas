# Open Canvas Demo Video — Script + Diagrams

This directory holds the working artifacts for the YouTube demo video: a two-act script (product walkthrough, then engineering walkthrough), the feature-coverage ledger that drives it, and the diagram sources for Act 2.

> **Status: in progress.** Drafted incrementally — see the per-file headers for which sessions/beats are draft-complete vs. still skeletal.

---

## Files

| File | What it is |
|---|---|
| [feature-coverage.md](feature-coverage.md) | The single source of truth for what gets demoed where. Every shipped feature has an Act 1 home, an Act 2 home, or both. Pre-recording verification checklist. |
| [act-1-script.md](act-1-script.md) | **Product Demo.** 13 sessions + 6 interludes, two-column voiceover-and-action format, ~90 minutes runtime. Single Owner spine (Maya, an indie founder rebranding the Apogee template into "Briar"). |
| [act-2-script.md](act-2-script.md) | **Engineering Walkthrough.** Architecture explanations paired with 9 Excalidraw diagrams + 11 Mermaid sources. Walked through ADR by ADR. |
| [diagrams/mermaid/](diagrams/mermaid/) | Mermaid sources for state machines, sequence diagrams, and the schema ER. Authored inline. |
| [diagrams/excalidraw/SPECS.md](diagrams/excalidraw/SPECS.md) | Written specs for the 9 hand-drawn architecture diagrams. You draw from these. |

---

## Production decisions locked

- **Voice:** host-narrator throughout both acts (developer-of-record speaking as themselves). Maya is a named hypothetical the camera follows.
- **Recording mode:** pre-baked screen actions + studio voiceover synced in post. Two-column scene format.
- **Diagram tooling:** Excalidraw for system architecture (hand-drawn aesthetic), Mermaid for state machines / sequence / ER (canonical visual grammar).
- **Starting template:** Apogee Showcase fixture (`src/canvas/fixtures/apogee-showcase.json`), patched 2026-05-29 to cover all 14 element types × all variant axes (background effects, motion presets, chart kinds, code languages, embed providers).
- **Persona:** Maya, indie founder. Rebrands Apogee → Briar (placeholder name; tunable). Co-founder Sam appears in the collaborator interlude.
- **Site Import:** glossed only — public POC has the import button disabled; we acknowledge the feature exists without recording the scraper in action.
- **Out of scope (dead features):** the "auto-translate via Gemini" feature in FEATURES.md §34 and the "Symbols" feature in §14 are both nuked from the codebase — they don't appear in the demo. RTL + locale picker (the surviving parts of §34) do appear, in the Doha interlude.

---

## How to read the scripts

Each Act 1 beat is one of:

- **Session** — Maya alone, building or configuring. Numbered.
- **Interlude** — camera leaves Maya to a Visitor, collaborator, or alternate Owner. Labelled I1–I6.

Each beat opens with a banner block: target runtime, the features it drives, and the verification you do *before recording* (the fixture state, the dashboard state, any prerequisites). Then the script body alternates `VOICEOVER:` lines with `[ACTION:]` cues. Diagram references in Act 2 use `[DIAGRAM: name]` markers that map to files in `diagrams/`.

If a beat lists a feature you can't see on-screen during shooting, that's a planning bug — flag it in `feature-coverage.md`, don't paper over it on camera.
