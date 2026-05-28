import type { FontAssetReference, ScrapedAsset, ScrapedSection } from './types.js';
import { assertPublicHttpUrl } from './url-safety.js';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/webm',
  'video/ogg',
]);

const DEFAULT_MAX_ASSETS = 40;
const DEFAULT_MAX_ASSET_SIZE = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_ASSET_BYTES = 60 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;

export interface AssetDownloadOptions {
  fontAssets?: FontAssetReference[] | undefined;
  maxAssets?: number | undefined;
  maxAssetBytes?: number | undefined;
  maxTotalBytes?: number | undefined;
  concurrency?: number | undefined;
}

interface AssetRequest {
  kind: 'media' | 'font';
  url: string;
  fontFamily?: string | undefined;
  fontWeight?: number | undefined;
  fontStyle?: 'normal' | 'italic' | undefined;
}

export async function downloadAssets(
  sections: ScrapedSection[],
  sourceUrl: string,
  options: AssetDownloadOptions = {},
): Promise<{ assets: ScrapedAsset[]; warnings: string[] }> {
  const requests = collectAssetRequests(sections, sourceUrl, options.fontAssets ?? []);
  const maxAssets = options.maxAssets ?? DEFAULT_MAX_ASSETS;
  if (requests.length > maxAssets) {
    throw new Error(`asset count exceeds limit: ${String(requests.length)} > ${String(maxAssets)}`);
  }

  let totalBytes = 0;
  const assets = await mapWithConcurrency(
    requests,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (request) => {
      const asset = await downloadOne(
        request,
        sourceUrl,
        options.maxAssetBytes ?? DEFAULT_MAX_ASSET_SIZE,
      );
      totalBytes += asset.buffer.byteLength;
      const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_ASSET_BYTES;
      if (totalBytes > maxTotalBytes) {
        throw new Error(
          `total asset bytes exceed limit: ${String(totalBytes)} > ${String(maxTotalBytes)}`,
        );
      }
      return asset;
    },
  );

  return { assets, warnings: [] };
}

export function resolveAssetUrl(raw: string, base: string): string | null {
  try {
    if (raw.startsWith('data:')) return null;
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function collectAssetRequests(
  sections: ScrapedSection[],
  sourceUrl: string,
  fontAssets: FontAssetReference[],
): AssetRequest[] {
  const requests = new Map<string, AssetRequest>();

  for (const section of sections) {
    for (const el of section.elements) {
      if (el.data.type !== 'media' || !el.data.originalUrl) continue;
      const resolved = resolveAssetUrl(el.data.originalUrl, sourceUrl);
      if (resolved) requests.set(`media:${resolved}`, { kind: 'media', url: resolved });
    }
  }

  for (const font of fontAssets) {
    const resolved = resolveAssetUrl(font.url, sourceUrl);
    if (!resolved) continue;
    requests.set(`font:${font.fontFamily}:${resolved}`, {
      kind: 'font',
      url: resolved,
      fontFamily: font.fontFamily,
      ...(font.fontWeight !== undefined ? { fontWeight: font.fontWeight } : {}),
      ...(font.fontStyle !== undefined ? { fontStyle: font.fontStyle } : {}),
    });
  }

  return [...requests.values()];
}

async function downloadOne(
  request: AssetRequest,
  sourceUrl: string,
  maxAssetBytes: number,
): Promise<ScrapedAsset> {
  const safeUrl = await assertPublicHttpUrl(request.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetchPublicUrl(safeUrl.href, sourceUrl, controller.signal);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

    if (contentLength > maxAssetBytes) {
      throw new Error(`Asset too large: ${contentLength} bytes`);
    }

    if (!isAllowedContentType(contentType, safeUrl.href, request.kind)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxAssetBytes) {
      throw new Error(`Asset too large: ${arrayBuffer.byteLength} bytes`);
    }

    const filename = extractFilename(safeUrl.href, contentType);

    return {
      kind: request.kind,
      originalUrl: safeUrl.href,
      buffer: Buffer.from(arrayBuffer),
      contentType: contentType || guessContentType(safeUrl.href),
      filename,
      ...(request.fontFamily !== undefined ? { fontFamily: request.fontFamily } : {}),
      ...(request.fontWeight !== undefined ? { fontWeight: request.fontWeight } : {}),
      ...(request.fontStyle !== undefined ? { fontStyle: request.fontStyle } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPublicUrl(
  url: string,
  sourceUrl: string,
  signal: AbortSignal,
  redirectDepth = 0,
): Promise<Response> {
  if (redirectDepth > 5) {
    throw new Error(`too many redirects while downloading asset ${url}`);
  }

  const response = await fetch(url, {
    signal,
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; rev01-importer/1.0)',
      Referer: sourceUrl,
    },
  });
  // Re-check the final response URL because Fetch implementations may expose
  // a resolved URL even when redirects are handled manually.
  await assertPublicHttpUrl(response.url || url);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`redirect without Location header for asset ${url}`);
    }
    const next = new URL(location, url).href;
    await assertPublicHttpUrl(next);
    return fetchPublicUrl(next, sourceUrl, signal, redirectDepth + 1);
  }

  return response;
}

function isAllowedContentType(contentType: string, url: string, kind: 'media' | 'font'): boolean {
  if (kind === 'font') {
    return (
      contentType === 'font/woff2' || url.split('?')[0]?.toLowerCase().endsWith('.woff2') === true
    );
  }

  if (ALLOWED_CONTENT_TYPES.has(contentType) && !contentType.startsWith('font/')) return true;
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase();
  const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp']);
  const videoExts = new Set(['mp4', 'webm', 'ogg']);
  if (ext && (imageExts.has(ext) || videoExts.has(ext))) return true;
  return false;
}

function guessContentType(url: string): string {
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  };
  return (ext && map[ext]) || 'application/octet-stream';
}

function extractFilename(url: string, contentType: string): string {
  try {
    const pathname = new URL(url).pathname;
    const basename = pathname.split('/').pop();
    if (basename && basename.includes('.')) return basename;
  } catch {}

  const ext = contentType.split('/')[1] || 'bin';
  const hash = simpleHash(url);
  return `asset-${hash}.${ext}`;
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`concurrency must be a positive integer, got ${String(concurrency)}`);
  }

  const results: R[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
