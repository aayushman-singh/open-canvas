# Sender icon in recipient inboxes

Why does `noreply@opencanvas.aayushman.dev` show a blank/letter avatar next
to the sender name in Gmail and Apple Mail? Resend delivers the message, but
the recipient's mail client picks the avatar — not Resend, not Cloudflare,
and not anything in this codebase. There are three signals a client looks
at, in roughly this order of precedence.

## 1. BIMI (the only one a brand controls end-to-end)

[Brand Indicators for Message Identification](https://bimigroup.org/) lets a
domain owner publish a logo SVG that participating mail clients render as
the sender avatar.

**Prerequisites, in order — each one is a hard gate; skipping any of them
silently disables BIMI:**

### 1.1 DMARC at `p=quarantine` or `p=reject`

BIMI is ignored when DMARC is `p=none` or unset. Because the From-header
domain on outbound mail is `opencanvas.aayushman.dev` (set by
[wrangler.toml:112](../wrangler.toml#L112)'s `EMAIL_FROM`), the DMARC policy
that Gmail consults is at `_dmarc.opencanvas.aayushman.dev`. DMARC inherits
from the org domain when the subdomain has no record, so a record at
`_dmarc.aayushman.dev` also works — but an explicit subdomain record makes
the policy obvious and isolates rev01's reputation.

Check current state:

```sh
dig +short TXT _dmarc.opencanvas.aayushman.dev
dig +short TXT _dmarc.aayushman.dev
```

Recommended record (publish on `aayushman.dev` so every subdomain inherits a
sane default, then override per-subdomain only if needed):

```
_dmarc.aayushman.dev. IN TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@aayushman.dev; ruf=mailto:dmarc@aayushman.dev; sp=quarantine; adkim=s; aspf=s; pct=100"
```

Sit at `p=quarantine` for 1–2 weeks. Watch the aggregate (`rua`) reports for
legitimate mail that gets quarantined — usually a forgotten newsletter
service or a scheduler. Once the reports are clean, tighten to `p=reject`.

### 1.2 SPF and DKIM aligned for every sender from `opencanvas.aayushman.dev`

Resend's domain wizard (Resend dashboard → **Domains** → add
`opencanvas.aayushman.dev`) publishes the required `_amazonses` (DKIM) and
SPF records. Verify alignment with a real send:

```sh
dig +short TXT opencanvas.aayushman.dev | grep spf
dig +short TXT resend._domainkey.opencanvas.aayushman.dev
```

Send a test invite to a Gmail account, open **Show original**, confirm all
three of `dkim=pass`, `spf=pass`, `dmarc=pass`. BIMI is silently skipped if
any of them fail.

### 1.3 BIMI Tiny-PS SVG (already live in this repo)

[src/landing/index.tsx:96](../src/landing/index.tsx#L96) serves
`/brand/bimi.svg` — a RFC 9419 SVG Tiny 1.2 Portable/Secure conformant
asset. Constraints baked in:

- `version="1.2"`, `baseProfile="tiny-ps"` on the root
- Square viewBox
- `<title>` is the first child of `<svg>`
- No scripts, animations, external references, embedded fonts, or
  `xmlns:xlink`
- All meaningful marks fit inside a centred safe-zone so Gmail's circular
  crop does not clip the brand

After `wrangler deploy`, the asset is reachable at:

```
https://opencanvas.aayushman.dev/brand/bimi.svg
```

Validate it against the [BIMI Group SVG validator](https://bimigroup.org/bimi-svg-validator/)
before publishing the DNS record — a failing validator response is the
single most common reason BIMI silently does nothing.

### 1.4 BIMI DNS record

```
default._bimi.opencanvas.aayushman.dev. IN TXT "v=BIMI1; l=https://opencanvas.aayushman.dev/brand/bimi.svg;"
```

BIMI does NOT walk up the DNS tree — the record MUST live at exactly
`default._bimi.<From-domain>` (the subdomain, not the apex). If the From
domain ever changes, this record moves with it.

`l=` is the logo URL. `a=` (VMC certificate) is omitted in step 1.4; add it
in step 1.5.

### 1.5 Verified Mark Certificate (optional, unlocks Gmail)

Apple Mail and Fastmail render the BIMI logo without a VMC. Gmail does
**not** — it requires a Verified Mark Certificate (VMC) from DigiCert or
Entrust before it will display the logo (and add the blue checkmark).

- ~US$1,200/yr per brand
- Requires a registered trademark on the logo in at least one of the
  approved trademark offices (USPTO, EUIPO, JPO, IPO UK, etc.)
- Issuance takes 2–6 weeks (paperwork-bound, not technical)

Once issued, host the PEM at e.g. `/brand/bimi.pem` and add `a=` to the TXT
record:

```
default._bimi.opencanvas.aayushman.dev. IN TXT "v=BIMI1; l=https://opencanvas.aayushman.dev/brand/bimi.svg; a=https://opencanvas.aayushman.dev/brand/bimi.pem"
```

## 2. Gravatar (zero-DNS interim covering Apple ecosystem)

Some clients fall back to a [Gravatar](https://gravatar.com) image keyed by
the MD5 of the From-address — Apple Mail historically, Fastmail, several
third-party clients. Gmail does not consult Gravatar.

- Create a Gravatar account
- Add `noreply@opencanvas.aayushman.dev`, `hello@opencanvas.aayushman.dev`,
  and any other operational addresses
- Upload a 512×512 PNG of the OC mark on the paper background

Cheap, no DNS. Worth doing while BIMI is in flight; covers a non-trivial
slice of Apple inboxes.

## 3. Google Workspace profile photo (only if the sender is a Workspace user)

Irrelevant for `noreply@…` — that's not a Workspace mailbox. If you later
send from a real Workspace user (e.g. `aayushman@…` for hand-written support
replies), uploading a profile photo in Workspace admin will surface in Gmail
web for other Workspace recipients. Not a fix for transactional mail.

## 4. The `EMAIL_FROM` display name (already done)

[wrangler.toml:112](../wrangler.toml#L112) is now
`Open Canvas <noreply@opencanvas.aayushman.dev>`. Until BIMI lands, this is
what shapes the letter-avatar that Gmail and Apple Mail auto-generate — the
letter `O` on a deterministic colour, rather than a blank `?` or the bare
domain initial. The lowest-effort lift and the only one that needs no DNS
work.

## Recommended order

1. **Now:** `wrangler deploy` so the `EMAIL_FROM` rename and
   `/brand/bimi.svg` route ship. Send a test invite to a Gmail account and
   confirm the friendly-name letter avatar.
2. **This week:** verify the Resend domain `opencanvas.aayushman.dev` (if
   not already) and publish DMARC at `p=quarantine` on `aayushman.dev`. Add
   Gravatar on the two operational addresses for the Apple-ecosystem
   coverage.
3. **This month:** validate `/brand/bimi.svg` at bimigroup.org's validator,
   then publish the `default._bimi.opencanvas.aayushman.dev` TXT record.
   Avatar appears for Apple/Fastmail users; Gmail still shows letter until
   step 4.
4. **Optional, if Gmail-coverage matters:** start the VMC paperwork. Until
   the trademark + certificate land, Gmail keeps showing the letter avatar.

## Out of scope

Clerk auth emails (sign-in code, verification, password reset, magic link)
use Clerk's own sender — `<your-instance>@clerk.dev` or a Clerk-managed
subdomain you set up. BIMI for those is Clerk's problem, not this repo's.
Brand the bodies in **Clerk Dashboard → Customization → Branding** (upload
App icon + App logo) and **→ Emails** (per-template HTML overrides).
