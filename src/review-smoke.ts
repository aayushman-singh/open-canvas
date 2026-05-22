import app from './index';
import { validateCanvasSiteState } from './canvas/validate';
import { RESERVED_SUBDOMAINS, SUBDOMAIN_RE, validateSubdomain } from './routes/api/sites';

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

const emptySubdomain = validateSubdomain('');
assert(!emptySubdomain.valid, 'expected empty subdomain to be invalid');
assert(
  !emptySubdomain.valid && emptySubdomain.error.includes('required'),
  'expected empty subdomain error to mention "required"',
);

const oneCharSubdomain = validateSubdomain('a');
assert(!oneCharSubdomain.valid, 'expected single-character subdomain to be invalid (too short)');

const upperCaseSubdomain = validateSubdomain('Bad');
assert(!upperCaseSubdomain.valid, 'expected uppercase subdomain to be invalid');

const leadingHyphen = validateSubdomain('-bad');
assert(!leadingHyphen.valid, 'expected leading-hyphen subdomain to be invalid');

const trailingHyphen = validateSubdomain('bad-');
assert(!trailingHyphen.valid, 'expected trailing-hyphen subdomain to be invalid');

const reservedSubdomain = validateSubdomain('www');
assert(!reservedSubdomain.valid, 'expected reserved subdomain "www" to be invalid');

const validSubdomain = validateSubdomain('my-site-1');
assert(validSubdomain.valid, 'expected "my-site-1" to be a valid subdomain');

assert(SUBDOMAIN_RE instanceof RegExp, 'expected SUBDOMAIN_RE to be exported as a RegExp');
assert(RESERVED_SUBDOMAINS.has('admin'), 'expected RESERVED_SUBDOMAINS to include "admin"');

const emptyPagesState = validateCanvasSiteState({ styleKit: 'charcoal', pages: [] });
assert(!emptyPagesState.valid, 'expected canvas site state with no pages to be invalid');

const overWidePage = validateCanvasSiteState({
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 600,
          elements: [
            {
              id: 'over-wide',
              type: 'shape',
              variant: 'rect',
              box: { x: 100, y: 100, w: 2000, h: 200, z: 1 },
            },
          ],
        },
      ],
    },
  ],
});
assert(
  !overWidePage.valid,
  'expected element wider than the page width to be rejected (extends beyond page width)',
);
assert(
  !overWidePage.valid &&
    overWidePage.errors.some((message) => message.includes('extends beyond page width')),
  'expected over-wide element error to mention "extends beyond page width"',
);

const unmutedAutoplayVideo = validateCanvasSiteState({
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'video-hero',
          name: 'Hero',
          height: 600,
          elements: [
            {
              id: 'noisy-video',
              type: 'media',
              mediaKind: 'video',
              assetId: 'loop.mp4',
              alt: '',
              fit: 'cover',
              playback: { autoplay: true, muted: false },
              box: { x: 0, y: 0, w: 800, h: 450, z: 1 },
            },
          ],
        },
      ],
    },
  ],
});
assert(
  !unmutedAutoplayVideo.valid,
  'expected autoplay video without muted=true to be rejected (muted required for autoplay)',
);
assert(
  !unmutedAutoplayVideo.valid &&
    unmutedAutoplayVideo.errors.some((message) => message.includes('muted')),
  'expected unmuted-autoplay video error to mention "muted"',
);

console.log('[review-smoke] OK');
