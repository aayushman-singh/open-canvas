import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const routeSource = readFileSync('src/routes/api/library-sections.ts', 'utf8');
assert(
  routeSource.includes('isTemplateSourceAdminCustomer'),
  'library sections admin API must use the Template Curator customer gate',
);
assert(
  !routeSource.includes('ADMIN_CLERK_USER_IDS'),
  'library sections admin API must not depend on ADMIN_CLERK_USER_IDS',
);
assert(
  !routeSource.includes('requireAdmin()'),
  'library sections admin API must not use the generic Clerk-ID admin gate',
);

console.log('[library-sections:smoke] OK');
