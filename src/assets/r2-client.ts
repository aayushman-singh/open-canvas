// src/assets/r2-client.ts
//
// Typed wrapper around the Cloudflare R2 binding declared in wrangler.toml
// as `ASSETS_BUCKET` (see ADR 0006). The wrapper exposes only the operations
// the asset routes need — there is no general-purpose pass-through. Anything
// the routes do not need stays unexported so the surface shrinks rather than
// grows.
//
// Failure handling follows the repo policy: every method either returns a
// well-shaped result (R2 object, null, or boolean) or throws loudly. There
// is no silent fallback; an R2 binding that is missing or misconfigured
// surfaces as a thrown TypeError from the Workers runtime before the call
// would have reached this wrapper.

/**
 * The subset of the R2 binding surface the asset pipeline actually touches.
 * Defining it here keeps the wrapper testable with an in-memory mock that
 * does not need to implement every R2Bucket method.
 */
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
}

export interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  /**
   * Conditional-put predicate. The wrapper passes `{ etagDoesNotMatch: '*' }`
   * (meaning "only put if the key has no existing object") for upload paths
   * that want put-if-missing semantics; the underlying binding interprets
   * this against the live bucket state.
   */
  onlyIf?: {
    etagDoesNotMatch?: string;
  };
}

export interface R2Client {
  /**
   * Upload bytes at `key` with the given content type. When `ifMissing` is
   * true the put is conditional on the key not already existing; the
   * underlying R2 binding may either reject the request or return null when
   * the key collides. The wrapper normalises both to "no put happened".
   */
  put(
    key: string,
    body: ArrayBuffer | Uint8Array,
    contentType: string,
    options?: { ifMissing?: boolean },
  ): Promise<{ uploaded: boolean }>;
  /**
   * Fetch the bytes at `key`. Returns `null` when the key does not exist.
   * The returned object exposes `body` and `httpMetadata` per R2's surface.
   */
  get(key: string): Promise<R2ObjectBody | null>;
  /**
   * Metadata-only probe. Returns `null` when the key does not exist; never
   * downloads bytes.
   */
  head(key: string): Promise<R2Object | null>;
  /**
   * Delete a single key. Returns `true` if a `head` confirmed deletion;
   * false when the key was already absent. (The R2 binding's `delete` is
   * effectively idempotent, so the boolean is informational.)
   */
  delete(key: string): Promise<boolean>;
}

export function createR2Client(bucket: R2BucketLike): R2Client {
  return {
    async put(key, body, contentType, options) {
      const putOptions: R2PutOptions = {
        httpMetadata: { contentType },
      };
      if (options?.ifMissing) {
        // R2's `onlyIf: { etagDoesNotMatch: '*' }` semantics: succeed only
        // when no current etag matches anything — i.e. the key has no
        // existing object. The binding returns null on conditional miss.
        putOptions.onlyIf = { etagDoesNotMatch: '*' };
      }
      // R2's `put` accepts both `ArrayBuffer` and `ArrayBufferView` (which
      // includes Uint8Array) — we forward the value verbatim. SharedArrayBuffer
      // is intentionally not supported on this surface; the typed wrapper input
      // rejects it at the call site.
      const result = await bucket.put(key, body, putOptions);
      return { uploaded: result !== null };
    },
    get(key) {
      return bucket.get(key);
    },
    head(key) {
      return bucket.head(key);
    },
    async delete(key) {
      const existed = (await bucket.head(key)) !== null;
      await bucket.delete(key);
      return existed;
    },
  };
}
