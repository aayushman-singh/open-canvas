import puppeteer, { type Browser } from 'puppeteer';
import { extractSections } from './dom-walker.js';
import { extractColors, extractFontAssetReferences, extractFonts } from './color-extractor.js';
import { downloadAssets, resolveAssetUrl } from './asset-downloader.js';
import type { ScrapeResult } from './types.js';
import { assertPublicHttpUrl } from './url-safety.js';

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;
const PAGE_TIMEOUT = 30_000;
const MAX_PAGE_HEIGHT = 24_000;
const MAX_SCRAPED_ELEMENTS = 1_200;
const MAX_RESPONSE_ASSET_BYTES = 60 * 1024 * 1024;

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return browser;
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const safeUrl = await assertPublicHttpUrl(url);
  const warnings: string[] = [];
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      void assertPublicHttpUrl(request.url())
        .then(() => request.continue())
        .catch(() => request.abort('blockedbyclient'));
    });

    await page.goto(safeUrl.href, {
      waitUntil: 'networkidle0',
      timeout: PAGE_TIMEOUT,
    });

    await new Promise((r) => setTimeout(r, 1000));

    const fullHeight = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    );
    if (fullHeight > MAX_PAGE_HEIGHT) {
      throw new Error(
        `Page height exceeds import limit: ${String(fullHeight)}px > ${String(MAX_PAGE_HEIGHT)}px`,
      );
    }
    await page.setViewport({ width: VIEWPORT_WIDTH, height: fullHeight });
    await new Promise((r) => setTimeout(r, 500));

    const { sections } = await extractSections(page);

    if (sections.length === 0) {
      throw new Error(
        `No sections found on ${url}. The page may be empty, JavaScript-rendered without content, or blocked.`,
      );
    }

    const elementCount = sections.reduce((sum, section) => sum + section.elements.length, 0);
    if (elementCount > MAX_SCRAPED_ELEMENTS) {
      throw new Error(
        `Element count exceeds import limit: ${String(elementCount)} > ${String(MAX_SCRAPED_ELEMENTS)}`,
      );
    }

    const [colors, fonts, fontAssets] = await Promise.all([
      extractColors(page),
      extractFonts(page),
      extractFontAssetReferences(page),
    ]);

    const { assets, warnings: assetWarnings } = await downloadAssets(sections, safeUrl.href, {
      fontAssets,
    });
    warnings.push(...assetWarnings);

    const totalAssetBytes = assets.reduce((sum, asset) => sum + asset.buffer.byteLength, 0);
    if (totalAssetBytes > MAX_RESPONSE_ASSET_BYTES) {
      throw new Error(
        `Scrape asset payload exceeds response limit: ${String(totalAssetBytes)} bytes > ${String(
          MAX_RESPONSE_ASSET_BYTES,
        )} bytes`,
      );
    }

    const assetUrlMap = new Map<string, string>();
    for (const asset of assets.filter((a) => a.kind === 'media')) {
      assetUrlMap.set(asset.originalUrl, asset.originalUrl);
    }
    for (const section of sections) {
      for (const el of section.elements) {
        if (el.data.type === 'media' && el.data.originalUrl) {
          const resolved = resolveAssetUrl(el.data.originalUrl, safeUrl.href);
          const mapped = resolved ? assetUrlMap.get(resolved) : undefined;
          if (mapped) {
            el.data.src = mapped;
            el.data.originalUrl = mapped;
          } else {
            throw new Error(`Asset not downloaded for element: ${el.data.originalUrl}`);
          }
        }
      }
    }

    return {
      sections,
      colors,
      fonts,
      assets,
      warnings,
      sourceUrl: safeUrl.href,
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
