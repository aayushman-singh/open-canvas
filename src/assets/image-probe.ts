// src/assets/image-probe.ts
//
// Minimal magic-byte sniffer for PNG / JPEG / GIF / WebP dimensions. The
// upload route fills `ownerAsset.width` / `ownerAsset.height` from this so
// the editor's slot fitter and the published-snapshot rendering pipeline
// can reason about aspect ratios without re-fetching the bytes.
//
// Failure mode: an unrecognised payload returns `{ width: null, height: null }`
// — the upload proceeds with nulls in the DB. Video uploads also flow through
// here and intentionally return null; cf.image does not transform video.
// This is NOT a fallback: nulls are the explicit "we do not know" sentinel,
// the row still inserts cleanly, and the renderer treats nulls as "honour
// the slot box wholesale" which is the desired behaviour.

interface Dimensions {
  width: number | null;
  height: number | null;
}

/**
 * Sniff width/height from a known image magic byte sequence. Returns nulls
 * for anything the sniffer does not recognise — including every video MIME
 * type. The caller does not have to special-case kind; passing video bytes
 * here is intentional and yields nulls.
 */
export function probeImageDimensions(bytes: Uint8Array): Dimensions {
  if (bytes.length < 24) return { width: null, height: null };
  // PNG: 89 50 4E 47 0D 0A 1A 0A then IHDR at offset 16..24 (width, height).
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return {
      width: readU32BE(bytes, 16),
      height: readU32BE(bytes, 20),
    };
  }
  // GIF: 'GIF87a' or 'GIF89a' then little-endian width @6, height @8.
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return {
      width: readU16LE(bytes, 6),
      height: readU16LE(bytes, 8),
    };
  }
  // WebP: 'RIFF' .. 'WEBP' header. Two common chunks:
  //   - 'VP8 ' (lossy)   — width/height at offset 26 and 28 (little-endian, low 14 bits)
  //   - 'VP8L' (lossless) — width-1/height-1 packed at offset 21..24
  //   - 'VP8X' (extended) — width-1/height-1 at offset 24..30 (24-bit LE)
  // Cover the common path (lossy + lossless); skip the extended chunk for now.
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    // Chunk type at offset 12..16.
    const chunk = String.fromCharCode(
      bytes[12] ?? 0,
      bytes[13] ?? 0,
      bytes[14] ?? 0,
      bytes[15] ?? 0,
    );
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      // width @ 26 (16-bit LE, top 2 bits reserved), height @ 28
      return {
        width: readU16LE(bytes, 26) & 0x3fff,
        height: readU16LE(bytes, 28) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      // First byte at 20 is 0x2f signature, then 4 bytes packed:
      //   width-1: 14 bits, height-1: 14 bits, alpha:1, version:3
      const b0 = bytes[21] ?? 0;
      const b1 = bytes[22] ?? 0;
      const b2 = bytes[23] ?? 0;
      const b3 = bytes[24] ?? 0;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (chunk === 'VP8X' && bytes.length >= 30) {
      // Canvas dimensions are 1 + 24-bit LE values at 24 and 27.
      const width = 1 + (readU24LE(bytes, 24) & 0xffffff);
      const height = 1 + (readU24LE(bytes, 27) & 0xffffff);
      return { width, height };
    }
  }
  // JPEG: search SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15 markers.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1] ?? 0;
      // SOF marker set the JPEG spec defines as "start of frame, non-differential
      // Huffman / arithmetic": 0xC0-0xC3, 0xC5-0xC7, 0xC9-0xCB, 0xCD-0xCF.
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        // SOF payload: [marker:2][len:2][precision:1][height:2][width:2][...].
        const height = readU16BE(bytes, i + 5);
        const width = readU16BE(bytes, i + 7);
        return { width, height };
      }
      // Skip this segment: marker (2) + segment length (2, big-endian).
      const segmentLength = readU16BE(bytes, i + 2);
      if (segmentLength < 2) break;
      i += 2 + segmentLength;
    }
  }
  return { width: null, height: null };
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
  );
}
