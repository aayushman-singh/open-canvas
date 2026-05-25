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
  const { refs: inlineRefs, crossOriginHrefs } = await page.evaluate(() => {
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
    const crossOriginHrefs: string[] = [];

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        if (sheet.href) crossOriginHrefs.push(sheet.href);
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

    return { refs, crossOriginHrefs };
  });

  const crossOriginRefs = await fetchCrossOriginFontRefs(crossOriginHrefs);
  return [...inlineRefs, ...crossOriginRefs];
}

async function fetchCrossOriginFontRefs(hrefs: string[]): Promise<FontAssetReference[]> {
  const refs: FontAssetReference[] = [];
  const seen = new Set<string>();

  for (const href of hrefs) {
    if (!href.startsWith('https://')) continue;
    let css: string;
    try {
      const resp = await fetch(href, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!resp.ok) continue;
      css = await resp.text();
    } catch {
      continue;
    }

    const fontFaceRe =
      /@font-face\s*\{([^}]+)\}/g;
    let block: RegExpExecArray | null;
    while ((block = fontFaceRe.exec(css)) !== null) {
      const body = block[1]!;
      const familyMatch = body.match(/font-family:\s*['"]?([^;'"]+)['"]?\s*;/);
      const srcMatch = body.match(/src:\s*([^;]+);/);
      if (!familyMatch?.[1] || !srcMatch?.[1]) continue;

      const family = familyMatch[1].trim().replace(/^['"]|['"]$/g, '');
      const src = srcMatch[1];

      if (!src.toLowerCase().includes('woff2')) continue;

      const weightMatch = body.match(/font-weight:\s*(\d+)/);
      const styleMatch = body.match(/font-style:\s*(normal|italic)/);
      const fontWeight = weightMatch ? parseInt(weightMatch[1]!, 10) : undefined;
      const fontStyle = styleMatch
        ? (styleMatch[1] as 'normal' | 'italic')
        : undefined;

      const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
      let urlMatch: RegExpExecArray | null;
      while ((urlMatch = urlRe.exec(src)) !== null) {
        const raw = urlMatch[1];
        if (!raw || !raw.toLowerCase().includes('woff2')) continue;
        let resolved: string;
        try {
          resolved = new URL(raw, href).href;
        } catch {
          continue;
        }
        const key = `${family}\n${resolved}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({
          url: resolved,
          fontFamily: family,
          ...(fontWeight !== undefined ? { fontWeight } : {}),
          ...(fontStyle !== undefined ? { fontStyle } : {}),
        });
      }
    }
  }

  return refs;
}

function wrapFontFamily(font: string): string {
  if (font.includes(',')) return font;
  const systemFonts = ['system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace'];
  if (systemFonts.includes(font.toLowerCase())) return font;
  return `'${font}', system-ui, sans-serif`;
}

function parseRgba(str: string): RGBColor | null {
  const oklchResult = parseOklch(str);
  if (oklchResult) return oklchResult;

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

function parseOklch(str: string): RGBColor | null {
  const match = str.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/,
  );
  if (!match) return null;
  const l = parseFloat(match[1]!);
  const c = parseFloat(match[2]!);
  const h = parseFloat(match[3]!);
  if (!isFinite(l) || !isFinite(c) || !isFinite(h)) return null;

  if (match[4] !== undefined) {
    const a = parseFloat(match[4]);
    if (isFinite(a) && a < 0.1) return null;
  }

  const rgb = oklchToSrgb(l, c, h);
  return {
    r: Math.round(rgb.r * 255),
    g: Math.round(rgb.g * 255),
    b: Math.round(rgb.b * 255),
  };
}

function oklchToSrgb(
  l: number,
  c: number,
  h: number,
): { r: number; g: number; b: number } {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = l_ * l_ * l_;
  const mm = m_ * m_ * m_;
  const ss = s_ * s_ * s_;

  const lr = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss;
  const lg = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss;
  const lb = -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss;

  return {
    r: clamp01(linearToSrgb(lr)),
    g: clamp01(linearToSrgb(lg)),
    b: clamp01(linearToSrgb(lb)),
  };
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
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
