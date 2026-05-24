import interRegularBytes from './Inter-Regular.ttf';
import interBoldBytes from './Inter-Bold.ttf';

export interface OgFontBytes {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

let cached: OgFontBytes | null = null;

export async function loadOgFonts(): Promise<OgFontBytes> {
  if (cached !== null) return cached;
  cached = await Promise.resolve({
    regular: interRegularBytes,
    bold: interBoldBytes,
  });
  return cached;
}
