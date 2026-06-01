// src/canvas/elements/media.ts
//
// `MediaElement` discriminated union (image/video) + renderer + inspector
// spec (ADR 0011 Step 1).

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, styleFromEntries } from './render-utils.js';
import { MEDIA_KINDS, type BackgroundSize, type BaseElement } from '../schema.js';

/** Fields shared by both media variants. */
interface MediaElementShared extends BaseElement {
  type: 'media';
  assetId: string;
  alt: string;
  // `'cover' | 'contain'` — reuses BackgroundSize since the value set is the
  // same CSS `object-fit` / `background-size` pair.
  fit: BackgroundSize;
}

/** Static image. No poster, no playback. */
export interface ImageMediaElement extends MediaElementShared {
  mediaKind: 'image';
}

/** Video clip. `posterAssetId` and `playback` are video-only and unrepresentable on images. */
export interface VideoMediaElement extends MediaElementShared {
  mediaKind: 'video';
  posterAssetId?: string;
  /**
   * Each flag is truthy-only: undefined or `false` means the corresponding
   * `<video>` attribute is NOT emitted and the browser's default applies
   * (no autoplay, audible, plays once, no chrome).
   */
  playback?: {
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    controls?: boolean;
  };
}

export type MediaElement = ImageMediaElement | VideoMediaElement;

export interface MediaRenderCtx {
  assetBasePath: string;
}

export function renderMedia(element: MediaElement, ctx: MediaRenderCtx): string {
  if (element.assetId === '__placeholder__') return '';
  const src = `${ctx.assetBasePath}/${element.assetId}`;
  const baseStyle = styleFromEntries([
    ['object-fit', element.fit],
    ['width', '100%'],
    ['height', '100%'],
    ['display', 'block'],
  ]);
  if (element.mediaKind === 'image') {
    return `<img class="opencanvas-media" data-opencanvas-media-kind="image" src="${escapeAttr(src)}" alt="${escapeAttr(element.alt)}" style="${baseStyle}" />`;
  }
  // Video.
  const playback = element.playback ?? {};
  const attrs: string[] = [];
  if (playback.autoplay) attrs.push('autoplay');
  if (playback.muted) attrs.push('muted');
  if (playback.loop) attrs.push('loop');
  if (playback.controls) attrs.push('controls');
  attrs.push('playsinline');
  const posterAttr =
    element.posterAssetId !== undefined && element.posterAssetId !== '__placeholder__'
      ? ` poster="${escapeAttr(`${ctx.assetBasePath}/${element.posterAssetId}`)}"`
      : '';
  return `<video class="opencanvas-media" data-opencanvas-media-kind="video" src="${escapeAttr(src)}" aria-label="${escapeAttr(element.alt)}"${posterAttr} style="${baseStyle}" ${attrs.join(' ')}></video>`;
}

export const mediaInspectorSpec: InspectorSpec = {
  fields: [
    {
      kind: 'button-action',
      label: 'AI media',
      action: 'replace-media',
      dataAttr: 'replace-media',
      busyFlag: 'aiBusy',
    },
    // Asset picker (image | video selection + crop). Imperative because the
    // picker manages its own internal modal + upload flow.
    { kind: 'custom-mount', name: 'media-picker' },
    { kind: 'select', label: 'Fit', path: 'fit', options: ['cover', 'contain'] },
    // Video-only playback controls (autoplay, muted, loop, controls). The
    // mount handler checks `element.mediaKind === 'video'` and skips
    // rendering on images — a general visible-when machinery is overkill
    // for a single conditional, see ADR 0011 dec 3 "generalize on demand".
    { kind: 'custom-mount', name: 'video-playback' },
  ],
};

// Media is the one element type with multiple sidebar entries: the Owner
// picks "Image" (mediaKind: 'image') or "Video" (mediaKind: 'video') as
// two distinct buttons. The factories diverge on default playback flags
// and the kind discriminator, so they ship as two named factories in
// canvas-client.ts (`image`, `video`) rather than one factory with a flag.
export const mediaSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'image',
      sidebarLabel: 'Image',
      sidebarTip: 'Add an image',
      toolbarLabel: '+Img',
      toolbarTip: 'Add image',
      factoryName: 'image',
    },
    {
      key: 'video',
      sidebarLabel: 'Video',
      sidebarTip: 'Add a video player',
      toolbarLabel: '+Vid',
      toolbarTip: 'Add video',
      factoryName: 'video',
    },
  ],
};

// ---------------------------------------------------------------------------
// Agent tool spec — media element (ADR 0011 Step 2)
// ---------------------------------------------------------------------------

function isRecordLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const mediaAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    fit: {
      type: 'string',
      enum: ['cover', 'contain'],
      description: 'Media fit mode. Media elements only.',
    },
    alt: {
      type: 'string',
      description: 'Alt text. Media elements only.',
    },
    assetId: {
      type: 'string',
      description: 'Asset ID to display. Media elements only. Must be an existing uploaded asset.',
    },
    mediaKind: {
      type: 'string',
      enum: [...MEDIA_KINDS],
      description: 'Media kind. Media elements only.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.fit !== undefined) {
      if (typeof args.fit !== 'string') throw new Error('fit must be a string');
      patch.fit = args.fit;
    }
    if (args.alt !== undefined) {
      if (typeof args.alt !== 'string') throw new Error('alt must be a string');
      patch.alt = args.alt;
    }
    if (args.mediaKind !== undefined) {
      if (typeof args.mediaKind !== 'string') throw new Error('mediaKind must be a string');
      patch.mediaKind = args.mediaKind;
    }
    if (args.assetId !== undefined) {
      if (typeof args.assetId !== 'string') throw new Error('assetId must be a string');
      patch.assetId = args.assetId;
    }
    return patch;
  },
  standaloneTool: {
    tool: {
      name: 'replaceMedia',
      description:
        "Replace a media element's asset with an EXISTING uploaded asset id. " +
        'The model picks an asset that has already been uploaded to the site; this tool does NOT generate media bytes.',
      parameters: {
        type: 'object',
        properties: {
          elementId: {
            type: 'string',
            description: 'The id of the existing media element whose asset should be replaced.',
          },
          mediaKind: {
            type: 'string',
            enum: [...MEDIA_KINDS],
            description: 'The kind of media — must match the kind of the uploaded asset.',
          },
          assetId: {
            type: 'string',
            description:
              'The id of an EXISTING uploaded asset on this site. The model does NOT generate media bytes; ' +
              'the Owner uploads assets via the canvas API, and the model picks one of those ids.',
          },
          alt: {
            type: 'string',
            description:
              'Accessible alt text for the new asset. Empty string is acceptable for purely decorative media.',
          },
        },
        required: ['elementId', 'mediaKind', 'assetId', 'alt'],
      },
    },
    parse: (args) => {
      if (!isRecordLocal(args)) {
        return { ok: false, error: 'replaceMedia arguments must be an object' };
      }
      if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
        return { ok: false, error: 'replaceMedia.elementId must be a non-empty string' };
      }
      if (
        typeof args.mediaKind !== 'string' ||
        !(MEDIA_KINDS as readonly string[]).includes(args.mediaKind)
      ) {
        return {
          ok: false,
          error: `replaceMedia.mediaKind must be one of [${MEDIA_KINDS.join(', ')}] (got ${JSON.stringify(args.mediaKind)})`,
        };
      }
      if (typeof args.assetId !== 'string' || args.assetId.length === 0) {
        return { ok: false, error: 'replaceMedia.assetId must be a non-empty string' };
      }
      if (typeof args.alt !== 'string') {
        return { ok: false, error: 'replaceMedia.alt must be a string' };
      }
      return {
        ok: true,
        op: {
          kind: 'replaceMedia',
          elementId: args.elementId,
          mediaKind: args.mediaKind as (typeof MEDIA_KINDS)[number],
          assetId: args.assetId,
          alt: args.alt,
        },
      };
    },
  },
};
