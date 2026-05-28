// src/auth/invite-token.ts
//
// HMAC-SHA256 JWT for email-based collaboration invitations. Signed by the
// server when the owner invites a collaborator; verified when the invitee
// clicks the accept link. 7-day TTL. The payload carries the collaborator
// row ID so acceptance is a single UPDATE … SET acceptedAt = now().

import { signJWT, verifyJWT } from './jwt';

export interface InviteTokenPayload {
  siteId: string;
  collaboratorId: string;
  // Signed audit metadata, not an enforcement gate at accept time. The accept
  // handler does not require a Clerk session, so there is no live identity to
  // compare this against. See ADR-0010.
  invitedEmail: string;
  iat: number;
  exp: number;
}

export type InviteVerifyResult =
  | { ok: true; payload: InviteTokenPayload }
  | { ok: false; reason: 'expired' | 'invalid' };

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function hasInviteTokenShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.siteId === 'string' &&
    typeof value.collaboratorId === 'string' &&
    typeof value.invitedEmail === 'string' &&
    typeof value.iat === 'number' &&
    typeof value.exp === 'number' &&
    Number.isFinite(value.iat) &&
    Number.isFinite(value.exp)
  );
}

export async function signInviteToken(
  payload: Omit<InviteTokenPayload, 'iat' | 'exp'>,
  secret: string,
): Promise<string> {
  return signJWT(payload, secret, INVITE_TTL_SECONDS);
}

export async function verifyInviteToken(
  token: string | undefined | null,
  secret: string,
): Promise<InviteVerifyResult> {
  const result = await verifyJWT(token, secret);
  if (!result.ok) {
    return result.reason === 'expired'
      ? { ok: false, reason: 'expired' }
      : { ok: false, reason: 'invalid' };
  }
  if (!hasInviteTokenShape(result.payload)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, payload: result.payload as unknown as InviteTokenPayload };
}
