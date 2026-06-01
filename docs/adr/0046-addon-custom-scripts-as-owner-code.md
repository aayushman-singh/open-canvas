# ADR 0046 — `addon_custom_scripts` is Owner-authored JavaScript by design; entitlement is the security boundary

**Status:** Accepted
**Date:** 2026-06-01 (proposed); 2026-06-01 (accepted)
**Author:** Aayushman Singh
**Drives:** the 2026-06-01 second-opinion audit pass named the `addon_custom_scripts` addon as a stored-XSS surface in visitor render. This ADR resolves the framing question that audit raises — feature, not finding — and pins the security boundary the audit's reading should have used.
**Accepted-context:** verified 2026-06-01 — `src/addons/registry.ts` declares the addon with raw `headScripts` / `bodyScripts` config fields; `src/addons/emit.ts` re-verifies `addonEntitlement` + the `siteAddon` row on every render, with un-entitled emits returning empty strings. The trust model documented here is the as-built contract.

## Context

[`src/addons/registry.ts:69-92`](../../src/addons/registry.ts) declares `addon_custom_scripts` with two free-text configuration fields, `headScripts` and `bodyScripts`. The placeholder text on those fields is literally `<script src="https://example.com/widget.js"></script>` — the Owner is intended to paste raw script tags. The emit functions ([`registry.ts:61-67`](../../src/addons/registry.ts)) return the configured strings verbatim, and the public render path ([`src/routes/public.ts:1088,1100`](../../src/routes/public.ts)) injects them via Hono's `raw()` into the visitor-served HTML's `<head>` and `<body>`.

An audit reading these files in isolation will correctly identify "visitor render injects Owner-controlled JavaScript" as a stored-XSS surface. The framing question this ADR resolves is whether that observation describes a defect or a deliberate feature, and where the security boundary actually lives.

The comparable products — Webflow, Framer, Squarespace, WordPress — all ship the same feature: a paste-your-own-snippet field for analytics, chat widgets, A/B tests, pixels, and any third-party tool that distributes a `<script>` tag. None of those products sanitise the snippet content. The Owner cohort this product serves expects the same affordance.

## Decisions

1. **`addon_custom_scripts` is an Owner-self-script feature, not an attack surface in the platform's threat model. The Owner authors the script bytes for their own published site, against their own visitors.**

   **Why:** Owner-controlled code in the Owner's own published site is not a security boundary that the platform owes the Owner protection across. The Owner already controls every HTML element, every CSS rule, every structured-data attribute that ships in their published site — the entire DOM is theirs. Restricting them to a sanitised subset of HTML while denying script injection would be a feature regression vs. every comparable site builder, and would block the lived outcome the Owner expects: "I added Intercom by pasting the snippet they emailed me." That outcome is unattainable with a sanitised-subset policy. The product treats Owner code in the Owner's published site the same way a static-site generator treats Owner-authored HTML: fully trusted, shipped verbatim.

   This would be wrong if a non-Owner could activate this addon on an Owner's site, or if Owner-authored bytes from one Owner shipped under another Owner's published address. Neither happens; the `siteAddon` row binds activation to one site, and the published-address model (per [ADR 0002](0002-published-address.md) and [ADR 0005](0005-custom-domains.md)) gives each site its own origin.

2. **The security boundary is the Addon Entitlement check at emit time. Every visitor-render emit re-verifies the entitlement against `addonEntitlement` and the site's `siteAddon` row ([`src/addons/emit.ts:15-63`](../../src/addons/emit.ts)). An entitled emit returns the configured strings; an unentitled emit returns nothing.**

   **Why:** the question this ADR explicitly rejects is "is this script content safe?" — that question has no general answer for arbitrary Owner-authored JavaScript, and every attempt to answer it (allowlists, content scanners, sandboxed iframes for the addon emit) either lets unsafe content through or breaks legitimate use. The question this ADR insists on instead is "is this Owner allowed to inject scripts on this site?" — which has a clean yes/no answer derived from the entitlement and `siteAddon` rows. The entitlement check is the load-bearing gate; content validation would be either insufficient (any allowlist of "safe" patterns can be bypassed by a determined Owner who wants to ship a custom script anyway) or hostile (a strict allowlist breaks the chat widgets, analytics snippets, and A/B test frames that legitimately need to inject anything). Same-origin policy contains the script's effects to the Owner's own published origin.

   This would be wrong if the entitlement check could be bypassed at emit time. That is why the emit functions re-verify on every render rather than trusting a cached flag — a deleted entitlement disables every active `addon_custom_scripts` site addon at the next render, with no need to republish, exactly as [ADR 0009](0009-addon-entitlement-model.md) decision 7 specifies.

3. **The risk vector this ADR does not protect against is "Owner pastes a malicious snippet from an untrusted tutorial." That is an Owner self-harm path. The product mitigates it with an unmistakable Owner-facing warning at the configuration boundary, not with content sanitisation.**

   **Why:** an Owner pasting `<script>document.cookie</script>` from a phishing tutorial is a social-engineering attack on the Owner, not a defect in the platform. The mitigation that works is education at the moment the Owner is about to paste: a high-contrast warning above the textarea reading "Code you paste here runs in every visitor's browser on your site. Only paste code you have read and trust." The mitigation that does not work is a script-content scanner — every such scanner can be evaded by attackers writing snippet text the scanner does not recognise, and the scanner gives the Owner a false sense of safety that makes them paste *more* carelessly than they would without it. The conceptual minimum: warn at the boundary, then trust the Owner.

   This would be wrong if the product moved toward an Owner cohort that expected platform-level protection from their own copy-paste mistakes — for example, an educational-institution tier where the Owner is a student and the institution is the support layer. For the current Owner cohort (independent builders shipping their own sites), the warning is the correct affordance.

4. **The XSS surface this ADR refuses is cross-site script injection — where a visitor on Owner A's site could be affected by code shipped on Owner B's site. That boundary is enforced at the origin layer, not at the addon layer.**

   **Why:** Owner A's `addon_custom_scripts` runs only on Owner A's published origin (subdomain or custom hostname). Browser same-origin policy contains the script's reach to that origin. Owner B's site sits on a different origin and cannot be affected by Owner A's scripts. The addon is therefore an intra-origin self-script feature, not a cross-origin attack surface. The origin model ([ADR 0002](0002-published-address.md), [ADR 0005](0005-custom-domains.md)) — wildcard subdomain plus per-Owner custom hostnames — is what enforces this boundary; `addon_custom_scripts` is allowed because the origin model already prevents the cross-Owner risk.

   This would be wrong if two Owners' published sites shared an origin. They do not.

## Out of scope

- Sanitising or validating script content — explicitly rejected by decision 3. The product does not scan, parse, or modify Owner-authored bytes.
- Server-side execution of Owner scripts — Owner scripts run in the visitor's browser, not on the Worker. The platform never `eval`s Owner content.
- A whitelist of "trusted" snippet providers (Intercom, Google Analytics, Meta Pixel, etc.) — would centralise the warning fewer Owners read, but does not change the security model. Dedicated per-integration addons (the existing `addon_google_analytics`, future Intercom/Meta Pixel addons) are how the product offers a curated path for popular integrations; `addon_custom_scripts` stays as the catch-all for the long tail.
- A Content-Security-Policy header that constrains inline script execution to addon-emitted blocks — deferred. The CSP shape depends on the live distribution of legitimate Owner uses; constraining it speculatively would break the very integrations the addon exists to enable.
- The Owner-facing UI warning's visual design and copy — owned by the addon-configuration UI plan, not by this ADR.

## Consequences

**Positive:**
- Owners can integrate any third-party tool that ships a `<script>` snippet — analytics, live chat, A/B testing, pixels, custom embeds. The lived outcome matches every comparable site builder.
- The platform's job is enforcing the boundary (entitlement check, per-origin isolation), not policing content. That keeps the platform's code small and the contract honest.
- The security boundary is explicit and testable: every emit's entitlement re-verification can be smoke-tested.

**Negative:**
- An audit reading the registry in isolation will (correctly) identify the route as a stored-XSS surface. The senior-review answer is the framing in decision 1 — show this ADR, name the entitlement boundary in decision 2, and refuse the "sanitise it" pressure in decision 3.
- An Owner who copies a malicious snippet harms their own site's visitors. The Owner-facing warning is the mitigation; it is not a guarantee. The product accepts the residual risk.
- The addon's correctness depends on the entitlement check NEVER being skipped or cached incorrectly. A future refactor that caches `fetchEntitledSiteAddons` for performance reasons is a known load-bearing trap; any such change must preserve the per-render re-verification or supersede this ADR.

## Follow-ups

- Add a high-contrast warning paragraph above the `headScripts` and `bodyScripts` textareas in the addon configuration UI. The copy should be unambiguous and not soften: "Code you paste here runs in every visitor's browser on your site. Only paste code you have read and trust."
- Add a smoke that pins the emit-time entitlement re-verification: revoke the `addonEntitlement` row, render the public page, assert the emitted HTML does not include the configured scripts. The contract is load-bearing; the smoke is the regression gate.
- Document this ADR's framing in the `src/addons/registry.ts` file header so a future contributor reading the registry sees the security model without grepping for the ADR.
- If a real Owner cohort starts shipping snippets from phishing-tutorial sources at a noticeable rate, revisit decision 3 — the warning may need to escalate (a confirmation modal, a typed acknowledgement, a delay before saving). Defer until measured.
