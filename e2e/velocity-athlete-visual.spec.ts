import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';

type ViewportCase = {
  name: 'desktop' | 'mobile';
  width: number;
  height: number;
};

type RuntimeFailure = {
  type: string;
  detail: string | null;
};

type VisualSeedAsset = {
  mediaType: string;
  sourcePath: string;
};

const FAILURE_EVENTS = [
  'opencanvas:behaviour-failure',
  'opencanvas:collection-gallery-failed',
  'opencanvas:embed-drill-in-failed',
  'opencanvas:load-experience-failed',
  'opencanvas:marquee-failure',
  'opencanvas:overlay-failed',
  'opencanvas:pointer-fx-failure',
  'opencanvas:route-transition-failed',
  'opencanvas:video-hover-failure',
] as const;

const VIEWPORTS: ViewportCase[] = [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'mobile', width: 390, height: 844 },
];

const INPUT_DIR = path.join(process.cwd(), '.cache', 'velocity-athlete-visual');
const OUTPUT_DIR = path.join(process.cwd(), 'test-results', 'velocity-athlete-visual');
const PREVIEW_HTML_PATH = path.join(INPUT_DIR, 'preview.html');
const ASSET_MANIFEST_PATH = path.join(INPUT_DIR, 'seed-assets.json');
const SEED_SOURCE_DIR = path.join(process.cwd(), 'src', 'assets', 'seed-source');
const FORBIDDEN_TOKENS = ['lando', 'norris', 'mclaren', 'quadrant', 'gsap', 'ScrollTrigger'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[velocity-athlete:visual-e2e] ${message}`);
}

function readPreviewHtml(): string {
  try {
    return readFileSync(PREVIEW_HTML_PATH, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[velocity-athlete:visual-e2e] missing pre-rendered preview; run bun run src/templates/velocity-athlete-visual-render.ts first: ${message}`);
  }
}

function readAssetManifest(): Record<string, VisualSeedAsset> {
  try {
    return JSON.parse(readFileSync(ASSET_MANIFEST_PATH, 'utf8')) as Record<string, VisualSeedAsset>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[velocity-athlete:visual-e2e] missing seed asset manifest; run bun run src/templates/velocity-athlete-visual-render.ts first: ${message}`);
  }
}

async function expectVisible(page: Page, selector: string, message: string): Promise<Locator> {
  const locator = page.locator(selector);
  const count = await locator.count();
  assert(count > 0, `${message}: selector ${selector} did not match`);
  const first = locator.first();
  assert(await first.isVisible(), `${message}: selector ${selector} is not visible`);
  return first;
}

async function expectCount(page: Page, selector: string, expected: number, message: string): Promise<void> {
  const count = await page.locator(selector).count();
  assert(count === expected, `${message}: expected ${expected}, got ${count}`);
}

async function expectAtLeast(page: Page, selector: string, minimum: number, message: string): Promise<void> {
  const count = await page.locator(selector).count();
  assert(count >= minimum, `${message}: expected at least ${minimum}, got ${count}`);
}

async function installSeedAssetRouter(
  page: Page,
  assetManifest: Record<string, VisualSeedAsset>,
  assetFailures: string[],
): Promise<void> {
  await page.route('**/assets/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const assetId = decodeURIComponent(requestUrl.pathname.split('/').pop() ?? '');
    const asset = assetManifest[assetId];
    if (!asset) {
      const message = `missing seed asset ${assetId}`;
      assetFailures.push(message);
      await route.fulfill({ status: 404, contentType: 'text/plain', body: message });
      return;
    }

    try {
      const encoded = readFileSync(path.join(SEED_SOURCE_DIR, asset.sourcePath), 'utf8').trim();
      await route.fulfill({
        status: 200,
        contentType: asset.mediaType,
        body: Buffer.from(encoded, 'base64'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assetFailures.push(`failed to read seed asset ${assetId}: ${message}`);
      await route.fulfill({ status: 500, contentType: 'text/plain', body: message });
    }
  });
}

async function installFailureCollector(page: Page): Promise<void> {
  await page.addInitScript((eventNames: readonly string[]) => {
    const targetWindow = window as typeof window & { __opencanvasVisualFailures: RuntimeFailure[] };
    targetWindow.__opencanvasVisualFailures = [];
    for (const eventName of eventNames) {
      window.addEventListener(eventName, (event) => {
        const detail = (event as CustomEvent).detail;
        targetWindow.__opencanvasVisualFailures.push({
          type: event.type,
          detail: detail === undefined || detail === null ? null : JSON.stringify(detail),
        });
      });
    }
  }, FAILURE_EVENTS);
}

async function assertNoRuntimeFailures(page: Page, pageErrors: string[], consoleErrors: string[]): Promise<void> {
  const failures = await page.evaluate(() => {
    const targetWindow = window as typeof window & { __opencanvasVisualFailures?: RuntimeFailure[] };
    return targetWindow.__opencanvasVisualFailures ?? [];
  });
  assert(failures.length === 0, `runtime failure events were emitted: ${JSON.stringify(failures)}`);
  assert(pageErrors.length === 0, `page errors were emitted: ${pageErrors.join('\n')}`);
  assert(consoleErrors.length === 0, `console errors were emitted: ${consoleErrors.join('\n')}`);
}

async function verifyViewport(
  page: Page,
  html: string,
  assetManifest: Record<string, VisualSeedAsset>,
  viewport: ViewportCase,
): Promise<void> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const assetFailures: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installFailureCollector(page);
  await installSeedAssetRouter(page, assetManifest, assetFailures);
  await page.setContent(html, { waitUntil: 'networkidle' });

  const canvasPage = await expectVisible(page, '[data-opencanvas-page]', 'Velocity page root must render');
  await expectVisible(page, 'main.opencanvas-site', 'Velocity site shell must render');
  await expectVisible(page, '[data-opencanvas-section]', 'Velocity sections must render');
  await expectCount(page, 'script[data-opencanvas-interactive-runtime]', 1, 'interactive runtime script must be injected once');
  await expectCount(page, 'script[data-opencanvas-behaviour-payload]', 1, 'behaviour payload must be injected once');
  assert(html.includes('data-opencanvas-load-experience'), 'pre-rendered artifact must include load experience metadata');
  await expectAtLeast(page, '[data-opencanvas-rich-motion]', 1, 'rich motion must render');

  const enter = page.locator('[data-opencanvas-load-enter]').first();
  if ((await enter.count()) > 0 && (await enter.isVisible())) {
    await enter.click();
  }

  await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.45)));
  await page.waitForTimeout(250);

  const box = await canvasPage.boundingBox();
  assert(box !== null, 'Velocity page root must have a bounding box');
  assert(box.width >= Math.min(viewport.width, 320), `Velocity page root width is too small: ${box.width}`);
  assert(box.height >= viewport.height * 0.75, `Velocity page root height is too small: ${box.height}`);

  const bodyText = await page.locator('body').innerText();
  assert(bodyText.trim().length > 120, `Velocity body text is unexpectedly short: ${bodyText.trim().length}`);
  for (const token of FORBIDDEN_TOKENS) {
    assert(!bodyText.toLowerCase().includes(token.toLowerCase()), `visible template text leaks forbidden token ${token}`);
  }

  assert(assetFailures.length === 0, `asset routing failures occurred: ${assetFailures.join('\n')}`);
  await assertNoRuntimeFailures(page, pageErrors, consoleErrors);

  await page.screenshot({ path: path.join(OUTPUT_DIR, `velocity-athlete-${viewport.name}.png`), fullPage: true });
}

const html = readPreviewHtml();
const assetManifest = readAssetManifest();
mkdirSync(OUTPUT_DIR, { recursive: true });

test.describe('Velocity Athlete visual verification', () => {
  for (const viewport of VIEWPORTS) {
    test(`renders ${viewport.name} preview with runtime primitives`, async ({ page }) => {
      await verifyViewport(page, html, assetManifest, viewport);
    });
  }
});