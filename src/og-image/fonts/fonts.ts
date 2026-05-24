// @ts-expect-error Wrangler bundles .ttf as ArrayBuffer via [[rules]] type=Data
import interRegularBytes from './Inter-Regular.ttf';
// @ts-expect-error Wrangler bundles .ttf as ArrayBuffer via [[rules]] type=Data
import interBoldBytes from './Inter-Bold.ttf';

export interface OgFontBytes {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

let cached: OgFontBytes | null = null;

export async function loadOgFonts(): Promise<OgFontBytes> {
  if (cached !== null) return cached;
  cached = {
    regular: interRegularBytes as unknown as ArrayBuffer,
    bold: interBoldBytes as unknown as ArrayBuffer,
  };
  return cached;
}
