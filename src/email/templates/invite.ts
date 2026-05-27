// src/email/templates/invite.ts
//
// HTML email template for site collaboration invitations. Kept as a plain
// function returning a string — no templating library needed for one template.

export interface InviteEmailParams {
  siteName: string;
  siteSubdomain: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}

export function inviteEmailHtml(params: InviteEmailParams): string {
  const { siteName, siteSubdomain, inviterName, role, acceptUrl } = params;
  const publicAddress = `${siteSubdomain}.rev01.aayushman.dev`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#0d1117;padding:24px 32px;">
          <span style="color:#22d3ee;font-family:monospace;font-size:20px;font-weight:700;">r1</span>
          <span style="color:#e6edf3;font-size:14px;margin-left:8px;">rev01</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:20px;color:#18181b;">You've been invited to collaborate</h1>
          <p style="margin:0 0 8px;font-size:14px;color:#52525b;line-height:1.6;">
            <strong>${escapeHtml(inviterName)}</strong> invited you as an <strong>${escapeHtml(role)}</strong> on
          </p>
          <p style="margin:0 0 24px;font-size:16px;color:#18181b;font-weight:600;">
            ${escapeHtml(siteName)} <span style="color:#a1a1aa;font-weight:400;font-size:13px;">(${escapeHtml(publicAddress)})</span>
          </p>
          <a href="${escapeHtml(acceptUrl)}"
             style="display:inline-block;padding:12px 28px;background:#22d3ee;color:#0d1117;
                    font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">
            Accept invitation
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">
            This link expires in 7 days. If you didn't expect this invitation, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function inviteEmailSubject(siteName: string): string {
  return `You've been invited to edit "${siteName.replace(/[\r\n]/g, '')}" on rev01`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
