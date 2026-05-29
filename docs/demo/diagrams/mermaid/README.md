# Mermaid Diagram Sources

Sources for the state machines, sequence diagrams, and the schema ER in [`../../act-2-script.md`](../../act-2-script.md). Each file contains one diagram + a short prose context (what it explains, what to point at while narrating).

| File | Diagram | Type |
|---|---|---|
| `D2-style-kit.md` | Style Kit determinism + dark variant overlay | flowchart |
| `D3-fanout.md` | Publish → SiteRoom → connected visitors | sequence |
| `D4-routing.md` | Host header → site lookup → page slug resolve | state |
| `D5-edit-token.md` | Issue → bind to origin → use on edit | sequence |
| `D10-invite-token.md` | Send → Resend → click → JWT verify → editor | sequence |
| `D12-library-import.md` | Save section → manifest → import into page | sequence |
| `D13-version-snapshot.md` | Publish + manual → Y.Doc encode → restore w/ safety | sequence |
| `D15-form-pipeline.md` | Form POST → Turnstile → rate limit → DB → HMAC webhook + Resend | sequence |
| `D16-password-gate.md` | Unlock POST → PBKDF2 → HS256 cookie → redirect sanitization | sequence |
| `D17-custom-domain.md` | pending → verifying → active / failed | state |
| `D18-seo-meta.md` | Snapshot + page → meta emitter → JSON-LD + OG + Twitter + canonical | sequence |
| `D19-og-image.md` | Publish → Satori SVG → resvg PNG → R2 cache | sequence |
| `D20-search-rebuild.md` | Publish → DELETE+INSERT in single transaction | sequence |
| `D21-addon-entitlement.md` | Acquire → entitlement; enable → site-addon; remove → disable not cascade | state |
| `D23-schema-er.md` | 17-table ER, every FK | ER |
| `D26-rate-limiter.md` | InProcessRateLimiter ⇋ DurableObjectRateLimiter via interface | class |
| `D27-csp.md` | Used embed providers → CSP `frame-src` per page | sequence |

**Status:** files to draft. Diagram source contents will be added one per file as Act 2 voiceover is drafted; the inventory above is the authoring queue.
