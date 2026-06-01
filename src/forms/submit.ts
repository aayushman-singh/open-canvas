// src/forms/submit.ts
//
// Submit pipeline for one form POST.
//
// Order of operations:
//   1. Resolve the site + form element from the published snapshot.
//   2. Hash the visitor IP (sha256, truncated 32 chars) — never store raw.
//   3. Per-IP rate limit via `FormRateLimiter` DO (10 / 60s).
//   4. Per-form rate limit via direct count over `formSubmission` last hour
//      (100 / hour / form).
//   5. Verify Turnstile token via `verifyTurnstile`.
//   6. Validate body shape against the FormElement.fields contract.
//   7. Persist a `formSubmission` row.
//   8. (Optional) fire-and-forget webhook delivery, logged loud.
//
// Pure-ish module surface: every dep is injected so the smoke can drive the
// pipeline with in-memory stubs. The route layer (`src/forms/route.ts`)
// resolves the deps from `c.env` and forwards.

import { and, eq, gte, sql } from 'drizzle-orm';

import type { FormElement } from '../canvas/elements/form.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import type { Db } from '../db/client.js';
import { formSubmission, site as siteTable } from '../db/schema.js';
import {
  tryAcquireViaStub,
  type FormRateLimiterMarker,
} from '../live/form-rate-limiter-client.js';

import { deliverWebhook, type WebhookDeliveryResult } from './webhook.js';
import type { TurnstileVerifyResult } from './turnstile.js';

const PER_FORM_HOURLY_CAP = 100;
const PER_FORM_WINDOW_MS = 60 * 60 * 1000;
const IP_HASH_LENGTH = 32;

export interface SubmitDeps {
  db: Db;
  /** DO namespace for the per-IP rate limiter. */
  formRateLimiter: DurableObjectNamespace<FormRateLimiterMarker>;
  /** Verify a Turnstile token. The route layer wires real verifier; smoke injects a stub. */
  verifyTurnstileToken: (token: string, remoteIp: string | null) => Promise<TurnstileVerifyResult>;
  /** Webhook signing secret. Required even when no webhook is configured (initialization-time check). */
  webhookSigningSecret: string;
  /** Override fetch for webhook delivery. */
  webhookFetchImpl?: typeof fetch;
  /** Override the system clock. Defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface SubmitInput {
  siteId: string;
  formElementId: string;
  /** Raw multipart/url-encoded payload keyed by field id. */
  rawFields: Record<string, string | string[]>;
  /** Cloudflare Turnstile token (cf-turnstile-response). */
  turnstileToken: string;
  /** `cf-connecting-ip` header value (or other source). null when missing. */
  ip: string | null;
  /** User-Agent header value. Empty string when missing. */
  userAgent: string;
}

// `notificationContext` carries the fields the route layer needs to write
// the ADR 0043 form_submission notification after this pipeline returns. It
// is populated only when the submission committed (status === 'ok'); the
// route resolves collaborator customer IDs separately.
export interface FormSubmitNotificationContext {
  siteName: string;
  siteOwnerCustomerId: string;
  pageSlug: string;
  formElementLabel: string;
  submittedAt: string;
}

export type SubmitOutcome =
  | {
      status: 'ok';
      submissionId: string;
      notificationContext: FormSubmitNotificationContext;
      webhookDelivery?: WebhookDeliveryResult;
    }
  | { status: 'site-not-found' }
  | { status: 'form-not-found' }
  | { status: 'form-not-published' }
  | { status: 'rate-limited-ip'; remaining: number; windowStartMs: number }
  | { status: 'rate-limited-form'; periodMs: number; cap: number }
  | { status: 'turnstile-failed'; reason: string }
  | { status: 'validation-failed'; fieldErrors: Array<{ field: string; reason: string }> }
  | { status: 'siteverify-unreachable'; message: string };

/**
 * SHA-256 over the (ip || ua-derived || 'unknown') string, hex-encoded and
 * truncated to 32 chars. We never persist raw IPs.
 */
export async function hashIp(ip: string | null): Promise<string> {
  const input = ip && ip.length > 0 ? ip : 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return hex.slice(0, IP_HASH_LENGTH);
}

/**
 * Walk the snapshot's pages → sections → elements and return the form element
 * matching `formElementId`. Returns null when not found.
 */
export function findFormInSnapshot(
  snapshot: PublishedSnapshot,
  formElementId: string,
): { form: FormElement; pageSlug: string } | null {
  for (const page of snapshot.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type === 'form' && element.id === formElementId) {
          return { form: element, pageSlug: page.slug };
        }
      }
    }
  }
  return null;
}

interface PayloadAndErrors {
  payload: Record<string, unknown>;
  errors: Array<{ field: string; reason: string }>;
}

/**
 * Validate the raw payload against the FormElement.fields contract. Required
 * fields that are missing/empty produce a `required` error; checkbox fields
 * coerce to boolean; select fields must match a configured option value.
 */
export function validateSubmissionPayload(
  form: FormElement,
  raw: Record<string, string | string[]>,
): PayloadAndErrors {
  const payload: Record<string, unknown> = {};
  const errors: Array<{ field: string; reason: string }> = [];
  for (const field of form.fields) {
    const value = raw[field.id];
    const stringValue = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
    switch (field.kind) {
      case 'text':
      case 'textarea': {
        if (field.required && stringValue.trim().length === 0) {
          errors.push({ field: field.id, reason: 'required' });
          break;
        }
        payload[field.id] = stringValue;
        break;
      }
      case 'email': {
        if (stringValue.trim().length === 0) {
          if (field.required) errors.push({ field: field.id, reason: 'required' });
          payload[field.id] = stringValue;
          break;
        }
        // Liberal email regex — server is not the source of truth for "this
        // is a real address," but we reject the obvious shape errors so
        // downstream consumers don't choke.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue.trim())) {
          errors.push({ field: field.id, reason: 'invalid-email' });
        }
        payload[field.id] = stringValue;
        break;
      }
      case 'checkbox': {
        const checked = stringValue.length > 0 && stringValue !== 'off' && stringValue !== 'false';
        if (field.required && !checked) {
          errors.push({ field: field.id, reason: 'required' });
        }
        payload[field.id] = checked;
        break;
      }
      case 'select': {
        if (stringValue.length === 0) {
          if (field.required) errors.push({ field: field.id, reason: 'required' });
          payload[field.id] = stringValue;
          break;
        }
        const allowed = Array.isArray(field.options) ? field.options.map((o) => o.value) : [];
        if (allowed.length > 0 && !allowed.includes(stringValue)) {
          errors.push({ field: field.id, reason: 'invalid-option' });
        }
        payload[field.id] = stringValue;
        break;
      }
    }
  }
  return { payload, errors };
}

/**
 * Run the full submit pipeline. Pure dependency-injected — the route layer
 * supplies the real deps; the smoke supplies in-memory stubs.
 */
export async function handleFormSubmit(
  deps: SubmitDeps,
  input: SubmitInput,
): Promise<SubmitOutcome> {
  const now = deps.now ?? (() => new Date());
  const database = deps.db;

  // 1. Load published snapshot for the site. We also pick site `name` and
  // `customerId` here so the notification step (see step 9 below) has the
  // context it needs without re-querying.
  const siteRows = await database
    .select({
      publishedSnapshot: siteTable.publishedSnapshot,
      name: siteTable.name,
      customerId: siteTable.customerId,
    })
    .from(siteTable)
    .where(eq(siteTable.id, input.siteId))
    .limit(1);
  const row = siteRows[0];
  if (!row) return { status: 'site-not-found' };
  if (!row.publishedSnapshot) return { status: 'form-not-published' };

  const found = findFormInSnapshot(row.publishedSnapshot, input.formElementId);
  if (!found) return { status: 'form-not-found' };
  const { form, pageSlug } = found;

  // 2. Hash IP. Never store raw.
  const ipHash = await hashIp(input.ip);

  // 3. Per-IP rate limit via DO. The DO instance is keyed by ipHash, so
  // every submit from a given IP serialises through the same isolate.
  const stubId = deps.formRateLimiter.idFromName(ipHash);
  const stub = deps.formRateLimiter.get(stubId);
  const acquired = await tryAcquireViaStub(stub, ipHash, 'form-per-ip');
  if (!acquired.ok) {
    return {
      status: 'rate-limited-ip',
      remaining: acquired.remaining,
      windowStartMs: acquired.windowStartMs,
    };
  }

  // 4. Per-form hourly cap. Direct DB count.
  const since = new Date(now().getTime() - PER_FORM_WINDOW_MS);
  const countRows = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(formSubmission)
    .where(
      and(
        eq(formSubmission.siteId, input.siteId),
        eq(formSubmission.formElementId, input.formElementId),
        gte(formSubmission.submittedAt, since),
      ),
    );
  const recentCount = countRows[0]?.count ?? 0;
  if (recentCount >= PER_FORM_HOURLY_CAP) {
    return { status: 'rate-limited-form', periodMs: PER_FORM_WINDOW_MS, cap: PER_FORM_HOURLY_CAP };
  }

  // 5. Turnstile.
  const turnstile = await deps.verifyTurnstileToken(input.turnstileToken, input.ip);
  if (!turnstile.ok) {
    if (turnstile.error === 'siteverify-unreachable') {
      return {
        status: 'siteverify-unreachable',
        message: turnstile.message ?? 'siteverify unreachable',
      };
    }
    const errorCodes = turnstile.errorCodes;
    return {
      status: 'turnstile-failed',
      reason: errorCodes && errorCodes.length > 0 ? errorCodes.join(',') : turnstile.error,
    };
  }

  // 6. Validate payload.
  const validated = validateSubmissionPayload(form, input.rawFields);
  if (validated.errors.length > 0) {
    return { status: 'validation-failed', fieldErrors: validated.errors };
  }

  // 7. Persist row.
  const submittedAt = now();
  const inserted = await database
    .insert(formSubmission)
    .values({
      siteId: input.siteId,
      formElementId: input.formElementId,
      pageSlug,
      payload: validated.payload,
      ipHash,
      userAgent: input.userAgent.slice(0, 1024),
      submittedAt,
    })
    .returning({ id: formSubmission.id });
  const submissionId = inserted[0]?.id;
  if (!submissionId) {
    throw new Error('[forms/submit] insert returned no row — DB driver contract violation');
  }

  // 8. Webhook (optional). We await delivery so the submit outcome carries
  // the explicit webhook result; failures are returned in the outcome and
  // logged by deliverWebhook with URL, status, duration, and transport detail.
  let webhookDelivery: WebhookDeliveryResult | undefined;
  if (typeof form.webhookUrl === 'string' && form.webhookUrl.length > 0) {
    webhookDelivery = await deliverWebhook(
      form.webhookUrl,
      deps.webhookSigningSecret,
      {
        siteId: input.siteId,
        formElementId: input.formElementId,
        pageSlug,
        payload: validated.payload,
        submittedAt: submittedAt.toISOString(),
      },
      deps.webhookFetchImpl !== undefined ? { fetchImpl: deps.webhookFetchImpl } : {},
    );
  }

  const notificationContext: FormSubmitNotificationContext = {
    siteName: row.name,
    siteOwnerCustomerId: row.customerId,
    pageSlug,
    formElementLabel: form.submitLabel,
    submittedAt: submittedAt.toISOString(),
  };
  if (webhookDelivery !== undefined) {
    return { status: 'ok', submissionId, notificationContext, webhookDelivery };
  }
  return { status: 'ok', submissionId, notificationContext };
}
