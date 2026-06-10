// scripts/r2-clone.ts
//
// One-shot operator script: clone every object from one R2 bucket to
// another using R2's S3-compatible API + server-side CopyObject. No
// download/re-upload — the bytes never leave Cloudflare.
//
// Implements step 2 of the ADR 0049 cutover playbook (replacing the
// `rclone sync` line; rclone wasn't available in this environment).
//
// USAGE
//   export R2_ACCOUNT_ID=<from Cloudflare dashboard>
//   export R2_ACCESS_KEY_ID=<R2 API token, read on src, read/write on dest>
//   export R2_SECRET_ACCESS_KEY=<...>
//   bun run scripts/r2-clone.ts <source-bucket> <dest-bucket>
//   bun run scripts/r2-clone.ts <source-bucket> <dest-bucket> --count-only
//   bun run scripts/r2-clone.ts <source-bucket> <dest-bucket> --dry-run
//
// FLAGS
//   --count-only  List + count both buckets; print byte-count diff. No copy.
//   --dry-run     List source; report which keys WOULD be copied (skip-if-
//                 exists semantics still apply). No writes.
//
// SEMANTICS
//   * Lists source bucket with ListObjectsV2 (paginated, 1000 keys/page).
//   * For each key: HeadObject on dest. If 200, skip. If 404, CopyObject
//     server-side. Any other status fails loudly.
//   * Concurrency: 8 in-flight HEAD/COPY pairs (R2 handles this easily).
//   * Progress: one line per 100 keys + per-page totals.
//   * Exit code reflects success — non-zero on any failure.
//   * Re-runnable: the skip-if-exists check makes this a safe `delta` pass.
//     The ADR 0049 step-7 delta-sync just re-runs this script with the same
//     args.

import { AwsClient } from 'aws4fetch';

interface CliArgs {
  source: string;
  dest: string;
  countOnly: boolean;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length !== 2) {
    console.error(
      'Usage: bun run scripts/r2-clone.ts <source-bucket> <dest-bucket> [--count-only] [--dry-run]',
    );
    process.exit(2);
  }
  return {
    source: positional[0]!,
    dest: positional[1]!,
    countOnly: flags.has('--count-only'),
    dryRun: flags.has('--dry-run'),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `[r2-clone] missing env var ${name} — see comment at top of scripts/r2-clone.ts for the three required keys`,
    );
    process.exit(2);
  }
  return value;
}

interface R2Object {
  Key: string;
  Size: number;
  ETag: string;
}

interface ListPage {
  contents: R2Object[];
  nextToken: string | null;
}

async function listPage(
  client: AwsClient,
  endpoint: string,
  bucket: string,
  continuationToken: string | null,
): Promise<ListPage> {
  const params = new URLSearchParams({
    'list-type': '2',
    'max-keys': '1000',
  });
  if (continuationToken) params.set('continuation-token', continuationToken);
  const url = `${endpoint}/${bucket}?${params.toString()}`;
  const response = await client.fetch(url);
  if (!response.ok) {
    throw new Error(
      `[r2-clone] ListObjectsV2 ${bucket} failed: ${response.status} ${response.statusText}`,
    );
  }
  const xml = await response.text();
  return parseListXml(xml);
}

// R2 returns S3-compatible XML. Hand-parse — no XML dep needed; the
// shape is tightly constrained (no nested CDATA, no namespaces beyond
// the S3 default). Each `<Contents>` block has `<Key>`, `<Size>`, `<ETag>`.
function parseListXml(xml: string): ListPage {
  const contents: R2Object[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contentsRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const key = extractTag(block, 'Key');
    const size = extractTag(block, 'Size');
    const etag = extractTag(block, 'ETag');
    if (key === null || size === null) continue;
    contents.push({
      Key: decodeXmlEntities(key),
      Size: parseInt(size, 10),
      ETag: etag ?? '',
    });
  }
  const truncated = extractTag(xml, 'IsTruncated') === 'true';
  const nextToken = truncated ? extractTag(xml, 'NextContinuationToken') : null;
  return { contents, nextToken };
}

function extractTag(block: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = block.indexOf(open);
  if (start < 0) return null;
  const end = block.indexOf(close, start + open.length);
  if (end < 0) return null;
  return block.slice(start + open.length, end);
}

function decodeXmlEntities(s: string): string {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

async function listAll(
  client: AwsClient,
  endpoint: string,
  bucket: string,
): Promise<R2Object[]> {
  const all: R2Object[] = [];
  let token: string | null = null;
  let pageIndex = 0;
  do {
    const page = await listPage(client, endpoint, bucket, token);
    all.push(...page.contents);
    token = page.nextToken;
    pageIndex += 1;
    if (pageIndex % 10 === 0 || token === null) {
      console.log(
        `[r2-clone] listed ${all.length} keys from ${bucket} (page ${pageIndex})`,
      );
    }
  } while (token !== null);
  return all;
}

async function exists(
  client: AwsClient,
  endpoint: string,
  bucket: string,
  key: string,
): Promise<boolean> {
  const url = `${endpoint}/${bucket}/${encodeS3Key(key)}`;
  const response = await client.fetch(url, { method: 'HEAD' });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(
    `[r2-clone] HeadObject ${bucket}/${key} unexpected status ${response.status} ${response.statusText}`,
  );
}

async function copyObject(
  client: AwsClient,
  endpoint: string,
  sourceBucket: string,
  destBucket: string,
  key: string,
): Promise<void> {
  const url = `${endpoint}/${destBucket}/${encodeS3Key(key)}`;
  // CopySource format: `/<source-bucket>/<source-key>`. Both bucket and
  // key segments must be URI-encoded per S3 spec (R2 follows the same).
  const copySource = `/${sourceBucket}/${encodeS3Key(key)}`;
  const response = await client.fetch(url, {
    method: 'PUT',
    headers: {
      'x-amz-copy-source': copySource,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[r2-clone] CopyObject ${sourceBucket}/${key} → ${destBucket}/${key} failed: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`,
    );
  }
}

// S3 keys can contain `/` and most printable ASCII. The S3 spec says
// each path segment is URI-encoded EXCEPT `/` (which delimits prefixes).
function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function processConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const errors: { index: number; error: unknown }[] = [];
  async function run(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      try {
        await worker(items[i]!, i);
      } catch (err: unknown) {
        errors.push({ index: i, error: err });
      }
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  if (errors.length > 0) {
    console.error(`[r2-clone] ${errors.length} failures:`);
    for (const e of errors.slice(0, 10)) {
      const msg = e.error instanceof Error ? e.error.message : String(e.error);
      console.error(`  #${e.index}: ${msg}`);
    }
    if (errors.length > 10) {
      console.error(`  …and ${errors.length - 10} more`);
    }
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const sourceObjects = await listAll(client, endpoint, args.source);
  const sourceBytes = sourceObjects.reduce((sum, o) => sum + o.Size, 0);
  console.log(
    `[r2-clone] source ${args.source}: ${sourceObjects.length} objects, ${humanBytes(sourceBytes)}`,
  );

  if (args.countOnly) {
    const destObjects = await listAll(client, endpoint, args.dest);
    const destBytes = destObjects.reduce((sum, o) => sum + o.Size, 0);
    console.log(
      `[r2-clone] dest ${args.dest}: ${destObjects.length} objects, ${humanBytes(destBytes)}`,
    );
    const objDiff = sourceObjects.length - destObjects.length;
    const byteDiff = sourceBytes - destBytes;
    console.log(
      `[r2-clone] diff (source − dest): ${objDiff} objects, ${humanBytes(byteDiff)}`,
    );
    if (objDiff !== 0 || byteDiff !== 0) {
      console.error('[r2-clone] FAIL — buckets diverge');
      process.exit(1);
    }
    console.log('[r2-clone] OK — counts match');
    return;
  }

  let copied = 0;
  let skipped = 0;
  let processedSinceLog = 0;
  const start = performance.now();
  await processConcurrent(sourceObjects, 8, async (obj) => {
    if (await exists(client, endpoint, args.dest, obj.Key)) {
      skipped += 1;
    } else {
      if (!args.dryRun) {
        await copyObject(client, endpoint, args.source, args.dest, obj.Key);
      }
      copied += 1;
    }
    processedSinceLog += 1;
    if (processedSinceLog >= 100) {
      processedSinceLog = 0;
      console.log(
        `[r2-clone] progress: ${copied + skipped}/${sourceObjects.length} (${copied} copied, ${skipped} skipped)`,
      );
    }
  });

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(
    `[r2-clone] DONE in ${elapsed}s: ${copied} copied, ${skipped} skipped (already present), ${sourceObjects.length} total${
      args.dryRun ? ' [DRY RUN — no writes performed]' : ''
    }`,
  );
}

function humanBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

await main();
