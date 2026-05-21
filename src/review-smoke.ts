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
