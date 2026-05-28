import { clerkUserHasVerifiedEmail } from './collaborators';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[collaborators:smoke] ${message}`);
}

const verifiedSecondary = {
  emailAddresses: [
    { emailAddress: 'primary@example.com', verification: { status: 'verified' } },
    { emailAddress: 'Alias@Example.com', verification: { status: 'verified' } },
  ],
};

const unverifiedSecondary = {
  emailAddresses: [
    { emailAddress: 'primary@example.com', verification: { status: 'verified' } },
    { emailAddress: 'alias@example.com', verification: { status: 'unverified' } },
  ],
};

assert(
  clerkUserHasVerifiedEmail(verifiedSecondary, 'alias@example.com'),
  'verified secondary emails should resolve case-insensitively',
);
assert(
  !clerkUserHasVerifiedEmail(unverifiedSecondary, 'alias@example.com'),
  'unverified secondary emails must not resolve a customer',
);
assert(
  !clerkUserHasVerifiedEmail(verifiedSecondary, 'other@example.com'),
  'different verified emails must not resolve a customer',
);

console.log('[collaborators:smoke] OK');
