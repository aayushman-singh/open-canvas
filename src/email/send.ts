// src/email/send.ts
//
// Thin wrapper around the Resend HTTP API. No SDK — a single fetch() call
// with the JSON body Resend expects. Throws on non-2xx so the caller sees
// the failure immediately (no silent fallback).

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'rev01 <noreply@rev01.aayushman.dev>';

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
  apiKey: string,
  options: SendEmailOptions,
): Promise<{ id: string }> {
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
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
