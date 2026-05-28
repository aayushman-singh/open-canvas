// Pin the env-contract boundary. requireTurnstileSiteKey() must fail loudly on
// a missing/empty env var so a deployment can never silently render a form
// without bot protection. If this smoke ever passes with an empty key, the
// finding from the OSS code review (batch 1 #3) has regressed.

import { requireTurnstileSiteKey } from './form.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[turnstile-key:smoke] ${message}`);
}

function expectThrow(env: { TURNSTILE_SITE_KEY?: string }, label: string): void {
  let threw = false;
  try {
    requireTurnstileSiteKey(env);
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes('TURNSTILE_SITE_KEY'),
      `${label}: error must mention TURNSTILE_SITE_KEY`,
    );
  }
  assert(threw, `${label}: requireTurnstileSiteKey must throw, not return a default`);
}

expectThrow({}, 'missing env');
expectThrow({ TURNSTILE_SITE_KEY: '' }, 'empty string');
// Distinct from absent — env loaders may set the key but populate undefined.
expectThrow({ TURNSTILE_SITE_KEY: undefined as unknown as string }, 'undefined');

const ok = requireTurnstileSiteKey({ TURNSTILE_SITE_KEY: '0x4AAA0000RealKey' });
assert(ok === '0x4AAA0000RealKey', 'non-empty key returned verbatim');

console.log('[turnstile-key:smoke] OK');
