import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[public-invite:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'routes', 'public.ts'), 'utf8');

const start = source.indexOf('async function handleAcceptInvite');
assert(start >= 0, 'public router must define handleAcceptInvite');
const end = source.indexOf('function buildComingSoonPage', start);
assert(end > start, 'handleAcceptInvite body must be bounded before buildComingSoonPage');
const handleAcceptInvite = source.slice(start, end);

assert(
  handleAcceptInvite.includes('eq(siteCollaborator.id, result.payload.collaboratorId)'),
  'invite acceptance must scope the update by collaborator id',
);
assert(
  handleAcceptInvite.includes('eq(siteCollaborator.siteId, siteRow.id)'),
  'invite acceptance must scope the update by the current public site',
);
assert(
  handleAcceptInvite.includes('eq(siteCollaborator.invitedEmail, result.payload.invitedEmail)'),
  'invite acceptance must scope the update by the signed invited email',
);

console.log('[public-invite:smoke] OK');
