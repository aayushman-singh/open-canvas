// src/email/templates/form-submission.ts
//
// HTML email sent to a site owner when a visitor submits a form on their
// site. Wraps the shared brand shell so the visual chrome matches every
// other transactional email.

import { brandShell, escapeHtml } from './shell.js';

export interface FormSubmissionEmailParams {
  formElementId: string;
  /** ISO-8601 timestamp of the submission. Rendered verbatim. */
  submittedAt: string;
  /** Dashboard URL to the Forms Inbox for this form. */
  inboxUrl: string;
}

export function formSubmissionEmailHtml(params: FormSubmissionEmailParams): string {
  const { formElementId, submittedAt, inboxUrl } = params;

  const bodyHtml =
    `<p style="margin:0 0 16px;">A new submission landed in your Forms Inbox.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">` +
      `<tr>` +
        `<td style="padding:6px 0;color:#948D82;width:120px;">Form ID</td>` +
        `<td style="padding:6px 0;color:#1A1917;font-family:'Spline Sans Mono',ui-monospace,SFMono-Regular,monospace;">${escapeHtml(formElementId)}</td>` +
      `</tr>` +
      `<tr>` +
        `<td style="padding:6px 0;color:#948D82;">Submitted at</td>` +
        `<td style="padding:6px 0;color:#1A1917;">${escapeHtml(submittedAt)}</td>` +
      `</tr>` +
    `</table>`;

  return brandShell({
    heading: 'New form submission',
    bodyHtml,
    cta: { label: 'View in Forms Inbox', href: inboxUrl },
  });
}

export function formSubmissionEmailSubject(): string {
  return 'New form submission on your site';
}
