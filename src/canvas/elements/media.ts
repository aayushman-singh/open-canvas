// src/canvas/elements/media.ts
//
// Render fn for the existing `MediaElement` element type. Interface still
// lives in `src/canvas/schema.ts`; this module owns rendering only.

import { escapeAttr, styleFromEntries } from './render-utils.js';
import type { MediaElement } from '../schema.js';

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
