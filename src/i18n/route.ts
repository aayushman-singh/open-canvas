import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { customer, site } from '../db/schema';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware';
import { requireAuth } from '../auth/require-auth';
import { GeminiAdapter } from '../agent/llm-gemini';
import type { CanvasSiteState, InlineRun } from '../canvas/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DEV_PUBLIC_HOST?: string;
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
};

const translateApi = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

translateApi.use('*', clerkAuth());
translateApi.use('*', requireAuth());

function extractTexts(state: CanvasSiteState): { path: string; text: string }[] {
  const texts: { path: string; text: string }[] = [];
  for (let pi = 0; pi < state.pages.length; pi++) {
    const page = state.pages[pi];
    if (!page) continue;
    for (let si = 0; si < page.sections.length; si++) {
      const section = page.sections[si];
      if (!section) continue;
      for (let ei = 0; ei < section.elements.length; ei++) {
        const el = section.elements[ei];
        if (!el) continue;
        if (el.type === 'text' && Array.isArray(el.content)) {
          const plain = el.content.map((r: InlineRun) => r.text).join('');
          if (plain.trim()) {
            texts.push({ path: `pages[${pi}].sections[${si}].elements[${ei}]`, text: plain });
          }
        }
        if (el.type === 'action' && typeof el.label === 'string' && el.label.trim()) {
          texts.push({ path: `pages[${pi}].sections[${si}].elements[${ei}].label`, text: el.label });
        }
      }
    }
  }
  return texts;
}

translateApi.post('/:siteId/translate', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) return c.json({ error: 'unauthorized' }, 401);

  const siteId = c.req.param('siteId');
  const body = await c.req.json<{ targetLocale: string }>();
  const targetLocale = body.targetLocale;
  if (!targetLocale || typeof targetLocale !== 'string') {
    return c.json({ error: 'targetLocale is required' }, 400);
  }

  const database = db(c.env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return c.json({ error: 'customer not found' }, 404);

  const siteRows = await database
    .select({ id: site.id, editableState: site.editableState })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const siteRow = siteRows[0];
  if (!siteRow) return c.json({ error: 'site not found' }, 404);

  const state = siteRow.editableState as CanvasSiteState;
  const texts = extractTexts(state);
  if (texts.length === 0) {
    return c.json({ state, translated: 0 });
  }

  const gemini = new GeminiAdapter({ apiKey: c.env.GEMINI_API_KEY });
  const prompt = [
    `Translate the following texts to ${targetLocale}. Return a JSON array of translated strings in the same order. Translate naturally, not literally. Keep brand names, URLs, and code unchanged. Return ONLY the JSON array, no markdown fences.`,
    '',
    JSON.stringify(texts.map((t) => t.text)),
  ].join('\n');

  let translatedTexts: string[] = [];
  const chunks: string[] = [];
  for await (const chunk of gemini.chatWithTools(
    [{ role: 'user', content: prompt }],
    { tools: [], model: 'gemini-2.5-flash' },
  )) {
    if (chunk.type === 'text') chunks.push(chunk.text);
  }
  const raw = chunks.join('');
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return c.json({ error: 'translation failed: could not parse LLM response' }, 502);
  }
  translatedTexts = JSON.parse(jsonMatch[0]) as string[];

  if (translatedTexts.length !== texts.length) {
    return c.json({ error: 'translation failed: count mismatch' }, 502);
  }

  const newState = JSON.parse(JSON.stringify(state)) as CanvasSiteState;
  for (let i = 0; i < texts.length; i++) {
    const entry = texts[i]!;
    const translated = translatedTexts[i]!;
    if (entry.path.endsWith('.label')) {
      const elPath = entry.path.replace(/\.label$/, '');
      const el = resolvePath(newState, elPath);
      if (el && el.type === 'action') el.label = translated;
    } else {
      const el = resolvePath(newState, entry.path);
      if (el && el.type === 'text' && Array.isArray(el.content)) {
        el.content = [{ text: translated }];
      }
    }
  }

  await database.update(site).set({ editableState: newState }).where(eq(site.id, siteId));

  return c.json({ state: newState, translated: texts.length });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolvePath(obj: any, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current;
}

export default translateApi;
