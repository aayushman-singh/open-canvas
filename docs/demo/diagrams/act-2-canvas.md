# Act 2 — Master Canvas (one-doc scroll-through)

> **What this is.** The flagship spine for Act 2 on one page: 9 narrative beats covering 12 diagrams, each one a non-obvious engineering decision worth audience attention. Routine plumbing (auth tokens, routing, forms, SEO, search, ops view) cut entirely — covered elsewhere in the codebase, not in the video.
>
> **How to use during recording.**
> - Open §0 (master map) — "these are the only six things this video is about."
> - Each subsequent §n is one beat (one or two paired diagrams). `← in:` and `→ out:` lines below each block name the cross-flows so the audience knows where each piece slots into the whole.
> - Paired beats (§2 D7+D3, §3 D6+D-aigen, §6 D14+D-template) are filmed as one continuous explanation — the pairing IS the point.
>
> **Stance:** the video is "five non-obvious engineering decisions Open Canvas made," not "a tour of every subsystem." If a viewer wants the operational view (schema, API surface, deploy), point them at the ADRs and CONTEXT.md — those exist for that purpose.

---

## §0 — Master Map

The whole video on one canvas. Six subsystems, twelve diagrams, every cross-edge real.

```mermaid
flowchart TB
  Own((Owner)):::actor
  Col((Collaborator)):::actor
  Vis((Visitor)):::actor

  subgraph DOC["§1 Document model"]
    direction LR
    DC[D-canvas<br/>EditableSite tree]
    DE[D-elements<br/>14 atoms]
  end

  subgraph EDIT["§2 Co-edit ★"]
    direction LR
    D7[D7 Yjs CRDT]
    D3[D3 SiteRoom DO]
  end

  subgraph AI["§3 AI surfaces ★"]
    direction LR
    D6[D6 Agent<br/>validate-gate]
    DAI[D-aigen<br/>preview-before-persist]
  end

  subgraph VER["§4 Versioning"]
    D13[D13 Y.Doc<br/>deterministic snapshot]
  end

  subgraph COMP["§5–§6 Composition ★"]
    direction LR
    DS[D-sections<br/>regenerative recipes]
    D14[D14 Site import]
    DT[D-template<br/>clone-into-owner]
  end

  subgraph PUB["§7–§8 Publish ★"]
    direction LR
    DSN[D-snapshot<br/>editable ⇄ published]
    D8[D8 A11y audit]
  end

  Own ==> DOC
  Col ==> EDIT
  Own ==> AI

  DE --> DC
  DC <==> D7
  D7 ==> D3
  D3 -. fan-out .-> Vis
  D7 ==> D13

  D6 ==> DC
  DAI ==> DC

  DS --> DC
  D14 ==> DC
  DT ==> DC
  D14 <-. same two-pass pattern .-> DT

  DC ==> DSN
  DSN ==> D8
  D8 -- block 422 --> Own
  D8 -- pass --> Vis

  classDef actor fill:#fef3c7,stroke:#92400e,stroke-width:2px;
```

**How to read.** Bold arrows (`==>`) = primary data flow. Dotted (`-.->`) = a relationship worth naming but not a write path. The dotted edge between D14 and D-template is **the meta-beat** — same algorithm, different source.

---

## §1 — Document model (D-canvas + D-elements)

**One tree, fourteen atoms. Every mutation in this video reduces to changing one of these.**

D-canvas — the tree:

```mermaid
flowchart TB
  site[EditableSite<br/>styleKit + locale + favicon] --> header[Site-wide header]
  site --> footer[Site-wide footer]
  site --> p1[Page 1<br/>slug + title + SEO]
  site --> p2[Page 2]
  p1 --> s1[Section<br/>recipeId + height + role]
  p1 --> s2[Section]
  s1 --> e1[Element of 14 types]
  s1 --> e2[Element]
  s2 --> e3[Element]
```

D-elements — the union:

```mermaid
flowchart LR
  union[CanvasElement<br/>discriminated union] --> t[text]
  union --> m[media]
  union --> a[action]
  union --> sh[shape]
  union --> c[container]
  union --> f[form]
  union --> em[embed]
  union --> ch[chart]
  union --> ac[accordion]
  union --> ca[carousel]
  union --> ta[table]
  union --> co[code]
  union --> n[nav]
  union --> cl[collection]
```

> ← **in:** the schema the entire video operates on; defined in [`src/canvas/schema.ts`](../../../src/canvas/schema.ts) · → **out:** D7 projects to this, D6 mutates through this, D8 audits this, D14/D-template/D-sections produce this, D-snapshot copies this on publish.
> ⚠ Header + footer are *site-wide*, not per-page. Bounded by design — 14 types, not "infinite." `'custom'` recipe (§5) is the open-ended escape hatch, not the element registry.

---

## §2 — Co-edit (D7 + D3) ★ flagship

**The pair is the point.** D7 = *what* is sent (Yjs CRDT binary diffs). D3 = *how* it's distributed (one DO per site, WS hibernation). Filmed continuously, with a live-drawn Excalidraw replay.

D7 — Yjs CRDT model:

```mermaid
flowchart LR
  maya[(Maya Y.Doc)] -- encodeStateAsUpdate --> sr((SiteRoom DO))
  sam[(Sam Y.Doc)] -- encodeStateAsUpdate --> sr
  sr -- merged updates --> maya
  sr -- merged updates --> sam
  maya --> proj1[EditableSite<br/>projection]
  sam --> proj2[EditableSite<br/>projection]
  sr --> snap[(Snapshot in DB<br/>base64 binary)]
```

D3 — SiteRoom fan-out:

```mermaid
sequenceDiagram
  participant Editor
  participant Visitor1
  participant Visitor2
  participant SR as SiteRoom DO
  Editor->>SR: WS upgrade (role=editor)
  Visitor1->>SR: WS upgrade (role=visitor)
  Visitor2->>SR: WS upgrade (role=visitor)
  Editor->>SR: Y.Doc update
  SR->>Visitor1: broadcast
  SR->>Visitor2: broadcast
  SR->>Editor: ack (other editors only)
```

> ← **in:** Owner/Collaborator edits land on their local Y.Doc; D-canvas is the projection target on every client · → **out:** binary snapshot persisted to D13; visitors see broadcast updates in real time.
> ⚠ CRDT, not OT. Server doesn't resolve conflicts — the merge function does. Every client has its own Y.Doc; never draw a shared one. D7 alone hides the broadcast; D3 alone is plumbing — show them together.

---

## §3 — AI surfaces (D6 + D-aigen) ★ flagship

**The argument: the AI never produces side effects.** Both surfaces enforce the same rule from different ends — D6 gates writes to the document, D-aigen gates writes to the asset store. Filmed continuously to land the principle.

D6 — Agent validate-gate:

```mermaid
flowchart LR
  prompt[Owner prompt] --> gemini[Gemini 2.5 Pro]
  gemini --> tools[Tool surface]
  tools --> parsers[Per-arg parsers]
  tools -.-> rotool[query_site / query_assets<br/>read-only, skip preview]
  parsers --> preview[Preview ops]
  preview -- SSE --> owner[Owner Accept / Reject]
  owner -- Accept --> apply[Apply layer]
  apply --> gate{{validate.ts<br/>write gate}}
  gate -- valid --> state[(EditableSite)]
  gate -- invalid --> reject[502]
```

D-aigen — preview-before-persist for AI image generation:

```mermaid
sequenceDiagram
  participant Owner
  participant W as Worker
  participant Rep as Replicate Flux Schnell
  Owner->>W: POST /sites/:siteId/assets/generate<br/>{prompt, boxW, boxH}
  W->>W: snapToFluxAspectRatio
  W->>Rep: POST predictions<br/>(Bearer + Prefer: wait)
  Rep-->>W: PNG bytes
  W-->>Owner: raw PNG (no R2, no DB)
  Note over Owner: preview in canvas
  Owner->>W: POST /api/owner/assets (multipart) on Apply
  W->>W: content-address pipeline → R2 + ownerAsset row
```

> ← **in:** Owner prompts (chat or image generator); both call sites authenticated by an edit cookie · → **out:** D6 valid ops → D-canvas mutations → propagated via §2; D-aigen Apply → asset rows → referenced by D-canvas elements.
> ⚠ The non-obvious decision in D-aigen: **generation alone does NOT create an asset.** Bytes live in the browser until the Owner applies. Lead with this — it's the senior-engineer "ooh, they didn't store it" beat.

---

## §4 — Versioning (D13)

**A version is the whole Y.Doc encoded as bytes. Restore replays the encoding.**

```mermaid
sequenceDiagram
  participant Editor
  participant SR as SiteRoom
  participant DB as Neon
  Editor->>SR: edit lands
  Note over SR: autosave tick
  SR->>SR: Y.encodeStateAsUpdate(doc)
  SR->>DB: INSERT siteVersion (base64)
  Editor->>DB: GET version N
  DB-->>Editor: base64 binary
  Editor->>Editor: Y.applyUpdate(fresh doc, decoded)
```

> ← **in:** Y.Doc from §2; SiteRoom is the autosave trigger; §7 publish handler also captures a version · → **out:** restore replays into a fresh Y.Doc, then projects to D-canvas.
> ⚠ Whole-Doc snapshot, not diff between versions. Encoding is deterministic — same Doc, same bytes. Cross-version diff UI doesn't exist unless re-verified.

---

## §5 — Composition: recipes (D-sections)

**Recipes are factories, not templates. Swap = regenerate from a recipe with a new brief.**

```mermaid
flowchart LR
  brief[Brief: copy / intent] --> factory[Recipe factory]
  kit[Style kit] --> factory
  assets[Asset IDs] --> factory
  factory --> sec[CanvasSection<br/>recipeId + elements]
  named[7 named recipes<br/>hero-split / feature-grid /<br/>gallery-strip / cta-band /<br/>logo-strip / testimonial-row /<br/>video-hero] --> factory
  factory -.-> custom["'custom' sentinel<br/>stub factory<br/>(ADR 0019)"]
```

> ← **in:** brief comes from §3 agent or direct editor action; style kit + asset IDs are constants of the site · → **out:** produces a `CanvasSection` for D-canvas; §6 imported sections land as `'custom'`.
> ⚠ **No named-slot model. No in-place swap handler.** Pattern is *delete + add new*. To "change the hero," the AI writes a new brief and replaces — it doesn't rebind slots. That regenerative interchangeability is the senior takeaway: it beats slot-binding for AI-driven authoring because the model writes a brief, not a slot-rebind script.

---

## §6 — Composition: site import + templates (D14 + D-template) ★ flagship

**The meta-beat: two completely different content-source flows use the same two-pass translation algorithm.** Show both, then say it.

D14 — Site Import (scraper output → owned site):

```mermaid
flowchart TB
  subgraph F1["Frame 1 — Mismatch"]
    scr[Scraper output<br/>sections speak originalUrl<br/>+ flat assets bag base64] --- canvas[Canvas model<br/>EditableSite speaks UUIDs]
  end
  subgraph F2["Frame 2 — Dictionaries"]
    pass1[Walk scraperAssets] --> hash[SHA-256 each]
    hash --> map1[mediaAssetIdMap<br/>originalUrl → UUID]
    hash --> map2[fontFamilyTokenMap<br/>family → font:hash]
    map1 --> conv[convertElement<br/>rewrites refs]
    map2 --> conv
    conv --> site[EditableSite]
  end
  subgraph F3["Frame 3 — Atomic commit"]
    site2[EditableSite + staged rows] --> val{{validateEditableSite}}
    val -- valid --> r2put[R2 batch put]
    r2put --> dbb[Drizzle batch:<br/>site + ownerAsset + siteFont]
    val -- invalid --> err502[502]
  end
  F1 --> F2 --> F3
```

D-template — customTemplate clone-into-owner:

```mermaid
flowchart LR
  subgraph save["Save-as-template"]
    site1[(Source site<br/>editableState)] --> snap[Snapshot siteState]
    site1 --> manif[Collect assetManifest]
    snap --> tmpl[(customTemplate<br/>visibility + siteState +<br/>assetManifest + styleKit)]
    manif --> tmpl
  end
  subgraph create["Create-from-template"]
    tmpl2[(customTemplate)] --> clone[Clone siteState]
    tmpl2 --> reroot[prepareSeedAssetsForCustomer<br/>re-root assets to new owner]
    clone --> walk[materializeAssetId<br/>walk pages/sections/elements<br/>rewrite asset refs]
    reroot --> walk
    walk --> site2[(New site row<br/>editableState)]
  end
```

> ← **in:** D14 from scraper output; D-template from another site's `editableState` · → **out:** both produce a fresh D-canvas tree + asset rows; both materialise into the new owner.
> ⚠ **The point:** the algorithm is the same. **Frame 2 in D14** (build dictionaries → rewrite tree) and **`materializeAssetId` in D-template** (walk tree → rewrite refs) are the same two-pass translation. Different source shape, same pattern. That's the "architecture rhymes" beat — call it out explicitly on camera.

---

## §7 — Publish: column split (D-snapshot)

**Two snapshots per site. Edits mutate one; visitors read the other. Publish is the only transition.**

```mermaid
flowchart LR
  editor[Editor mutations] --> es[(site.editableState)]
  pub[Publish handler] --> val{{validate + a11y gate}}
  val --> copy[Copy editableState<br/>→ publishedSnapshot]
  copy --> bump[publishedVersion += 1]
  bump --> sfx[Side effects:<br/>search rebuild,<br/>version capture,<br/>SiteRoom broadcast]
  sfx --> done[Visitor reads<br/>publishedSnapshot]
  sfx -. failure .-> restore[restorePreviousPublishState<br/>rollback]
  es -. read .-> editor
  done -. read .-> visitor[Visitor]
```

> ← **in:** all edit flows write `editableState` — §2 projection, §3 agent apply, §6 materialisers · → **out:** publish triggers §8 (a11y gate first), then the side-effect chain.
> ⚠ **The precondition for §8 to exist as a gate.** Editing never affects what visitors see — the column separation is the entire guarantee. Publish is *not* atomic at the row level; rollback via `restorePreviousPublishState`. Without this column split, "a11y blocks publish" wouldn't be expressible.

---

## §8 — Publish: a11y blocks publish (D8) ★ flagship

**Six parallel checks. Blocking issues stop publish at 422 with a full report. Already live, not planned.**

```mermaid
flowchart LR
  pub[Publish request] --> orch[A11y orchestrator]
  orch --> c1[alt-text]
  orch --> c2[action-labels]
  orch --> c3[color-contrast]
  orch --> c4[form-field-labels]
  orch --> c5[heading-order]
  orch --> c6[page-meta]
  c1 --> sev[Severity classifier]
  c2 --> sev
  c3 --> sev
  c4 --> sev
  c5 --> sev
  c6 --> sev
  sev --> issues[blocking / warning / info]
  issues --> gate{{Publish gate}}
  gate -- blocking==0 --> ok[Publish proceeds]
  gate -- blocking>0 --> blocked[422 + report]
```

> ← **in:** invoked by §7 publish handler; reads `editableState` + style kit for contrast resolution · → **out:** pass → publish side-effects run; fail → 422 to Owner with full report, nothing committed.
> ⚠ **Speak in present tense.** Audit *already* gates publish. Pure-validator pattern: collect ALL errors, no fail-fast. Contrast resolves against the *innermost surface by area, then z-index* — not just background. Heading H-level derived from font size via per-kit `headingScale`.

---

## Coda

The audience leaves with one sentence:

> "Maya edits a document model (§1) that two clients converge on without a server picking a winner (§2). The AI mutates it through a gate that rejects invalid writes outright and never produces side effects from generation (§3). The whole Y.Doc snapshots deterministically into base64 (§4). New sections come from regenerative recipes the AI rewrites rather than slot-binds (§5), and bigger imports — whether scraped or template-cloned — share the same two-pass translation algorithm (§6). Publish is a column copy gated by six parallel a11y checks that block at 422 (§7–§8). That's the engineering."

Eight beats. Five non-obvious decisions. Nothing else.
