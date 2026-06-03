// src/editor-client/editor-constants.ts
//
// ADR 0015 Phase 2a — editor-only constants. Each entry below has no
// canonical server-side export today; canvas-client.ts (the legacy
// editor source) declares each one inline and this file becomes the
// runtime source after Phase 3 cutover.
//
// MIN_ELEMENT_SIZE_PX and DEFAULT_PAGE_WIDTH_PX are flagged in
// canvas-client.ts as "mirroring server-side validate.ts bounds," but
// the cited symbols do not exist as named exports in validate.ts — the
// bounds live as inline magic numbers in the validator body. Promoting
// them to canonical exports (in schema.ts or a sibling bounds module)
// would let this file import rather than redeclare, but that change
// touches validate.ts and is out of scope for Phase 2a.

/** Minimum drag/resize size for a positioned element, in canvas px. */
export const MIN_ELEMENT_SIZE_PX = 24;

/** Default page width for a new page. Sized to match the 1440 px desktop
 *  artboard the inspector is calibrated for. */
export const DEFAULT_PAGE_WIDTH_PX = 1440;

/** Video poster extraction seek offset; some codecs emit a black frame
 *  at t=0 so step a hair past zero. Clamped to half-duration by the
 *  caller for very short clips. */
export const FIRST_FRAME_SEEK_SECONDS = 0.05;

/** Hard ceiling on the video-poster extraction promise. Unsupported
 *  codecs can leave loadeddata / seeked un-fired; without this the UI
 *  silently hangs on "Loading…". Loud failure beats fake progress. */
export const POSTER_EXTRACTION_TIMEOUT_MS = 30_000;

/** Co-edit reconnect curve. Mirrors src/live/co-edit/client.ts defaults
 *  so the editor host advertises the same backoff the connector applies.
 *  Base × 2^attempt, capped at MAX_DELAY_MS, then × [0.5, 1.0) jitter. */
export const COEDIT_RECONNECT_BASE_DELAY_MS = 1_000;
export const COEDIT_RECONNECT_MAX_DELAY_MS = 30_000;

/** Give-up threshold for the co-edit reconnect loop. Past this many
 *  consecutive failed attempts we stop retrying and tell the user to
 *  reload — silent infinite reconnects mask a real outage and burn the
 *  user's battery. */
export const COEDIT_RECONNECT_MAX_ATTEMPTS = 10;

/** Subresource integrity for the Cropper.js v2.1.1 ESM bundle on
 *  jsDelivr. Recompute when the CDN version is bumped:
 *    curl -s https://cdn.jsdelivr.net/npm/cropperjs@2.1.1/dist/cropper.esm.js \
 *      | openssl dgst -sha384 -binary | openssl base64 -A
 *  The runtime verifies downloaded bytes against this before evaluating
 *  the module; a CDN compromise that ships different bytes for the same
 *  version trips a loud error instead of executing attacker JS inside
 *  the Owner's session. */
export const CROPPER_SRI_SHA384 =
  'yCR/qrwwtTzBEzopZRNsQRqJmomeGgAikrPg/5vB2wkQLsM3OGRnEktc9gpN1KDg';

/** CDN URL for the Cropper.js v2.1.1 ESM bundle. Must match the version
 *  the CROPPER_SRI_SHA384 hash above was computed against. */
export const CROPPER_CDN =
  'https://cdn.jsdelivr.net/npm/cropperjs@2.1.1/dist/cropper.esm.js';

/** Inter-artboard gap in canvas px. Pages stack vertically with this
 *  much space between their artboard borders. */
export const PAGE_GAP = 120;

/** Height of the per-page artboard label above each page in canvas px. */
export const ARTBOARD_LABEL_HEIGHT = 40;

/** Lower bound for the camera zoom factor. */
export const ZOOM_MIN = 0.25;

/** Upper bound for `fitToPage` / `fitAllPages` automatic zoom. The fit
 *  affordances never zoom past 100% — a small artboard fitting to
 *  500% would surface huge pixelation. */
export const ZOOM_MAX_FIT = 1.0;

/** Upper bound for manual zoom (toolbar +/- and wheel). Owners can
 *  intentionally zoom past 100% for precise positioning. */
export const ZOOM_MAX_MANUAL = 2.0;

/** Increment for the zoom toolbar +/- buttons. Wheel zoom uses a
 *  finer step computed from the wheel delta; this constant is the
 *  click-step floor. */
export const ZOOM_STEP = 0.1;

/** Canonical nesting order for inline marks. Outermost first: `link`
 *  wraps every other mark so anchor styling stays intact; the typographic
 *  tags nest inside in this exact sequence so the editor preview matches
 *  the server renderer (src/canvas/render.ts) and the serializer's
 *  adjacent-run dedupe by JSON string stays reliable. `fontSize` sits
 *  outermost because it stamps a style attribute on the outer span
 *  rather than wrapping a tag. Derived from INLINE_MARK_TYPES in
 *  schema.ts but ordered differently — the editor's order is load-bearing
 *  for the DOM serializer's wrap() sequence. */
export const CANONICAL_MARK_ORDER = [
  'fontSize',
  'link',
  'bold',
  'italic',
  'underline',
  'strike',
  'highlight',
  'code',
] as const;
