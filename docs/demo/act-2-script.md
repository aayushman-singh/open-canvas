# Act 2 — Engineering Walkthrough

> **Runtime target:** ~25–40 minutes. **Voice:** host-narrator (same voice as Act 1, no seam). **Format:** voiceover paired with diagram callouts. Beats referenced as `[BEAT: §n ...]` markers; all twelve diagrams live in [`diagrams/act-2-canvas.md`](diagrams/act-2-canvas.md).

## Reading conventions

- **Diagram source location:** [`diagrams/act-2-canvas.md`](diagrams/act-2-canvas.md) is the master scroll-through — open it side-by-side during recording. Per-block reference (including the 23 dropped diagrams) lives in [`live-draw-reference.md`](diagrams/live-draw-reference.md).
- **ADR references:** every diagram that maps to a decision links the ADR in `docs/adr/`. The ADR is the canonical record; this script is the narrative wrapping.
- **Animation:** mostly static. §2 (D7 Yjs CRDT + D3 SiteRoom fan-out, filmed together) is recorded as a live Excalidraw drawing session for animation effect; everything else is voiceover-over-static-image.

---

## Beat index — 9 flagship beats, 12 diagrams

Trimmed 2026-06-07 from 29 diagrams down to the non-obvious engineering decisions only. Routine plumbing (auth tokens, routing, forms, SEO, search, ops view) cut entirely — not montaged, not "quick slides," not in the video. Audience comes for the engineering, not the surface coverage.

| § | Beat | Diagrams | ADR / source | Tool |
|---|---|---|---|---|
| §1 | Document model | D-canvas EditableSite tree **+** D-elements 14-atom union | [`src/canvas/schema.ts`](../../src/canvas/schema.ts), ADR 0011 (Proposed) | Mermaid flowchart × 2 |
| §2 ★ | Co-edit | D7 Yjs CRDT **+** D3 SiteRoom DO fan-out | ADR 0007, [`src/live/site-room.ts`](../../src/live/site-room.ts) | Mermaid + live-drawn Excalidraw replay |
| §3 ★ | AI surfaces | D6 agent validate-gate **+** D-aigen preview-before-persist | ADR 0012 validation-write-gate, ADR 0014, ADR 0004 decision 2 | Mermaid + Excalidraw poster |
| §4 | Versioning | D13 Y.Doc deterministic snapshot | [`src/version/`](../../src/version/) | Mermaid sequence |
| §5 | Recipes | D-sections regenerative recipes + `'custom'` sentinel | ADR 0019, [`src/canvas/recipes.ts`](../../src/canvas/recipes.ts) | Mermaid flowchart |
| §6 ★ | Composition | D14 Site Import **+** D-template clone-into-owner (same two-pass translation pattern) | ADR 0008, [`src/routes/api/import.ts`](../../src/routes/api/import.ts), [`src/routes/api/sites.ts`](../../src/routes/api/sites.ts) | Excalidraw + Mermaid |
| §7 | Publish: column split | D-snapshot editable ⇄ published | [`src/db/schema.ts`](../../src/db/schema.ts), [`src/routes/api/publish.ts`](../../src/routes/api/publish.ts) | Mermaid flowchart |
| §8 ★ | Publish: a11y gate | D8 six-check a11y audit | [`src/a11y/`](../../src/a11y/), `SUBSYSTEM.md` | Excalidraw + Mermaid |

**All twelve diagrams live in [`diagrams/act-2-canvas.md`](diagrams/act-2-canvas.md) as one scroll-through.** Paired beats (§2, §3, §6) are filmed continuously — the pairing IS the point.

### Cut from earlier draft

D1, D2, D4, D5, D9, D10, D11, D12, D15, D16, D17, D18, D19, D20, D21, D22, D23, D24, D25, D26, D27, D28, D29 — all dropped. Each one is real engineering, but none of them is a *non-obvious* decision: an experienced viewer skims them in seconds. They remain documented in [`live-draw-reference.md`](diagrams/live-draw-reference.md) for reference; the per-block Mermaid stub plan and most Excalidraw specs in [`excalidraw/SPECS.md`](diagrams/excalidraw/SPECS.md) for the dropped diagrams are now stale (don't draw them).

---

## Suggested narrative order

The eight beats run in §-number order — there is no separate "natural order" because the canvas was already trimmed and re-ordered around it. The throughline:

1. **§1 Document model** — set the schema everything else operates on.
2. **§2 Co-edit ★** — D7 + D3 filmed together. "How do two people edit, and how do visitors see it live, without a server picking a winner?"
3. **§3 AI surfaces ★** — D6 + D-aigen filmed together. "The AI never produces side effects. Document mutations go through a gate; image generation doesn't touch storage until the Owner applies."
4. **§4 Versioning** — "A version is the whole Y.Doc encoded as bytes, deterministically."
5. **§5 Recipes** — "AI doesn't rebind slots — it writes a new brief. Sections are factories, not templates."
6. **§6 Composition ★** — D14 + D-template filmed together. The architecture-rhymes beat: two completely different content-source flows use the same two-pass translation algorithm.
7. **§7 Publish column split** — "The precondition that lets a11y *block* publish: editing never affects what visitors see."
8. **§8 A11y blocks publish ★** — "Six parallel checks. Blocking issues stop publish at 422. Already live, not planned."

★ = flagship beat (the five non-obvious engineering decisions the audience came for).

---

## Status

- **Beat index:** trimmed to 9 beats / 12 diagrams (2026-06-07). See [`diagrams/act-2-canvas.md`](diagrams/act-2-canvas.md).
- **Mermaid sources:** all twelve drafted inline in `act-2-canvas.md`. Per-block `mermaid/D*.md` stubs are abandoned; do not author there.
- **Excalidraw specs:** only D6, D7, D8, D14 need the hand-drawn render. D1, D9, D11, D22, D24, D25, D28 specs in [`SPECS.md`](diagrams/excalidraw/SPECS.md) are now stale — do not draw.
- **Voiceover script:** to draft beat-by-beat against `act-2-canvas.md`. Pending.
- **Recommended order:** voiceover against the canvas (mermaid is done); commission Excalidraw renders for the four surviving flagship slots after the script lands.
