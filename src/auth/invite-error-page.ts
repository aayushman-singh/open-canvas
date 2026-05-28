// src/auth/invite-error-page.ts
//
// Shared HTML renderer for invitation-flow error pages. Used by both the
// main-domain redirector (/__invite) and the published-subdomain accept
// handler (/__accept-invite). Kept here so the two entry points agree on
// copy + status codes; the redirector and the accept handler diverge on
// what they do with a valid token, not on how they report a bad one.

export type InviteErrorKind = 'expired' | 'invalid' | 'cancelled' | 'site-missing';

interface InviteErrorCopy {
  title: string;
  body: string;
  status: 400 | 404 | 410;
}

const COPY: Record<InviteErrorKind, InviteErrorCopy> = {
  expired: {
    title: 'Invitation expired',
    body: 'This invitation link has expired. Ask the site owner to send a new one.',
    status: 410,
  },
  invalid: {
    title: 'Invalid invitation link',
    body: 'This invitation link could not be verified. Check the URL or ask the site owner to resend.',
    status: 400,
  },
  cancelled: {
    title: 'Invitation no longer available',
    body: 'The site owner has cancelled or removed this invitation.',
    status: 410,
  },
  'site-missing': {
    title: 'Site no longer exists',
    body: 'The site this invitation was for has been deleted.',
    status: 404,
  },
};

export function buildInviteErrorResponse(kind: InviteErrorKind): Response {
  const { title, body, status } = COPY[kind];
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
    <title>rev01 — ${title}</title>
    <style>body{margin:0;display:flex;align-items:center;justify-content:center;
    min-height:100vh;font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;}
    .wrap{text-align:center;max-width:400px;padding:32px;}
    h1{font-size:20px;margin:0 0 12px;}
    p{font-size:14px;opacity:0.7;line-height:1.5;margin:0;}</style></head>
    <body><div class="wrap"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
