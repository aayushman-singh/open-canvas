// src/email/templates/invite.ts
//
// HTML email for site collaboration invitations. Wraps the shared brand shell
// (logo + palette) so this template only carries the invite-specific copy.

import { brandShell, escapeHtml } from './shell.js';

export interface InviteEmailParams {
  siteName: string;
  siteSubdomain: string;
  /** Apex host (ADR 0013) — combines with siteSubdomain into the public address. */
  apex: string;
  /** Absolute origin of the app (e.g. https://opencanvas.aayushman.dev). */
  appOrigin: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}

export function inviteEmailHtml(params: InviteEmailParams): string {
  const { siteName, siteSubdomain, apex, appOrigin, inviterName, role, acceptUrl } = params;
  const publicAddress = `${siteSubdomain}.${apex}`;

  const bodyHtml =
    `<p style="margin:0 0 8px;">` +
      `<strong style="color:#1A1917;">${escapeHtml(inviterName)}</strong>` +
      ` invited you as an <strong style="color:#1A1917;">${escapeHtml(role)}</strong> on` +
    `</p>` +
    `<p style="margin:0;font-size:16px;color:#1A1917;font-weight:600;">` +
      `${escapeHtml(siteName)}` +
      ` <span style="color:#948D82;font-weight:400;font-size:13px;">(${escapeHtml(publicAddress)})</span>` +
    `</p>`;

  return brandShell({
    heading: "You've been invited to collaborate",
    bodyHtml,
    appOrigin,
    cta: { label: 'Accept invitation', href: acceptUrl },
    footnoteHtml:
      "This link expires in 7 days. If you didn't expect this invitation, you can ignore this email.",
  });
}

export function inviteEmailSubject(siteName: string): string {
  return `You've been invited to edit "${siteName.replace(/[\r\n]/g, '')}" on Open Canvas`;
}
