// src/notifications/render-email.ts
//
// Per-kind email subject + html for ADR 0043. One function pair per kind.
// Compose into the brand shell from src/email/templates/shell.ts so every
// notification email lands looking like the rest of the transactional set.

import { brandShell, escapeHtml } from '../email/templates/shell.js';
import type {
  AccessEventPayload,
  CollaboratorEventPayload,
  FormSubmissionPayload,
  PayloadByKind,
  PublishEventPayload,
} from './kinds.js';
import type { NotificationKind } from '../db/schema.js';

export interface RenderedEmail {
  subject: string;
  html: string;
}

// `appOrigin` is the public origin used to build action links inside the
// email body (e.g. https://opencanvas.aayushman.dev). The caller resolves it
// from env via `appOrigin(env)`.
export interface RenderEmailCtx {
  appOrigin: string;
}

export function renderNotificationEmail<K extends NotificationKind>(
  kind: K,
  payload: PayloadByKind[K],
  ctx: RenderEmailCtx,
  recipientCustomerId?: string,
): RenderedEmail {
  switch (kind) {
    case 'form_submission':
      return renderFormSubmissionEmail(payload as FormSubmissionPayload, ctx);
    case 'collaborator_event':
      return renderCollaboratorEventEmail(payload as CollaboratorEventPayload, ctx);
    case 'publish_event':
      return renderPublishEventEmail(payload as PublishEventPayload, ctx);
    case 'access_event':
      return renderAccessEventEmail(payload as AccessEventPayload, ctx, recipientCustomerId);
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      throw new Error(`renderNotificationEmail: unhandled kind ${String(kind)}`);
    }
  }
}

// ----------------------------------------------------------------------------
// form_submission
// ----------------------------------------------------------------------------

function renderFormSubmissionEmail(
  p: FormSubmissionPayload,
  ctx: RenderEmailCtx,
): RenderedEmail {
  const inboxUrl = `${ctx.appOrigin}/dashboard/sites/${encodeURIComponent(p.siteId)}/forms`;
  const bodyHtml =
    `<p style="margin:0 0 16px;">A new submission landed on ` +
    `<strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong>.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">` +
    `<tr><td style="padding:6px 0;color:#948D82;width:120px;">Form</td>` +
    `<td style="padding:6px 0;color:#1A1917;">${escapeHtml(p.formElementLabel)}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#948D82;">Page</td>` +
    `<td style="padding:6px 0;color:#1A1917;">${escapeHtml(p.pageSlug)}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#948D82;">Submitted</td>` +
    `<td style="padding:6px 0;color:#1A1917;">${escapeHtml(p.submittedAt)}</td></tr>` +
    `</table>`;
  return {
    subject: `New form submission on ${p.siteName}`,
    html: brandShell({
      heading: 'New form submission',
      bodyHtml,
      appOrigin: ctx.appOrigin,
      cta: { label: 'View in Forms Inbox', href: inboxUrl },
    }),
  };
}

// ----------------------------------------------------------------------------
// collaborator_event — emailed only to the subject (per email-policy.ts)
// ----------------------------------------------------------------------------

function renderCollaboratorEventEmail(
  p: CollaboratorEventPayload,
  ctx: RenderEmailCtx,
): RenderedEmail {
  const siteUrl = `${ctx.appOrigin}/dashboard/sites/${encodeURIComponent(p.siteId)}`;
  const actorName = p.actorDisplayName ?? 'A site admin';
  switch (p.action) {
    case 'invited': {
      const bodyHtml =
        `<p style="margin:0 0 8px;">` +
        `<strong style="color:#1A1917;">${escapeHtml(actorName)}</strong> ` +
        `invited you to collaborate on ` +
        `<strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong>.` +
        `</p>`;
      return {
        subject: `You were invited to "${p.siteName}" on Open Canvas`,
        html: brandShell({
          heading: 'New site invitation',
          bodyHtml,
          appOrigin: ctx.appOrigin,
          cta: { label: 'Open site', href: siteUrl },
        }),
      };
    }
    case 'joined': {
      const bodyHtml = `<p style="margin:0;">You joined <strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong>.</p>`;
      return {
        subject: `You joined "${p.siteName}"`,
        html: brandShell({
          heading: "You're on the team",
          bodyHtml,
          appOrigin: ctx.appOrigin,
          cta: { label: 'Open site', href: siteUrl },
        }),
      };
    }
    case 'left': {
      const bodyHtml = `<p style="margin:0;">You no longer have access to <strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong>.</p>`;
      return {
        subject: `You left "${p.siteName}"`,
        html: brandShell({
          heading: 'Access removed',
          bodyHtml,
          appOrigin: ctx.appOrigin,
        }),
      };
    }
    default: {
      const _exhaustive: never = p.action;
      void _exhaustive;
      throw new Error(`renderCollaboratorEventEmail: unhandled action ${String(p.action)}`);
    }
  }
}

// ----------------------------------------------------------------------------
// publish_event — emailed only on outcome='failed' (per email-policy.ts)
// ----------------------------------------------------------------------------

function renderPublishEventEmail(
  p: PublishEventPayload,
  ctx: RenderEmailCtx,
): RenderedEmail {
  // Policy excludes 'succeeded' but render defensively in case a future
  // policy change brings success emails in scope.
  if (p.outcome === 'succeeded') {
    const bodyHtml = `<p style="margin:0;">Publish #${escapeHtml(String(p.publishedVersion ?? '?'))} of <strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong> is live.</p>`;
    return {
      subject: `Publish succeeded on ${p.siteName}`,
      html: brandShell({ heading: 'Publish succeeded', bodyHtml, appOrigin: ctx.appOrigin }),
    };
  }
  const reason = p.failureReason ?? 'Unknown failure';
  const siteUrl = `${ctx.appOrigin}/dashboard/sites/${encodeURIComponent(p.siteId)}`;
  const bodyHtml =
    `<p style="margin:0 0 12px;">A publish of <strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong> ` +
    `failed at ${escapeHtml(p.occurredAt)}.</p>` +
    `<p style="margin:0;color:#5B564E;font-family:'Spline Sans Mono',ui-monospace,SFMono-Regular,monospace;font-size:12px;">` +
    `${escapeHtml(reason)}` +
    `</p>`;
  return {
    subject: `Publish failed on ${p.siteName}`,
    html: brandShell({
      heading: 'Publish failed',
      bodyHtml,
      appOrigin: ctx.appOrigin,
      cta: { label: 'Open site', href: siteUrl },
    }),
  };
}

// ----------------------------------------------------------------------------
// access_event uses recipient-aware copy: affected Owners get "your access"
// wording, site onlookers get teammate wording.
// ----------------------------------------------------------------------------

function renderAccessEventEmail(
  p: AccessEventPayload,
  ctx: RenderEmailCtx,
  recipientCustomerId?: string,
): RenderedEmail {
  const siteUrl = `${ctx.appOrigin}/dashboard/sites/${encodeURIComponent(p.siteId)}`;
  const actorName = p.actorDisplayName;
  const isSubject = recipientCustomerId === undefined || recipientCustomerId === p.subjectCustomerId;
  switch (p.change) {
    case 'role_changed': {
      if (!isSubject) {
        const bodyHtml =
          `<p style="margin:0 0 8px;">` +
          `<strong style="color:#1A1917;">${escapeHtml(actorName)}</strong> changed ` +
          `<strong style="color:#1A1917;">${escapeHtml(p.subjectDisplayName)}</strong>'s role on ` +
          `<strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong> from ` +
          `<strong style="color:#1A1917;">${escapeHtml(p.previousRole)}</strong> to ` +
          `<strong style="color:#1A1917;">${escapeHtml(p.nextRole ?? 'unknown')}</strong>.` +
          `</p>`;
        return {
          subject: `${p.subjectDisplayName}'s role changed on "${p.siteName}"`,
          html: brandShell({
            heading: 'Role changed',
            bodyHtml,
            appOrigin: ctx.appOrigin,
            cta: { label: 'Open site', href: siteUrl },
          }),
        };
      }
      const bodyHtml =
        `<p style="margin:0 0 8px;">` +
        `<strong style="color:#1A1917;">${escapeHtml(actorName)}</strong> changed your role on ` +
        `<strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong> from ` +
        `<strong style="color:#1A1917;">${escapeHtml(p.previousRole)}</strong> to ` +
        `<strong style="color:#1A1917;">${escapeHtml(p.nextRole ?? 'unknown')}</strong>.` +
        `</p>`;
      return {
        subject: `Your role changed on "${p.siteName}"`,
        html: brandShell({
          heading: 'Role changed',
          bodyHtml,
          appOrigin: ctx.appOrigin,
          cta: { label: 'Open site', href: siteUrl },
        }),
      };
    }
    case 'revoked': {
      if (!isSubject) {
        const bodyHtml =
          `<p style="margin:0;">` +
          `<strong style="color:#1A1917;">${escapeHtml(actorName)}</strong> removed ` +
          `<strong style="color:#1A1917;">${escapeHtml(p.subjectDisplayName)}</strong>'s access to ` +
          `<strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong>.` +
          `</p>`;
        return {
          subject: `${p.subjectDisplayName}'s access to "${p.siteName}" was revoked`,
          html: brandShell({
            heading: 'Access revoked',
            bodyHtml,
            appOrigin: ctx.appOrigin,
            cta: { label: 'Open site', href: siteUrl },
          }),
        };
      }
      const bodyHtml =
        `<p style="margin:0;">` +
        `<strong style="color:#1A1917;">${escapeHtml(actorName)}</strong> removed your access to ` +
        `<strong style="color:#1A1917;">${escapeHtml(p.siteName)}</strong>. You can no longer edit this site.` +
        `</p>`;
      return {
        subject: `Your access to "${p.siteName}" was revoked`,
        html: brandShell({ heading: 'Access revoked', bodyHtml, appOrigin: ctx.appOrigin }),
      };
    }
    default: {
      const _exhaustive: never = p.change;
      void _exhaustive;
      throw new Error(`renderAccessEventEmail: unhandled change ${String(p.change)}`);
    }
  }
}
