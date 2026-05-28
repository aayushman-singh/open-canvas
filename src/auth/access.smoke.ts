import { accessRoleMeetsRequirement } from './accessible-site.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[auth-access:smoke] ${message}`);
}

assert(accessRoleMeetsRequirement('owner', 'viewer'), 'owner must satisfy viewer access');
assert(accessRoleMeetsRequirement('owner', 'editor'), 'owner must satisfy editor access');
assert(accessRoleMeetsRequirement('owner', 'owner'), 'owner must satisfy owner access');
assert(accessRoleMeetsRequirement('editor', 'viewer'), 'editor must satisfy viewer access');
assert(accessRoleMeetsRequirement('editor', 'editor'), 'editor must satisfy editor access');
assert(!accessRoleMeetsRequirement('editor', 'owner'), 'editor must not satisfy owner access');
assert(accessRoleMeetsRequirement('viewer', 'viewer'), 'viewer must satisfy viewer access');
assert(!accessRoleMeetsRequirement('viewer', 'editor'), 'viewer must not satisfy editor access');
assert(!accessRoleMeetsRequirement('viewer', 'owner'), 'viewer must not satisfy owner access');

console.log('[auth-access:smoke] OK');
