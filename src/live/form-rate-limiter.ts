// src/live/form-rate-limiter.ts
//
// Phase 0 stub. `FormRateLimiter` Durable Object class — bound in
// `wrangler.toml` so the env binding exists before Wave 2 #7 (forms) lands.
// Wave 2 owner replaces every method body with the real per-IP / per-form
// rate-limit logic described in
// docs/superpowers/plans/2026-05-23-07-forms.md.
//
// Methods throw on call so accidental Phase 0 use fails loudly rather than
// silently succeeding with a no-op (which the project's all-or-nothing
// failure policy refuses).

import { DurableObject } from 'cloudflare:workers';

export class FormRateLimiter extends DurableObject<unknown> {
  override async fetch(request: Request): Promise<Response> {
    void request;
    return Promise.reject(
      new Error(
        'TODO: implement in Wave 2 — see docs/superpowers/plans/2026-05-23-07-forms.md',
      ),
    );
  }

  /**
   * Wave 2 surface: `recordSubmission(ipHash, formId)` consumes a rate budget
   * for one IP × one form and returns whether the call is allowed. The Phase 0
   * stub throws so callers cannot accidentally proceed against an unwired DO.
   */
  recordSubmission(ipHash: string, formId: string): Promise<{ allowed: boolean }> {
    void ipHash;
    void formId;
    return Promise.reject(
      new Error(
        'TODO: implement in Wave 2 — see docs/superpowers/plans/2026-05-23-07-forms.md',
      ),
    );
  }
}
