// src/editor-client/inspector-mounts-media-asset.ts
//
// ADR 0058 Phase 2q.e — media asset uploader + image generator stragglers.
// canvas-client.ts:7925-7994 carries the inline twins; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// DEAD CODE DISCLAIMER: As of dbffdc1, neither `appendMediaUploader` nor
// `appendImageGenerator` is called anywhere in the IIFE — the media picker
// (mountMediaPicker, src/editor-client/inspector-nav-media-picker-mounts.ts)
// owns the live upload/generate flow today. These two fragments are kept
// extracted for parity with ADR 0058 Decision 1 (mechanical lift of every
// inline closure surface); Phase 3 cutover will decide whether to wire them
// back in or drop them outright. The inline IIFE stays byte-identical
// regardless.
//
// Two append-fns:
//   - appendMediaUploader: legacy two-row uploader (file input + alt text)
//     that mounts directly into ctx.inspector. File-change routes through
//     ctx.uploadMediaForElement; alt-text change rebuilds the element and
//     schedules a save. The alt input carries the well-known id
//     "media-upload-alt-<elementId>" — the AI generator below reads it
//     when present, so the two fields stay correlated when both mount.
//   - appendImageGenerator: image-only prompt + button that fires
//     ctx.generateImageForElement on click. No-op on video elements;
//     surfaces "Enter a prompt first" via ctx.setStatus when the prompt
//     is empty.

import type {
  DomContext,
  EditorContext,
  PersistContext,
  RenderContext,
  StatusEmitterContext,
} from './editor-context.js';
import type { MediaElement } from '../canvas/elements/media.js';

// ADR 0064 — media-asset stragglers carve. Both append-fns mount directly
// into `ctx.inspector` (DomContext) and schedule a debounced save on
// commit (PersistContext). `appendMediaUploader` additionally rebuilds the
// element after alt-text changes (RenderContext) and routes the file
// upload through `uploadMediaForElement` — a module-specific verb with no
// named cluster, declared inline. `appendImageGenerator` surfaces the
// "Enter a prompt first" refusal via `setStatus` (StatusEmitterContext)
// and dispatches generation through `generateImageForElement` — also a
// module-specific verb, declared inline. No overlap in module-specific
// verbs, so each fn signs against its own narrow type.
export type AppendMediaUploaderContext = DomContext &
  RenderContext &
  PersistContext &
  Pick<EditorContext, 'uploadMediaForElement'>;

export type AppendImageGeneratorContext = DomContext &
  StatusEmitterContext &
  Pick<EditorContext, 'generateImageForElement'>;

export function appendMediaUploader(
  ctx: AppendMediaUploaderContext,
  element: MediaElement,
): void {
  if (!ctx.inspector) return;
  const inspector = ctx.inspector;
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent =
    element.mediaKind === 'image' ? 'Replace image' : 'Replace video';
  wrap.appendChild(label);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = element.mediaKind === 'image' ? 'image/*' : 'video/*';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    void ctx.uploadMediaForElement(element, file);
  });
  wrap.appendChild(fileInput);
  inspector.appendChild(wrap);

  const altWrap = document.createElement('div');
  altWrap.className = 'field';
  const altLabel = document.createElement('label');
  altLabel.textContent = 'Alt text';
  const altInput = document.createElement('input');
  altInput.type = 'text';
  altInput.id = 'media-upload-alt-' + element.id;
  altInput.value = typeof element.alt === 'string' ? element.alt : '';
  altInput.addEventListener('change', () => {
    element.alt = altInput.value;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  altWrap.appendChild(altLabel);
  altWrap.appendChild(altInput);
  inspector.appendChild(altWrap);
}

// Direct image generation via the Replicate-backed /assets/generate route.
// Distinct from the agent-driven "AI media" button: this one creates a
// brand-new asset shaped to the slot's aspect ratio without an LLM round-trip.
export function appendImageGenerator(
  ctx: AppendImageGeneratorContext,
  element: MediaElement,
): void {
  if (element.mediaKind !== 'image') return;
  if (!ctx.inspector) return;
  const inspector = ctx.inspector;
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'Generate image (AI)';
  wrap.appendChild(label);

  const promptInput = document.createElement('textarea');
  promptInput.rows = 2;
  promptInput.placeholder = 'Describe the image…';
  promptInput.style.cssText = 'width:100%;box-sizing:border-box;';
  wrap.appendChild(promptInput);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Generate';
  btn.style.cssText = 'margin-top:6px;';
  btn.addEventListener('click', () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      ctx.setStatus('Enter a prompt first', 'error');
      return;
    }
    void ctx.generateImageForElement(element, prompt);
  });
  wrap.appendChild(btn);

  inspector.appendChild(wrap);
}
