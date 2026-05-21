import app from './index';
import { validateDocument } from './document/validate';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function responseText(path: string): Promise<{ status: number; body: string }> {
  const response = await app.request(`http://rev01.test${path}`);
  return { status: response.status, body: await response.text() };
}

const root = await responseText('/');
assert(root.status === 200, `expected public / to return 200, got ${root.status}`);
assert(
  root.body.includes('multiplayer site builder'),
  'expected public / to render the Post-Aero landing',
);
assert(!root.body.includes('Math.random'), 'expected landing counters not to fake live activity');
assert(
  !root.body.includes('editors online'),
  'expected landing copy not to claim simulated editors are online',
);

const OriginalDate = Date;
(globalThis as { Date: DateConstructor }).Date = class extends OriginalDate {
  constructor() {
    super('2030-01-02T00:00:00.000Z');
  }

  static override now(): number {
    return new OriginalDate('2030-01-02T00:00:00.000Z').getTime();
  }
} as DateConstructor;
const shiftedClockRoot = await responseText('/');
(globalThis as { Date: DateConstructor }).Date = OriginalDate;
assert(root.body === shiftedClockRoot.body, 'expected landing HTML not to depend on request time');

const health = await responseText('/health');
assert(health.status === 200, `expected public /health to return 200, got ${health.status}`);
assert(health.body.includes('"ok":true'), 'expected /health to return ok heartbeat JSON');

const executableActionHref = validateDocument({
  type: 'doc',
  content: [
    {
      type: 'section',
      attrs: { kind: 'hero' },
      content: [
        {
          type: 'actions',
          content: [{ type: 'action', attrs: { href: 'javascript:alert(1)', label: 'Run' } }],
        },
      ],
    },
  ],
});
assert(
  !executableActionHref.valid,
  'expected document validator to reject executable action hrefs',
);

const executableLinkHref = validateDocument({
  type: 'doc',
  content: [
    {
      type: 'section',
      attrs: { kind: 'hero' },
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Run',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    },
  ],
});
assert(!executableLinkHref.valid, 'expected document validator to reject executable link hrefs');

console.log('[review-smoke] OK');
