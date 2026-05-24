import { Hono } from 'hono';
import { scrapeUrl, closeBrowser } from './scrape.js';
import { assertPublicHttpUrl, UnsafeUrlError } from './url-safety.js';

const app = new Hono();

const API_SECRET = process.env['SCRAPER_API_SECRET'];
if (!API_SECRET) {
  throw new Error('SCRAPER_API_SECRET environment variable is required');
}

app.use('*', async (c, next) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${API_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

app.post('/scrape', async (c) => {
  const body = await c.req.json<{ url?: string }>();

  if (!body.url || typeof body.url !== 'string') {
    return c.json({ error: 'Missing or invalid "url" field' }, 400);
  }

  try {
    await assertPublicHttpUrl(body.url);
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }

  try {
    const result = await scrapeUrl(body.url);

    const assetsBase64 = result.assets.map((a) => ({
      kind: a.kind,
      originalUrl: a.originalUrl,
      contentType: a.contentType,
      filename: a.filename,
      data: a.buffer.toString('base64'),
      ...(a.fontFamily !== undefined ? { fontFamily: a.fontFamily } : {}),
      ...(a.fontWeight !== undefined ? { fontWeight: a.fontWeight } : {}),
      ...(a.fontStyle !== undefined ? { fontStyle: a.fontStyle } : {}),
    }));

    return c.json({
      sections: result.sections,
      colors: result.colors,
      fonts: result.fonts,
      assets: assetsBase64,
      warnings: result.warnings,
      sourceUrl: result.sourceUrl,
      scrapedAt: result.scrapedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown scrape error';
    return c.json({ error: message }, 500);
  }
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const port = parseInt(process.env['PORT'] || '3100', 10);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`scraper service listening on :${server.port}`);

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});
