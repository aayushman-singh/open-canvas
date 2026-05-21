// src/canvas/render.ts
//
// Pure HTML renderer for a Published Snapshot. Emits a self-contained <main>
// block; the caller wraps it in the full document.
//
// All user-controlled strings are escaped at the boundary. The function is
// pure — no DOM access, no I/O. The caller passes an assetBasePath so the
// renderer never has to know how Site Assets are addressed.

import type {
  ActionElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  ContainerElement,
  MediaElement,
  PublishedSnapshot,
  ShapeElement,
  TextElement,
} from './schema.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES[ch] ?? ch);
}

// Defense-in-depth for pinnedStyle values. Validator already rejects dangerous
// payloads, but the renderer refuses to emit anything that could break out of
// the current CSS declaration. Returns '' when the value contains any
// structural CSS character or control character — the caller treats '' as a
// signal to drop the property entirely.
function escapeCssValue(value: string): string {
  // Reject structural CSS characters that would let a value introduce extra
  // declarations, escape the style="" attribute context, or smuggle in
  // comment/url tricks. Control characters (U+0000..U+001F) are rejected so
  // a NUL or newline cannot split the value.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20) return '';
    const ch = value[i];
    if (ch === ';' || ch === '{' || ch === '}' || ch === '\\' || ch === '/') return '';
  }
  return escapeAttr(value);
}

// CSS property names are restricted to ASCII letters and hyphen. Anything
// outside that set is stripped; if nothing remains, the caller drops the
// entry.
function sanitiseCssKey(key: string): string {
  return key.replace(/[^a-zA-Z-]/g, '');
}

function styleFromEntries(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries.map(([k, v]) => `${k}:${v}`).join(';');
}

function buildElementWrapperStyle(element: CanvasElement): string {
  const { box } = element;
  const entries: Array<[string, string]> = [
    ['position', 'absolute'],
    ['left', `${String(box.x)}px`],
    ['top', `${String(box.y)}px`],
    ['width', `${String(box.w)}px`],
    ['height', `${String(box.h)}px`],
    ['z-index', String(box.z)],
  ];
  if (typeof box.rotation === 'number' && box.rotation !== 0) {
    entries.push(['transform', `rotate(${String(box.rotation)}deg)`]);
  }
  if (element.pinnedStyle) {
    // Pinned style wins — append after defaults so its keys override duplicates.
    for (const [k, v] of Object.entries(element.pinnedStyle)) {
      const safeKey = sanitiseCssKey(k);
      if (safeKey === '') continue;
      const safeValue = escapeCssValue(v);
      if (safeValue === '') continue;
      entries.push([safeKey, safeValue]);
    }
  }
  return styleFromEntries(entries);
}

function renderTextElement(element: TextElement): string {
  const tag = element.role === 'heading' ? 'h1' : element.role === 'body' ? 'p' : 'span';
  const innerStyle = styleFromEntries([
    ['font-size', `${String(element.fontSize)}px`],
    ['font-weight', String(element.fontWeight)],
    ['text-align', element.align],
    ['margin', '0'],
  ]);
  return `<${tag} class="rev01-text" data-role="${escapeAttr(element.role)}" style="${innerStyle}">${escapeHtml(element.text)}</${tag}>`;
}

function renderMediaElement(element: MediaElement, assetBasePath: string): string {
  const src = `${assetBasePath}/${element.assetId}`;
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
    element.posterAssetId !== undefined
      ? ` poster="${escapeAttr(`${assetBasePath}/${element.posterAssetId}`)}"`
      : '';
  return `<video class="rev01-media" data-rev01-media-kind="video" src="${escapeAttr(src)}" aria-label="${escapeAttr(element.alt)}"${posterAttr} style="${baseStyle}" ${attrs.join(' ')}></video>`;
}

function renderActionElement(element: ActionElement): string {
  return `<a class="rev01-action" data-variant="${escapeAttr(element.variant)}" href="${escapeAttr(element.href)}">${escapeHtml(element.label)}</a>`;
}

function renderShapeElement(element: ShapeElement): string {
  return `<div class="rev01-shape" data-variant="${escapeAttr(element.variant)}"></div>`;
}

function renderContainerElement(element: ContainerElement): string {
  return `<div class="rev01-surface" data-variant="${escapeAttr(element.variant)}"></div>`;
}

function renderElementBody(element: CanvasElement, assetBasePath: string): string {
  switch (element.type) {
    case 'text':
      return renderTextElement(element);
    case 'media':
      return renderMediaElement(element, assetBasePath);
    case 'action':
      return renderActionElement(element);
    case 'shape':
      return renderShapeElement(element);
    case 'container':
      return renderContainerElement(element);
  }
}

function renderElement(element: CanvasElement, assetBasePath: string): string {
  const inner = renderElementBody(element, assetBasePath);
  const wrapperStyle = buildElementWrapperStyle(element);
  const motionAttrs =
    element.motion !== undefined
      ? ` data-motion-preset="${escapeAttr(element.motion.preset)}" data-motion-delay-ms="${escapeAttr(String(element.motion.delayMs ?? 0))}"`
      : '';
  return `<div class="rev01-element" data-rev01-element="${escapeAttr(element.id)}" data-element-type="${escapeAttr(element.type)}"${motionAttrs} style="${wrapperStyle}">${inner}</div>`;
}

function renderSection(
  section: CanvasSection,
  pageWidth: number,
  assetBasePath: string,
): string {
  const bgEffect = section.backgroundEffect ?? 'none';
  const entrance = section.entrance ?? 'none';
  const style = styleFromEntries([
    ['position', 'relative'],
    ['width', `${String(pageWidth)}px`],
    ['height', `${String(section.height)}px`],
  ]);
  const elementsHtml = section.elements
    .map((element) => renderElement(element, assetBasePath))
    .join('');
  return `<section class="rev01-section" data-rev01-section="${escapeAttr(section.id)}" data-recipe="${escapeAttr(section.recipeId)}" data-bg-effect="${escapeAttr(bgEffect)}" data-entrance="${escapeAttr(entrance)}" style="${style}">${elementsHtml}</section>`;
}

function renderPage(page: CanvasPage, assetBasePath: string): string {
  const style = styleFromEntries([
    ['width', `${String(page.width)}px`],
    ['margin', '0 auto'],
  ]);
  const sectionsHtml = page.sections
    .map((section) => renderSection(section, page.width, assetBasePath))
    .join('');
  return `<article class="rev01-page" data-rev01-page="${escapeAttr(page.id)}" style="${style}">${sectionsHtml}</article>`;
}

export function renderCanvasSnapshot(
  snapshot: PublishedSnapshot,
  assetBasePath: string,
): string {
  const pagesHtml = snapshot.pages.map((page) => renderPage(page, assetBasePath)).join('');
  return `<main class="rev01-site" data-style-kit="${escapeAttr(snapshot.styleKit)}">${pagesHtml}</main>`;
}
