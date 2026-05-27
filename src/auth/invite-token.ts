// src/auth/invite-token.ts
//
// HMAC-SHA256 JWT for email-based collaboration invitations. Signed by the
// server when the owner invites a collaborator; verified when the invitee
// clicks the accept link. 7-day TTL. The payload carries the collaborator
// row ID so acceptance is a single UPDATE … SET acceptedAt = now().

import { signEditToken, verifyEditToken } from './edit-token';

export interface InviteTokenPayload {
  siteId: string;
  collaboratorId: string;
  invitedEmail: string;
  iat: number;
  exp: number;
}

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function signInviteToken(
  payload: Omit<InviteTokenPayload, 'iat' | 'exp'>,
  secret: string,
): Promise<string> {
  // Reuse the same HMAC-SHA256 signing from edit-token but with invite-specific
  // payload fields and a longer TTL. The token format is identical (header.payload.sig)
  // so verifyEditToken can decode it — we just cast the payload type.
  // REVIEW: casting InviteTokenPayload to EditTokenPayload is a type lie — the shapes have incompatible fields (collaboratorId vs customerId). Works because signEditToken just JSON-encodes the payload, but this creates tight coupling to an implementation detail. Extract a generic `signHMACJwt(payload: Record<string, unknown>, secret, ttl)` function both can call.
  return signEditToken(payload as unknown as Omit<import('./edit-token').EditTokenPayload, 'iat' | 'exp'>, secret, INVITE_TTL_SECONDS);
}

export async function verifyInviteToken(
  token: string | undefined | null,
  secret: string,
): Promise<InviteTokenPayload | null> {
  const raw = await verifyEditToken(token, secret);
  if (!raw) return null;
  // Verify invite-specific fields are present
  const payload = raw as unknown as Record<string, unknown>;
  if (
    typeof payload.collaboratorId !== 'string' ||
    typeof payload.invitedEmail !== 'string' ||
    typeof payload.siteId !== 'string'
  ) {
    return null;
  }
  return payload as unknown as InviteTokenPayload;
}
