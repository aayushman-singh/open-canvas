// src/email/send.ts
//
// Thin wrapper around the Resend HTTP API. No SDK — a single fetch() call
// with the JSON body Resend expects. Throws on non-2xx so the caller sees
// the failure immediately (no silent fallback).
//
// Sender + key are env-driven (ADR 0018 + Resend's verified-sender rule).
// `EMAIL_FROM` and `RESEND_API_KEY` are required; missing or malformed values
// fail at the first call to `sendEmail` rather than producing silent partials.

import { emailFrom, type HostConfigEnv } from '../host-config.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

export type SendEmailEnv = HostConfigEnv & { RESEND_API_KEY: string };

function isSendEmailResult(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
  );
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(
  env: SendEmailEnv,
  options: SendEmailOptions,
): Promise<{ id: string }> {
  if (typeof env.RESEND_API_KEY !== 'string' || env.RESEND_API_KEY.length === 0) {
    throw new Error('RESEND_API_KEY is required to send email');
  }
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: emailFrom(env),
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!response.ok) {
    const bodyText = (await response.text()).trim();
    const detail = bodyText.length > 0 ? bodyText : response.statusText;
    throw new Error(`Resend API error (${response.status}): ${detail}`);
  }

  const result: unknown = await response.json();
  if (!isSendEmailResult(result)) {
    throw new Error('Resend API response missing required string id');
  }

  return { id: result.id };
}
