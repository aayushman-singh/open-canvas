# canvas elements registry

**Phase 0 scaffold.** Per-ElementType files live here; `index.ts` aggregates the discriminated union; `src/canvas/render.ts` becomes a dispatch table keyed by `type` so feature agents register their entry without editing the renderer.

One file per new ElementType. Stub bodies throw `Error('TODO: implement in Wave X')` until the owning agent fills them in.

See plans `2026-05-23-01-responsive-canvas.md` through `2026-05-23-25-*.md` for which agent owns which element file.
