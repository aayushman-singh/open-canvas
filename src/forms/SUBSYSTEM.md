# forms

**Wishlist #:** 7  **Plan:** [`docs/superpowers/plans/2026-05-23-07-forms.md`](../../docs/superpowers/plans/2026-05-23-07-forms.md)
**Status:** implemented — Wave 2.

Form ElementType, submit handler (Turnstile + per-IP DO rate-limit + per-form
hourly DB count), `formSubmission` storage, optional signed webhook delivery,
Owner inbox + CSV export. `FormRateLimiter` Durable Object.

## Files

- `src/canvas/elements/form.ts` — `FormElement` interface, render fn,
  `configureFormRender({ turnstileSiteKey })` module-init hook for the
  visitor-side widget, recipe id constant.
- `src/forms/route.ts` — Hono router (`default` export). Mount at `/api/forms`.
- `src/forms/submit.ts` — pure submit pipeline (`handleFormSubmit`).
- `src/forms/turnstile.ts` — server-side Cloudflare Turnstile verifier.
- `src/forms/webhook.ts` — outbound webhook delivery + HMAC signature.
- `src/forms/inbox.ts` — list + CSV export.
- `src/forms/smoke.ts` — Bun-runnable smoke.
- `src/live/form-rate-limiter.ts` — `FormRateLimiter` DO class (Workers-only).
- `src/live/form-rate-limiter-client.ts` — wire protocol types +
  `tryAcquireViaStub` helper. Lives outside `form-rate-limiter.ts` so the
  submit handler + smoke can import it without pulling `cloudflare:workers`.
- `src/routes/dashboard/forms-inbox.tsx` — Owner inbox UI.

## Mount

The main thread mounts the router after the wave with:

```ts
import formsRouter from './forms/route';
app.route('/api/forms', formsRouter);
```

If the public renderer wants Turnstile widgets, call
`configureFormRender({ turnstileSiteKey: env.TURNSTILE_SITE_KEY })` once
at Worker boot before mounting the router.

The Owner dashboard route ships separately:

```ts
import formsInboxRoute from './routes/dashboard/forms-inbox';
app.route('/dashboard', formsInboxRoute);
```
