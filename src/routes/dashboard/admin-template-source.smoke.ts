import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[admin-template-source:smoke] ${message}`);
}

const source = readFileSync(
  join(process.cwd(), 'src', 'routes', 'dashboard', 'admin-template-source.tsx'),
  'utf8',
);

assert(
  !source.includes('127.0.0.1') && !source.includes('localhost'),
  'production dashboard admin route must not point at a local-only source editor',
);
assert(
  source.includes('createTemplateSourcePullRequest'),
  'production dashboard admin route must create GitHub-backed source PRs',
);
assert(
  source.includes('/api/templates/:templateId/sections/:sectionId/pull-request'),
  'production dashboard admin route must expose a PR creation endpoint',
);

console.log('[admin-template-source:smoke] OK');
