# Tier 4 — Montage Slides (PPT-ready)

13 quick slides for the "routine stuff" segment. One diagram each, one anchor line, gloss in ~10s and move on.

---

## D4 — Published-address routing

**Three host shapes, one render.**

```mermaid
flowchart LR
  host[Host] --> p{Parse}
  p --> apex[Apex → app shell]
  p --> sub[Subdomain → site lookup]
  p --> cust[Custom → customDomain lookup]
```

---

## D5 — Edit token

**HMAC cookie bound to one origin.**

```mermaid
flowchart LR
  clerk[Clerk session] --> mint[HMAC siteId+origin]
  mint --> cookie[edit-token cookie]
  cookie --> verify[Timing-safe verify]
```

---

## D10 — Invite token

**The link is the credential. Single-use.**

```mermaid
flowchart LR
  owner[Owner invite] --> jwt[HMAC JWT 7d]
  jwt --> email[Email link]
  email --> redeem[Verify + mark redeemed]
```

---

## D15 — Form pipeline

**Bot check → throttle → DB → notify.**

```mermaid
flowchart LR
  v[Visitor] --> ts[Turnstile]
  ts --> rl[Rate limit DO]
  rl --> db[(DB)]
  db --> hook[Webhook + Resend]
```

---

## D16 — Password gate

**PBKDF2 verify → signed cookie.**

```mermaid
flowchart LR
  pw[Password] --> hash[PBKDF2-SHA256]
  hash --> cmp[Timing-safe compare]
  cmp --> cookie[HS256 unlock cookie]
```

---

## D17 — Custom domain

**Four states, one cron, bounded poll.**

```mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> Verifying
  Verifying --> Active
  Verifying --> Failed
```

---

## D18 — SEO meta emission

**One assembler, every tag.**

```mermaid
flowchart LR
  meta[Page + site meta] --> asm[Assembler]
  asm --> tags[title / canonical / OG / Twitter / JSON-LD / lang]
```

---

## D20 — Atomic search rebuild

**Reindex in one transaction.**

```mermaid
flowchart LR
  begin[BEGIN] --> del[DELETE]
  del --> ins[INSERT tsvector]
  ins --> commit[COMMIT]
```

---

## D22 — Security pass

**Defense by category.**

```mermaid
flowchart TB
  subgraph Defenses
    A[Auth tokens]
    H[Hashing]
    I[Input escapes]
    O[Output escapes]
    N[Network: Turnstile, RL, signatures]
  end
```

---

## D23 — Schema ER

**Two roots: customer + site.**

```mermaid
erDiagram
  customer ||--o{ site : owns
  customer ||--o{ ownerAsset : owns
  site ||--o{ collaborator : has
  site ||--o{ siteVersion : has
  site ||--o{ customDomain : has
```

---

## D24 — API surface

**90+ endpoints, 3 auth tiers.**

```mermaid
flowchart LR
  pub[Public] --- clerk[/api/* Clerk JWT/]
  clerk --- edit[/__api/* edit cookie/]
```

---

## D25 — Deploy + runtime

**Local → CI → one binary on the edge.**

```mermaid
flowchart LR
  dev[Bun + tsc] --> ci[Actions CI]
  ci --> deploy[wrangler deploy]
  deploy --> wkr[[Workers + DOs + Neon + R2]]
```

---

## D29 — In-app notifications

**Row commits → per-Owner DO fan-out → SSE to bell. Email in parallel.**

```mermaid
flowchart LR
  ev[Upstream event] --> w[Writer]
  w --> row[(notification row)]
  w --> doOwner[Owner DO]
  w --> email[Per-kind email policy]
  doOwner --> sse[SSE stream]
  sse --> bell[Bell + inbox]
```

Recipient kinds: `customer` (personal) | `site` (fanned-out via `notification_read`).
Kinds: `form_submission` | `collaborator_event` | `publish_event` | `access_event`.
Reconnect: `Last-Event-ID` → `?since=…` backfill. No queue.

---

## Coda

*"All routine. The interesting parts you've already seen."*
