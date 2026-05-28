// src/canvas/elements/media.ts
//
// `MediaElement` discriminated union (image/video) + renderer.

import { escapeAttr, styleFromEntries } from './render-utils.js';
import type { BackgroundSize, BaseElement } from '../schema.js';

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
    return `<img class="rev01-media" data-rev01-media-kind="image" src="${escapeAttr(src)}" alt="${escapeAttr(element.alt)}" style="${baseStyle}" />`;
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
  return `<video class="rev01-media" data-rev01-media-kind="video" src="${escapeAttr(src)}" aria-label="${escapeAttr(element.alt)}"${posterAttr} style="${baseStyle}" ${attrs.join(' ')}></video>`;
}
