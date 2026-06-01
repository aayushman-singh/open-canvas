import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { sha256Hex, contentHashToR2Key, extFromMediaType } from '../../assets/hash';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { siteLimitError, siteLimitForPlan } from '../../billing/plan-limits';
import type {
  EditableSite,
  CanvasPage,
  CanvasSection,
  CanvasElement,
  TextElement,
  MediaElement,
  ActionElement,
  ShapeElement,
  ContainerElement,
  MotionPreset,
  InlineRun,
  ActionVariant,
  SurfaceVariant,
  ShapeVariant,
  MediaKind,
} from '../../canvas/schema';
import { MOTION_PRESETS } from '../../canvas/schema';
import { validateEditableSite } from '../../canvas/validate';
import { isSiteLimitViolation, validateSubdomain } from './sites';
import { db } from '../../db/client';
import { customer, ownerAsset, site, siteFont } from '../../db/schema';
import { fontContentHashToR2Key } from '../../fonts/upload';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ASSETS_BUCKET: R2Bucket;
  SCRAPER_URL: string;
  SCRAPER_API_SECRET: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const importRouter = new Hono<Env>();

importRouter.use('*', clerkAuth());
importRouter.use('*', requireAuth());

export interface ScraperSection {
  name: string;
  top: number;
  height: number;
  elements: ScraperElement[];
  backgroundColor?: string;
}

export interface ScraperElement {
  type: string;
  box: { x: number; y: number; w: number; h: number; z: number };
  rotation?: number;
  data: Record<string, unknown>;
  motion?: { preset: string; delayMs?: number };
  pinnedStyle?: Record<string, string>;
}

export interface ScraperAsset {
  kind?: 'media' | 'font';
  originalUrl: string;
  contentType: string;
  filename: string;
  data: string; // base64
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
}

export interface ScraperResponse {
  sections: ScraperSection[];
  colors: { seed: string; bg: string; text: string; muted: string };
  fonts: { display: string; body: string; mono: string };
  assets: ScraperAsset[];
  warnings: string[];
  sourceUrl: string;
  scrapedAt: string;
}

export interface ExistingOwnerAssetRow {
  id: string;
  contentHash: string;
}

export interface PreparedImportedAssets {
  mediaAssetIdMap: Map<string, string>;
  mediaAssetRows: Array<typeof ownerAsset.$inferInsert>;
  fontRows: Array<typeof siteFont.$inferInsert>;
  r2Uploads: Array<{ key: string; data: Uint8Array; contentType: string }>;
  fontFamilyTokenMap: Map<string, string>;
}

const MOTION_PRESET_SET = new Set<string>(MOTION_PRESETS);

function isValidMotionPreset(p: string): p is MotionPreset {
  return MOTION_PRESET_SET.has(p);
}

importRouter.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('POST /api/import reached without an authenticated user');
  }

  const body = await c.req.json<{
    url?: string;
    siteName?: string;
    subdomain?: string;
  }>();

  const url = (body.url || '').trim();
  const siteName = (body.siteName || '').trim();
  const subdomain =
    (body.subdomain || '').trim().toLowerCase() ||
    siteName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63);

  if (!url) return c.json({ error: 'url is required' }, 400);
  if (!siteName) return c.json({ error: 'siteName is required' }, 400);
  if (siteName.length > 80)
    return c.json({ error: 'siteName must be 80 characters or fewer' }, 400);

  const parsedImportUrl = parseImportSourceUrl(url);
  if (!parsedImportUrl.ok) {
    return c.json({ error: parsedImportUrl.error }, 400);
  }

  const subdomainCheck = validateSubdomain(subdomain);
  if (!subdomainCheck.valid) {
    return c.json({ error: subdomainCheck.error }, 400);
  }

  const database = db(c.env);
  const customerRow = await database
    .select({ id: customer.id, plan: customer.plan })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerRecord = customerRow[0];
  if (!customerRecord) {
    return c.json({ error: 'no customer row for current user - visit /dashboard first' }, 409);
  }
  const customerId = customerRecord.id;
  const customerPlan = customerRecord.plan ?? 'free';
  const siteLimit = siteLimitForPlan(customerPlan);

  const existingSite = await database
    .select({ id: site.id })
    .from(site)
    .where(eq(site.subdomain, subdomain))
    .limit(1);
  if (existingSite[0]) {
    return c.json({ error: 'subdomain is already taken' }, 409);
  }

  if (siteLimit !== null) {
    const siteCountRows = await database
      .select({ value: count() })
      .from(site)
      .where(eq(site.customerId, customerId));
    const siteCount = siteCountRows[0]?.value ?? 0;
    if (siteCount >= siteLimit) {
      return c.json({ error: siteLimitError(customerPlan) }, 403);
    }
  }

  const scraperUrl = c.env.SCRAPER_URL;
  const scraperSecret = c.env.SCRAPER_API_SECRET;
  if (!scraperUrl || !scraperSecret) {
    return c.json({ error: 'Import service is not configured' }, 503);
  }

  let scraperData: ScraperResponse;
  try {
    const scraperResp = await fetch(`${scraperUrl}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${scraperSecret}`,
      },
      body: JSON.stringify({ url: parsedImportUrl.url }),
    });

    if (!scraperResp.ok) {
      const errBody = await scraperResp.json<{ error?: string }>().catch(() => null);
      const msg = (errBody && errBody.error) || `Scraper returned ${scraperResp.status}`;
      return c.json({ error: `Import failed: ${msg}` }, 502);
    }

    scraperData = await scraperResp.json<ScraperResponse>();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: `Failed to reach import service: ${msg}` }, 502);
  }

  if (!scraperData.sections || scraperData.sections.length === 0) {
    return c.json({ error: 'No content found on the target page' }, 422);
  }

  const newSiteId = crypto.randomUUID();
  const existingOwnerAssets = await database
    .select({ id: ownerAsset.id, contentHash: ownerAsset.contentHash })
    .from(ownerAsset)
    .where(eq(ownerAsset.customerId, customerId));
  const preparedAssets = await prepareImportedAssets({
    scraperAssets: scraperData.assets,
    customerId,
    siteId: newSiteId,
    existingOwnerAssets,
  });

  let editableState: EditableSite;
  try {
    editableState = buildEditableSite(
      scraperData,
      preparedAssets.mediaAssetIdMap,
      preparedAssets.fontFamilyTokenMap,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Import failed: ${message}` }, 502);
  }
  const validation = validateEditableSite(editableState);
  if (!validation.valid) {
    return c.json(
      { error: 'Import produced invalid editable state', errors: validation.errors },
      502,
    );
  }

  const r2Bucket = c.env.ASSETS_BUCKET;
  await Promise.all(
    preparedAssets.r2Uploads.map(({ key, data, contentType }) =>
      r2Bucket.put(key, data, { httpMetadata: { contentType } }),
    ),
  );

  try {
    const siteInsert = database.insert(site).values({
      id: newSiteId,
      customerId,
      name: siteName,
      subdomain,
      styleKit: editableState.styleKit,
      editableState,
      publishedSnapshot: null,
      publishedVersion: 0,
    });

    const mediaAssetRows = preparedAssets.mediaAssetRows;
    const fontRows = preparedAssets.fontRows;
    if (mediaAssetRows.length === 0 && fontRows.length === 0) {
      await siteInsert;
    } else if (mediaAssetRows.length > 0 && fontRows.length > 0) {
      const assetInsert = database.insert(ownerAsset).values(mediaAssetRows).onConflictDoNothing();
      const fontInsert = database.insert(siteFont).values(fontRows).onConflictDoNothing();
      await database.batch([siteInsert, assetInsert, fontInsert]);
    } else if (mediaAssetRows.length > 0) {
      const assetInsert = database.insert(ownerAsset).values(mediaAssetRows).onConflictDoNothing();
      await database.batch([siteInsert, assetInsert]);
    } else {
      const fontInsert = database.insert(siteFont).values(fontRows).onConflictDoNothing();
      await database.batch([siteInsert, fontInsert]);
    }
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'subdomain is already taken' }, 409);
    }
    if (isSiteLimitViolation(err)) {
      if (siteLimitForPlan(customerPlan) === null) {
        console.error('site_limit_drift', { plan: customerPlan, err });
        throw err;
      }
      return c.json({ error: siteLimitError(customerPlan) }, 403);
    }
    throw err;
  }

  return c.json(
    {
      siteId: newSiteId,
      warnings: scraperData.warnings,
    },
    201,
  );
});

/**
 * Validate the user-supplied source URL before handing it to the scraper.
 *
 * This is the first SSRF guardrail: reject credentials, non-http(s) schemes,
 * localhost, and literal private/reserved IP ranges in the URL itself. The
 * scraper also validates each browser request it makes, because redirects and
 * page subresources can point somewhere different from the top-level URL.
 */
function parseImportSourceUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'URL must use http or https protocol' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL must not include credentials' };
  }
  const blockedHost = blockedImportHost(parsed.hostname);
  if (blockedHost !== null) {
    return {
      ok: false,
      error: `URL resolves to blocked private/reserved address: ${blockedHost}`,
    };
  }
  return { ok: true, url: parsed.href };
}

function blockedImportHost(hostname: string): string | null {
  // Literal host checks only. Hostnames are left intact for the scraper's
  // request-time guard, where redirects and subresources are visible.
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return host;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  const octets = host.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.some((part) => part < 0 || part > 255)) return host;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return host;
  if (a === 169 && b === 254) return host;
  if (a === 172 && b >= 16 && b <= 31) return host;
  if (a === 192 && b === 168) return host;
  if (a === 100 && b >= 64 && b <= 127) return host;
  if (a === 192 && b === 0) return host;
  if (a === 198 && (b === 18 || b === 19)) return host;
  if (a === 198 && b === 51 && c === 100) return host;
  if (a === 203 && b === 0 && c === 113) return host;
  return null;
}

export async function prepareImportedAssets(input: {
  scraperAssets: ScraperAsset[];
  customerId: string;
  siteId: string;
  existingOwnerAssets: ExistingOwnerAssetRow[];
}): Promise<PreparedImportedAssets> {
  const mediaAssetIdMap = new Map<string, string>();
  const mediaAssetRows: Array<typeof ownerAsset.$inferInsert> = [];
  const fontRows: Array<typeof siteFont.$inferInsert> = [];
  const r2Uploads: Array<{ key: string; data: Uint8Array; contentType: string }> = [];
  const fontFamilyTokenMap = new Map<string, string>();
  const existingByHash = new Map(input.existingOwnerAssets.map((row) => [row.contentHash, row.id]));
  const newMediaByHash = new Map<string, string>();
  const fontByHash = new Map<string, string>();

  for (const asset of input.scraperAssets) {
    const kind = asset.kind ?? 'media';
    const bytes = decodeBase64(asset.data, asset.originalUrl);
    const hash = await sha256Hex(bytes);

    if (kind === 'font') {
      if (!isWoff2Asset(asset)) {
        throw new Error(`Imported font must be WOFF2: ${asset.originalUrl}`);
      }
      const existingFontToken = fontByHash.get(hash);
      if (existingFontToken) {
        if (asset.fontFamily) fontFamilyTokenMap.set(asset.fontFamily, existingFontToken);
        continue;
      }

      const token = `font:${hash}`;
      fontByHash.set(hash, token);
      if (asset.fontFamily) fontFamilyTokenMap.set(asset.fontFamily, token);
      fontRows.push({
        id: crypto.randomUUID(),
        siteId: input.siteId,
        name: asset.fontFamily?.trim() || filenameStem(asset.filename),
        family: classifyFontFamily(asset.fontFamily ?? asset.filename),
        weight: asset.fontWeight ?? 400,
        style: asset.fontStyle ?? 'normal',
        contentHash: hash,
        byteSize: bytes.byteLength,
      });
      r2Uploads.push({
        key: fontContentHashToR2Key(hash),
        data: bytes,
        contentType: 'font/woff2',
      });
      continue;
    }

    const existingId = existingByHash.get(hash);
    if (existingId) {
      mediaAssetIdMap.set(asset.originalUrl, existingId);
      continue;
    }

    const alreadyPreparedId = newMediaByHash.get(hash);
    if (alreadyPreparedId) {
      mediaAssetIdMap.set(asset.originalUrl, alreadyPreparedId);
      continue;
    }

    const ext = extFromMediaType(asset.contentType);
    const r2Key = contentHashToR2Key(hash, ext);
    const assetId = crypto.randomUUID();
    const mediaKind: MediaKind = asset.contentType.startsWith('video/') ? 'video' : 'image';

    mediaAssetIdMap.set(asset.originalUrl, assetId);
    newMediaByHash.set(hash, assetId);
    existingByHash.set(hash, assetId);
    mediaAssetRows.push({
      id: assetId,
      customerId: input.customerId,
      contentHash: hash,
      r2Key,
      mediaType: asset.contentType,
      kind: mediaKind,
      alt: '',
      width: null,
      height: null,
      byteSize: bytes.byteLength,
    });
    r2Uploads.push({ key: r2Key, data: bytes, contentType: asset.contentType });
  }

  return {
    mediaAssetIdMap,
    mediaAssetRows,
    fontRows,
    r2Uploads,
    fontFamilyTokenMap,
  };
}

export function buildEditableSite(
  data: ScraperResponse,
  assetIdMap: Map<string, string>,
  fontFamilyTokenMap: Map<string, string> = new Map(),
): EditableSite {
  const sections: CanvasSection[] = data.sections.map((s, i) => {
    const name = s.name || `section-${i}`;
    const nameLower = name.toLowerCase();
    const role: CanvasSection['role'] =
      i === 0 && nameLower.includes('header')
        ? 'header'
        : i === data.sections.length - 1 && nameLower.includes('footer')
          ? 'footer'
          : undefined;
    return {
      id: crypto.randomUUID(),
      recipeId: 'custom' as const,
      name,
      height: Math.max(Math.round(s.height), 100),
      ...(role ? { role } : {}),
      elements: s.elements.map((el) => convertElement(el, assetIdMap)),
    };
  });

  const page: CanvasPage = {
    id: crypto.randomUUID(),
    slug: 'index',
    title: 'Home',
    width: 1440,
    sections,
  };

  return {
    styleKit: 'custom',
    customStyleKit: buildCustomStyleKit(data, fontFamilyTokenMap),
    pages: [page],
  };
}

function buildCustomStyleKit(data: ScraperResponse, fontFamilyTokenMap: Map<string, string>) {
  const { colors, fonts } = data;
  return {
    bg: colors.bg,
    panel: colors.bg,
    text: colors.text,
    muted: colors.muted,
    accent: colors.seed,
    accentText: colors.bg,
    fontFamilyDisplay: resolveImportedFontToken(fonts.display, fontFamilyTokenMap),
    fontFamilyBody: resolveImportedFontToken(fonts.body, fontFamilyTokenMap),
    fontFamilyMono: resolveImportedFontToken(fonts.mono, fontFamilyTokenMap),
    headingScale: 1.0,
    bodyScale: 1.0,
    labelScale: 0.85,
    lineHeight: 1.5,
    radius: '8px',
    borderWidth: '1px',
    shadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
    surfaceVariants: {
      flat: { background: colors.bg, shadow: 'none' },
      raised: { background: colors.bg, shadow: '0 10px 28px rgba(0, 0, 0, 0.45)' },
      glass: {
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.10)',
        shadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
      },
      outlined: { background: 'transparent', border: `1px solid ${colors.muted}` },
      sticker: {
        background: colors.bg,
        border: `1px solid ${colors.muted}`,
        shadow: '0 2px 0 rgba(0,0,0,0.3), 0 8px 20px rgba(0, 0, 0, 0.4)',
        radius: '14px',
      },
      'editorial-frame': {
        background: 'transparent',
        border: `2px solid ${colors.seed}`,
        radius: '0px',
      },
      'soft-panel': { background: colors.bg, shadow: '0 1px 0 rgba(255,255,255,0.04) inset' },
    },
    shapeFill: colors.seed,
    shapeStroke: colors.muted,
    shapeStrokeWidth: '1px',
    actionRadius: '8px',
    actionPadding: '10px 18px',
    actionVariants: {
      solid: { background: colors.seed, color: colors.bg, weight: 600 },
      outline: {
        background: 'transparent',
        color: colors.text,
        border: `1px solid ${colors.seed}`,
      },
      ghost: { background: 'transparent', color: colors.text },
      pill: { background: colors.seed, color: colors.bg, weight: 600 },
      glass: {
        background: 'rgba(255, 255, 255, 0.08)',
        color: colors.text,
        border: '1px solid rgba(255, 255, 255, 0.16)',
      },
      brutalist: {
        background: colors.bg,
        color: colors.text,
        border: `2px solid ${colors.text}`,
        weight: 700,
      },
      underline: { background: 'transparent', color: colors.seed },
    },
    motionDurationMs: 360,
    motionEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    motionPresets: {
      none: {},
      'fade-up': { transform: 'translateY(14px)', opacity: 0 },
      'fade-down': { transform: 'translateY(-14px)', opacity: 0 },
      'fade-in': { opacity: 0 },
      'fade-right': { transform: 'translateX(-14px)', opacity: 0 },
      'slide-left': { transform: 'translateX(22px)', opacity: 0 },
      'slide-up': { transform: 'translateY(22px)' },
      'slide-right': { transform: 'translateX(-22px)' },
      'scale-in': { transform: 'scale(0.97)', opacity: 0 },
      'zoom-out': { transform: 'scale(1.06)', opacity: 0 },
      'blur-in': { opacity: 0 },
      'rotate-in': { transform: 'rotate(-5deg) scale(0.96)', opacity: 0 },
      'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
      'bounce-in': { transform: 'scale(0.65)', opacity: 0 },
      'stagger-children': { transform: 'translateY(10px)', opacity: 0, delayMs: 70 },
      'slow-drift': { transform: 'translateY(0px)' },
      'parallax-soft': { transform: 'translateY(8px)' },
    },
  };
}

function decodeBase64(data: string, label: string): Uint8Array {
  try {
    return Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid base64 asset payload for ${label}: ${message}`);
  }
}

function isWoff2Asset(asset: ScraperAsset): boolean {
  const contentType = asset.contentType.split(';')[0]?.trim().toLowerCase();
  return contentType === 'font/woff2' || asset.filename.toLowerCase().endsWith('.woff2');
}

function filenameStem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || 'Imported Font';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function classifyFontFamily(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('mono') || lower.includes('code')) return 'mono';
  if (lower.includes('serif') && !lower.includes('sans')) return 'serif';
  return 'sans-serif';
}

function resolveImportedFontToken(value: string, fontFamilyTokenMap: Map<string, string>): string {
  const primary = primaryFontFamily(value);
  if (!primary) return value;
  return fontFamilyTokenMap.get(primary) ?? value;
}

function primaryFontFamily(value: string): string | null {
  const first = value.split(',')[0]?.trim();
  if (!first) return null;
  return first.replace(/^['"]|['"]$/g, '');
}

/**
 * Convert one scraper node into the Canvas document model.
 *
 * The importer is fail-loud: unsupported element kinds or missing media assets
 * throw instead of dropping content. Silent skips make imported pages look
 * "successful" while losing user-visible material.
 */
function convertElement(el: ScraperElement, assetIdMap: Map<string, string>): CanvasElement {
  const baseId = crypto.randomUUID();
  const box = {
    x: Math.max(0, Math.round(el.box.x)),
    y: Math.max(0, Math.round(el.box.y)),
    w: Math.max(10, Math.round(el.box.w)),
    h: Math.max(10, Math.round(el.box.h)),
    z: el.box.z || 1,
    ...(el.rotation ? { rotation: el.rotation } : {}),
  };

  const motion =
    el.motion && isValidMotionPreset(el.motion.preset)
      ? { preset: el.motion.preset, ...(el.motion.delayMs ? { delayMs: el.motion.delayMs } : {}) }
      : undefined;

  const data = el.data;

  switch (el.type) {
    case 'text': {
      const d = data as {
        role?: string;
        runs?: { text: string; marks?: { type: string; href?: string }[] }[];
        fontSize?: number;
        textAlign?: string;
        color?: string;
      };
      const role = mapTextRole(d.role);
      const fontSize = d.fontSize || 16;
      const content: InlineRun[] = (d.runs || []).map((r) => ({
        text: r.text,
        ...(r.marks?.length
          ? {
              marks: r.marks.map((m) =>
                m.href
                  ? { type: 'link' as const, href: m.href }
                  : {
                      type: m.type as
                        | 'bold'
                        | 'italic'
                        | 'underline'
                        | 'strike'
                        | 'code'
                        | 'highlight',
                    },
              ),
            }
          : {}),
      }));
      if (content.length === 0) {
        throw new Error(
          `scraped text element has no text content at x=${String(box.x)} y=${String(box.y)}`,
        );
      }
      const result: TextElement = {
        id: baseId,
        type: 'text',
        box,
        content,
        role,
        fontSize,
        fontWeight: role === 'heading' ? 700 : 400,
        align: (d.textAlign as 'left' | 'center' | 'right') || 'left',
        ...(motion ? { motion } : {}),
        ...(d.color ? { pinnedStyle: { color: d.color } } : {}),
      };
      return result;
    }

    case 'media': {
      const d = data as { src?: string; originalUrl?: string; alt?: string; mediaType?: string };
      const source = d.src || d.originalUrl || '';
      const assetId = assetIdMap.get(source);
      if (!assetId) {
        throw new Error(`missing imported media asset for ${source || '<empty media source>'}`);
      }
      const kind: MediaKind = d.mediaType === 'video' ? 'video' : 'image';
      const result: MediaElement = {
        id: baseId,
        type: 'media',
        box,
        mediaKind: kind,
        assetId,
        alt: d.alt || '',
        fit: 'cover',
        ...(motion ? { motion } : {}),
      };
      return result;
    }

    case 'action': {
      const d = data as { label?: string; href?: string; variant?: string };
      const variant = isValidActionVariant(d.variant) ? d.variant : 'solid';
      const result: ActionElement = {
        id: baseId,
        type: 'action',
        box,
        label: [{ text: d.label || 'Click' }],
        href: { type: 'external', url: d.href || '#' },
        variant,
        ...(motion ? { motion } : {}),
      };
      return result;
    }

    case 'shape': {
      const d = data as { variant?: string; fill?: string; stroke?: string };
      const variant = isValidShapeVariant(d.variant) ? d.variant : 'rect';
      const result: ShapeElement = {
        id: baseId,
        type: 'shape',
        box,
        variant,
        ...(motion ? { motion } : {}),
        ...(d.fill ? { pinnedStyle: { background: d.fill } } : {}),
      };
      return result;
    }

    case 'container': {
      const d = data as { variant?: string; backgroundColor?: string };
      const variant = isValidSurfaceVariant(d.variant) ? d.variant : 'flat';
      const result: ContainerElement = {
        id: baseId,
        type: 'container',
        box,
        variant,
        ...(motion ? { motion } : {}),
        ...(d.backgroundColor ? { pinnedStyle: { background: d.backgroundColor } } : {}),
      };
      return result;
    }

    default:
      throw new Error(`unsupported scraped element type: ${el.type}`);
  }
}

function mapTextRole(role?: string): 'heading' | 'body' | 'label' {
  if (!role) return 'body';
  if (role.startsWith('h')) return 'heading';
  if (role === 'label' || role === 'caption') return 'label';
  return 'body';
}

const ACTION_VARIANT_SET = new Set<string>([
  'solid',
  'outline',
  'ghost',
  'pill',
  'glass',
  'brutalist',
  'underline',
]);
function isValidActionVariant(v?: string): v is ActionVariant {
  return !!v && ACTION_VARIANT_SET.has(v);
}

const SHAPE_VARIANT_SET = new Set<string>(['rect', 'pill', 'circle', 'line', 'badge', 'blob']);
function isValidShapeVariant(v?: string): v is ShapeVariant {
  return !!v && SHAPE_VARIANT_SET.has(v);
}

const SURFACE_VARIANT_SET = new Set<string>([
  'flat',
  'raised',
  'glass',
  'outlined',
  'sticker',
  'editorial-frame',
  'soft-panel',
]);
function isValidSurfaceVariant(v?: string): v is SurfaceVariant {
  return !!v && SURFACE_VARIANT_SET.has(v);
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === '23505') return true;
  if (typeof e.message === 'string' && e.message.includes('duplicate key value')) return true;
  if (e.cause) return isUniqueViolation(e.cause);
  return false;
}
