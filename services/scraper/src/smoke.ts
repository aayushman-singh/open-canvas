import { downloadAssets } from './asset-downloader.js';
import type { ScrapedSection } from './types.js';
import { assertPublicHttpUrl, isBlockedIpAddress } from './url-safety.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[scraper:smoke] ${message}`);
}

async function assertRejects(fn: () => Promise<unknown>, expected: string): Promise<void> {
  let rejected = false;
  try {
    await fn();
  } catch (err) {
    rejected = true;
    const message = err instanceof Error ? err.message : String(err);
    assert(
      message.includes(expected),
      `expected rejection containing "${expected}", got "${message}"`,
    );
  }
  assert(rejected, `expected function to reject with "${expected}"`);
}

assert(isBlockedIpAddress('127.0.0.1'), 'loopback IPv4 must be blocked');
assert(isBlockedIpAddress('10.12.0.5'), 'RFC1918 IPv4 must be blocked');
assert(isBlockedIpAddress('169.254.169.254'), 'metadata/link-local IPv4 must be blocked');
assert(isBlockedIpAddress('::1'), 'loopback IPv6 must be blocked');
assert(!isBlockedIpAddress('93.184.216.34'), 'public IPv4 must be allowed');

await assertRejects(
  () => assertPublicHttpUrl('http://127.0.0.1:8080/private'),
  'blocked private/reserved address',
);
await assertRejects(
  () => assertPublicHttpUrl('file:///etc/passwd'),
  'URL must use http or https protocol',
);

const sections: ScrapedSection[] = [
  {
    name: 'hero',
    top: 0,
    height: 200,
    elements: [
      {
        type: 'media',
        box: { x: 0, y: 0, w: 100, h: 100, z: 1 },
        data: {
          type: 'media',
          src: 'https://cdn.example.test/a.png',
          alt: '',
          mediaType: 'image',
          originalUrl: 'https://cdn.example.test/a.png',
        },
      },
      {
        type: 'media',
        box: { x: 120, y: 0, w: 100, h: 100, z: 1 },
        data: {
          type: 'media',
          src: 'https://cdn.example.test/b.png',
          alt: '',
          mediaType: 'image',
          originalUrl: 'https://cdn.example.test/b.png',
        },
      },
    ],
  },
];

await assertRejects(
  () => downloadAssets(sections, 'https://example.com', { maxAssets: 1 }),
  'asset count exceeds limit',
);

console.log('[scraper:smoke] OK');
