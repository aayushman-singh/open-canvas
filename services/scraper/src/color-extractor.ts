import type { Page } from 'puppeteer';
import type { ExtractedColors, ExtractedFonts, FontAssetReference } from './types.js';

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export async function extractColors(page: Page): Promise<ExtractedColors> {
  const rawColors: string[] = await page.evaluate(() => {
    const colors: string[] = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const cs = window.getComputedStyle(el);
      colors.push(cs.color);
      colors.push(cs.backgroundColor);
      colors.push(cs.borderColor);
    }
    return colors;
  });

  const parsed = rawColors.map(parseRgba).filter((c): c is RGBColor => c !== null);

  const nonNeutral = parsed.filter((c) => !isNearWhite(c) && !isNearBlack(c) && !isNearGray(c));

  const bgColors = parsed.filter(isNearWhite);
  const textColors = parsed.filter(isNearBlack);
  const mutedColors = parsed.filter(isNearGray);

  let seed = '#5b8def';
  if (nonNeutral.length > 0) {
    const clusters = clusterByHue(nonNeutral);
    const largest = clusters.sort((a, b) => b.length - a.length)[0];
    if (largest && largest.length > 0) {
      seed = rgbToHex(centroid(largest));
    }
  }

  const bg = bgColors.length > 0 ? rgbToHex(mode(bgColors)) : '#ffffff';
  const text = textColors.length > 0 ? rgbToHex(mode(textColors)) : '#111111';
  const muted = mutedColors.length > 0 ? rgbToHex(mode(mutedColors)) : '#888888';

  return { seed, bg, text, muted };
}

export async function extractFonts(page: Page): Promise<ExtractedFonts> {
  const rawFonts = await page.evaluate(() => {
    const headingFonts: string[] = [];
    const bodyFonts: string[] = [];
    const monoFonts: string[] = [];
    const headingTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const monoIndicators = ['mono', 'courier', 'consolas', 'menlo', 'sfmono'];

    const all = document.querySelectorAll('*');
    for (const el of all) {
      const cs = window.getComputedStyle(el);
      const family = cs.fontFamily;
      if (!family) continue;

      const first = family.split(',')[0]!.trim().replace(/['"]/g, '');
      const lower = first.toLowerCase();

      if (monoIndicators.some((m) => lower.includes(m))) {
        monoFonts.push(first);
      } else if (headingTags.has(el.tagName)) {
        headingFonts.push(first);
      } else {
        bodyFonts.push(first);
      }
    }

    return { headingFonts, bodyFonts, monoFonts };
  });

  const display = modeString(rawFonts.headingFonts) || 'Inter';
  const body = modeString(rawFonts.bodyFonts) || 'Inter';
  const mono = modeString(rawFonts.monoFonts) || 'JetBrains Mono';

  return {
    display: wrapFontFamily(display),
    body: wrapFontFamily(body),
    mono: wrapFontFamily(mono),
  };
}

export async function extractFontAssetReferences(page: Page): Promise<FontAssetReference[]> {
  return page.evaluate(() => {
    function cleanFamily(value: string): string {
      return value.trim().replace(/^['"]|['"]$/g, '');
    }

    function parseWeight(value: string): number | undefined {
      const first = value.trim().split(/\s+/)[0];
      if (!first) return undefined;
      if (first === 'normal') return 400;
      if (first === 'bold') return 700;
      const parsed = Number.parseInt(first, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    function parseStyle(value: string): 'normal' | 'italic' | undefined {
      const trimmed = value.trim().toLowerCase();
      if (trimmed === 'normal' || trimmed === 'italic') return trimmed;
      return undefined;
    }

    function extractWoff2Urls(src: string): string[] {
      if (!src.toLowerCase().includes('woff2')) return [];
      const urls: string[] = [];
      const re = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(src)) !== null) {
        const raw = match[1];
        if (!raw) continue;
        if (!raw.toLowerCase().includes('woff2')) continue;
        urls.push(new URL(raw, document.baseURI).href);
      }
      return urls;
    }

    const refs: FontAssetReference[] = [];
    const seen = new Set<string>();

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }

      for (const rule of Array.from(rules)) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        const fontRule = rule as CSSFontFaceRule;
        const src = fontRule.style.getPropertyValue('src');
        const family = cleanFamily(fontRule.style.getPropertyValue('font-family'));
        if (!src || !family) continue;

        const fontWeight = parseWeight(fontRule.style.getPropertyValue('font-weight'));
        const fontStyle = parseStyle(fontRule.style.getPropertyValue('font-style'));
        for (const url of extractWoff2Urls(src)) {
          const key = `${family}\n${url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          refs.push({
            url,
            fontFamily: family,
            ...(fontWeight !== undefined ? { fontWeight } : {}),
            ...(fontStyle !== undefined ? { fontStyle } : {}),
          });
        }
      }
    }

    return refs;
  });
}

function wrapFontFamily(font: string): string {
  if (font.includes(',')) return font;
  const systemFonts = ['system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace'];
  if (systemFonts.includes(font.toLowerCase())) return font;
  return `'${font}', system-ui, sans-serif`;
}

function parseRgba(str: string): RGBColor | null {
  const rgbaMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+)?\s*\)/);
  if (!rgbaMatch) return null;
  const r = parseInt(rgbaMatch[1]!, 10);
  const g = parseInt(rgbaMatch[2]!, 10);
  const b = parseInt(rgbaMatch[3]!, 10);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

  const alphaMatch = str.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
  if (alphaMatch) {
    const alpha = parseFloat(alphaMatch[1]!);
    if (alpha < 0.1) return null;
  }

  return { r, g, b };
}

function isNearWhite(c: RGBColor): boolean {
  return c.r > 230 && c.g > 230 && c.b > 230;
}

function isNearBlack(c: RGBColor): boolean {
  return c.r < 40 && c.g < 40 && c.b < 40;
}

function isNearGray(c: RGBColor): boolean {
  const diff = Math.max(Math.abs(c.r - c.g), Math.abs(c.g - c.b), Math.abs(c.r - c.b));
  return diff < 20;
}

function rgbToHue(c: RGBColor): number {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  return hue;
}

function clusterByHue(colors: RGBColor[]): RGBColor[][] {
  const HUE_THRESHOLD = 30;
  const clusters: RGBColor[][] = [];

  for (const color of colors) {
    const hue = rgbToHue(color);
    let placed = false;

    for (const cluster of clusters) {
      const clusterHue = rgbToHue(cluster[0]!);
      const diff = Math.abs(hue - clusterHue);
      if (diff < HUE_THRESHOLD || diff > 360 - HUE_THRESHOLD) {
        cluster.push(color);
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push([color]);
    }
  }

  return clusters;
}

function centroid(colors: RGBColor[]): RGBColor {
  let r = 0,
    g = 0,
    b = 0;
  for (const c of colors) {
    r += c.r;
    g += c.g;
    b += c.b;
  }
  const n = colors.length;
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
}

function mode(colors: RGBColor[]): RGBColor {
  const counts = new Map<string, { color: RGBColor; count: number }>();
  for (const c of colors) {
    const key = `${c.r},${c.g},${c.b}`;
    const entry = counts.get(key);
    if (entry) {
      entry.count++;
    } else {
      counts.set(key, { color: c, count: 1 });
    }
  }
  let best: { color: RGBColor; count: number } = { color: colors[0]!, count: 0 };
  for (const entry of counts.values()) {
    if (entry.count > best.count) best = entry;
  }
  return best.color;
}

function modeString(strs: string[]): string | undefined {
  if (strs.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const s of strs) {
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = strs[0]!;
  let bestCount = 0;
  for (const [s, count] of counts) {
    if (count > bestCount) {
      best = s;
      bestCount = count;
    }
  }
  return best;
}

function rgbToHex(c: RGBColor): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}
