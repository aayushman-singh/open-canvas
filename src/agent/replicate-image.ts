// src/agent/replicate-image.ts
//
// Shared Replicate flux-schnell helpers. Two call sites:
//   - `routes/api/canvas.ts` POST /sites/:siteId/assets/generate — the
//     inspector's "Generate image (AI)" button. Owner-triggered,
//     synchronous, returns bytes.
//   - `agent/chat/orchestrator.ts` dispatch for the `generateImage` tool —
//     the chat agent's image-slot generation. LLM-triggered, the bytes
//     ride inline on the op-preview event so the editor can ghost-paint
//     the proposed image without the asset existing yet (ADR 0004 D2).
//
// No fallback path: a Replicate failure or a non-image output throws with
// full context. Repo policy forbids silent fallbacks.

/**
 * flux-schnell only accepts a fixed `aspect_ratio` preset set; anything else
 * the model server rejects. The slot's exact w/h ratio is snapped to the
 * preset whose log-ratio is closest, so 2:1 and 1:2 are treated as equally
 * far from 1:1.
 */
const FLUX_ASPECT_PRESETS = [
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '21:9', value: 21 / 9 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '9:16', value: 9 / 16 },
  { label: '9:21', value: 9 / 21 },
] as const;

export function snapToFluxAspectRatio(boxW: number, boxH: number): string {
  const target = boxW / boxH;
  let bestLabel: string = FLUX_ASPECT_PRESETS[0].label;
  let bestDiff = Math.abs(Math.log(FLUX_ASPECT_PRESETS[0].value / target));
  for (const preset of FLUX_ASPECT_PRESETS) {
    const diff = Math.abs(Math.log(preset.value / target));
    if (diff < bestDiff) {
      bestLabel = preset.label;
      bestDiff = diff;
    }
  }
  return bestLabel;
}

interface ReplicatePrediction {
  id: string;
  status: string;
  output: unknown;
  error: unknown;
  logs: unknown;
}

export interface ReplicateImageBytes {
  bytes: Uint8Array;
  mediaType: string;
}

/**
 * Owner-driven Owner Asset generation via Replicate's flux-schnell.
 * Synchronous wait (Replicate's `Prefer: wait`, max 60s) — flux-schnell
 * typically returns in ~2-5s.
 */
export async function generateImageViaReplicate(
  token: string,
  prompt: string,
  aspectRatio: string,
): Promise<ReplicateImageBytes> {
  const replicateResponse = await fetch(
    'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio } }),
    },
  );
  if (!replicateResponse.ok) {
    const text = await replicateResponse.text();
    throw new Error(
      `replicate prediction request failed: status=${String(replicateResponse.status)} body=${text}`,
    );
  }
  const prediction: ReplicatePrediction = await replicateResponse.json();
  if (prediction.status !== 'succeeded') {
    throw new Error(
      `replicate prediction not succeeded: status=${prediction.status} id=${prediction.id} error=${JSON.stringify(prediction.error)} logs=${JSON.stringify(prediction.logs)}`,
    );
  }
  const output = prediction.output;
  const outputUrl =
    typeof output === 'string'
      ? output
      : Array.isArray(output) && typeof output[0] === 'string'
        ? output[0]
        : null;
  if (!outputUrl) {
    throw new Error(`replicate prediction output unrecognised: ${JSON.stringify(output)}`);
  }
  const imageResponse = await fetch(outputUrl);
  if (!imageResponse.ok) {
    throw new Error(
      `replicate output fetch failed: status=${String(imageResponse.status)} url=${outputUrl}`,
    );
  }
  const mediaType = imageResponse.headers.get('content-type') ?? 'image/webp';
  if (!mediaType.startsWith('image/')) {
    throw new Error(`replicate output media type not an image: ${mediaType}`);
  }
  const buffer = new Uint8Array(await imageResponse.arrayBuffer());
  return { bytes: buffer, mediaType };
}

/**
 * Mirror of MAX_ASSET_DATA_URL_BYTES from `routes/api/canvas.ts` — flux-schnell
 * outputs land well below this cap, but the orchestrator must reject larger
 * responses so the chat SSE event doesn't ship a multi-MB payload that the
 * editor would also reject on Accept upload.
 */
export const MAX_GENERATED_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Encode a Replicate response as a base64 data URL. Used by the chat
 * orchestrator: the op-preview carries the data URL inline so the editor
 * can paint the ghost overlay (and POST these exact bytes back on Accept)
 * without an intermediate asset row.
 */
export function encodeImageDataUrl(image: ReplicateImageBytes): string {
  // btoa() takes a binary string. We chunk the conversion to avoid the
  // String.fromCharCode argument-count cap on large buffers (~125k args).
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < image.bytes.length; i += CHUNK) {
    const slice = image.bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  const base64 = btoa(binary);
  return `data:${image.mediaType};base64,${base64}`;
}
