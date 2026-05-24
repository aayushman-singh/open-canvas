// src/email/send.ts
//
// Thin wrapper around the Resend HTTP API. No SDK — a single fetch() call
// with the JSON body Resend expects. Throws on non-2xx so the caller sees
// the failure immediately (no silent fallback).

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'rev01 <noreply@rev01.aayushman.dev>';

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
      'Authorization': `Bearer ${apiKey}`,
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
    let detail = response.statusText;
    try {
      const body = await response.json() as { message?: string };
      if (body && typeof body.message === 'string') detail = body.message;
    } catch {
      // ignore parse failure
    }
    throw new Error(`Resend API error (${response.status}): ${detail}`);
  }

  const result = await response.json() as { id: string };
  return result;
}
