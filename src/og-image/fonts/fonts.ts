import interRegularBytes from './Inter-Regular.ttf';
import interBoldBytes from './Inter-Bold.ttf';

export interface OgFontBytes {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

let cached: OgFontBytes | null = null;

type BunFileReader = {
  file(path: string): { arrayBuffer(): Promise<ArrayBuffer> };
};

function getBunFileReader(): BunFileReader | null {
  const runtime = globalThis as typeof globalThis & { Bun?: BunFileReader };
  return runtime.Bun ?? null;
}

async function resolveFontAsset(
  asset: ArrayBuffer | Uint8Array | string,
  label: string,
): Promise<ArrayBuffer> {
  if (asset instanceof ArrayBuffer) return asset;
  if (asset instanceof Uint8Array) {
    const copy = new Uint8Array(asset.byteLength);
    copy.set(asset);
    return copy.buffer;
  }
  if (typeof asset === 'string') {
    const bun = getBunFileReader();
    if (bun === null) {
      throw new Error(`${label} font asset resolved to a path outside Bun: ${asset}`);
    }
    return bun.file(asset).arrayBuffer();
  }
  throw new Error(
    `${label} font asset has unsupported shape: ${Object.prototype.toString.call(asset)}`,
  );
}

export async function loadOgFonts(): Promise<OgFontBytes> {
  if (cached !== null) return cached;
  cached = await Promise.resolve({
    regular: await resolveFontAsset(interRegularBytes, 'Inter Regular'),
    bold: await resolveFontAsset(interBoldBytes, 'Inter Bold'),
  });
  return cached;
}
