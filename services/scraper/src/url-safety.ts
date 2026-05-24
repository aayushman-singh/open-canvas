import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export function parseHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('URL must use http or https protocol');
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('URL must not include credentials');
  }

  return parsed;
}

export function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeIpLiteral(address);
  const kind = isIP(normalized);
  if (kind === 4) return isBlockedIpv4(normalized);
  if (kind === 6) return isBlockedIpv6(normalized);
  return false;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const parsed = parseHttpUrl(raw);
  const hostname = normalizeHostname(parsed.hostname);

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError(`URL resolves to blocked private/reserved address: ${hostname}`);
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedIpAddress(hostname)) {
      throw new UnsafeUrlError(`URL resolves to blocked private/reserved address: ${hostname}`);
    }
    return parsed;
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new UnsafeUrlError(`URL hostname did not resolve: ${hostname}`);
  }

  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new UnsafeUrlError(
        `URL resolves to blocked private/reserved address: ${record.address}`,
      );
    }
  }

  return parsed;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function normalizeIpLiteral(address: string): string {
  return normalizeHostname(address).split('%')[0] ?? '';
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && octets[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (a >= 224) return true;

  return false;
}

function isBlockedIpv6(address: string): boolean {
  const lower = normalizeIpLiteral(address);
  if (lower === '::' || lower === '::1') return true;

  const ipv4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped?.[1]) return isBlockedIpv4(ipv4Mapped[1]);

  const firstHextetRaw = lower.split(':')[0];
  const firstHextet = Number.parseInt(firstHextetRaw || '0', 16);
  if (!Number.isFinite(firstHextet)) return true;

  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  if ((firstHextet & 0xff00) === 0xff00) return true;
  if (lower.startsWith('2001:db8:') || lower === '2001:db8::') return true;

  return false;
}
