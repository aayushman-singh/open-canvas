import type { Page } from 'puppeteer';
import type { ScrapedSection, ScrapedElement } from './types.js';

const SECTION_TAGS = new Set(['HEADER', 'MAIN', 'SECTION', 'FOOTER', 'ARTICLE', 'NAV']);

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD',
  'BR', 'WBR', 'TEMPLATE', 'SLOT',
]);

const HEADING_TAGS: Record<string, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
};

const TEXT_TAGS = new Set([
  'P', 'SPAN', 'BLOCKQUOTE', 'LI', 'LABEL', 'FIGCAPTION',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'PICTURE']);

interface RawDOMNode {
  tag: string;
  box: { x: number; y: number; w: number; h: number };
  styles: {
    display: string;
    visibility: string;
    opacity: string;
    backgroundColor: string;
    color: string;
    fontSize: string;
    fontFamily: string;
    fontWeight: string;
    textAlign: string;
    borderRadius: string;
    border: string;
    boxShadow: string;
    backdropFilter: string;
    backgroundImage: string;
    padding: string;
    transform: string;
    transition: string;
    animation: string;
    willChange: string;
  };
  textContent: string;
  innerText: string;
  href: string | null;
  src: string | null;
  alt: string | null;
  tagName: string;
  childCount: number;
  hasTextDirectly: boolean;
  isVisible: boolean;
  zIndex: number;
  children: RawDOMNode[];
}

export async function extractSections(page: Page): Promise<{
  sections: ScrapedSection[];
  allNodes: RawDOMNode[];
}> {
  const rawData = await page.evaluate(() => {
    function getComputedProps(el: Element) {
      const cs = window.getComputedStyle(el);
      return {
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        textAlign: cs.textAlign,
        borderRadius: cs.borderRadius,
        border: cs.border,
        boxShadow: cs.boxShadow,
        backdropFilter: cs.backdropFilter,
        backgroundImage: cs.backgroundImage,
        padding: cs.padding,
        transform: cs.getPropertyValue('transform'),
        transition: cs.getPropertyValue('transition'),
        animation: cs.getPropertyValue('animation'),
        willChange: cs.getPropertyValue('will-change'),
      };
    }

    function isVisible(el: Element, cs: ReturnType<typeof getComputedProps>): boolean {
      if (cs.display === 'none') return false;
      if (cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    }

    function hasDirectText(el: Element): boolean {
      for (const child of el.childNodes) {
        if (child.nodeType === 3 && child.textContent && child.textContent.trim().length > 0) {
          return true;
        }
      }
      return false;
    }

    function getZIndex(el: Element): number {
      const cs = window.getComputedStyle(el);
      const z = parseInt(cs.zIndex, 10);
      return isNaN(z) ? 0 : z;
    }

    function walkNode(el: Element, depth: number): any | null {
      if (depth > 20) return null;
      const tag = el.tagName;
      const skipTags = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD',
        'BR', 'WBR', 'TEMPLATE', 'SLOT',
      ]);
      if (skipTags.has(tag)) return null;

      const styles = getComputedProps(el);
      if (!isVisible(el, styles)) return null;

      const rect = el.getBoundingClientRect();
      const children: any[] = [];
      for (const child of el.children) {
        const c = walkNode(child, depth + 1);
        if (c) children.push(c);
      }

      return {
        tag,
        box: {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          w: rect.width,
          h: rect.height,
        },
        styles,
        textContent: el.textContent?.trim().slice(0, 500) || '',
        innerText: (el as HTMLElement).innerText?.trim().slice(0, 500) || '',
        href: (el as HTMLAnchorElement).href || null,
        src: (el as HTMLImageElement).src || (el as HTMLVideoElement).src || null,
        alt: (el as HTMLImageElement).alt || null,
        tagName: tag,
        childCount: el.children.length,
        hasTextDirectly: hasDirectText(el),
        isVisible: true,
        zIndex: getZIndex(el),
        children,
      };
    }

    const body = document.body;
    if (!body) return { sectionNodes: [], pageHeight: 0 };

    const sectionTagSet = new Set(['HEADER', 'MAIN', 'SECTION', 'FOOTER', 'ARTICLE', 'NAV']);
    const topLevelSkipTags = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD',
      'BR', 'WBR', 'TEMPLATE', 'SLOT',
    ]);
    const topLevelSections: { node: any; tag: string }[] = [];

    for (const child of body.children) {
      const tag = child.tagName;
      if (topLevelSkipTags.has(tag)) continue;
      const walked = walkNode(child, 0);
      if (!walked) continue;

      if (sectionTagSet.has(tag)) {
        topLevelSections.push({ node: walked, tag });
      } else if (tag === 'DIV' || tag === 'FORM') {
        topLevelSections.push({ node: walked, tag: 'SECTION' });
      }
    }

    if (topLevelSections.length === 0) {
      const walked = walkNode(body, 0);
      if (walked) {
        topLevelSections.push({ node: walked, tag: 'BODY' });
      }
    }

    return {
      sectionNodes: topLevelSections,
      pageHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      ),
    };
  });

  const sections: ScrapedSection[] = [];

  for (let i = 0; i < rawData.sectionNodes.length; i++) {
    const { node, tag } = rawData.sectionNodes[i]!;
    const sectionTop = node.box.y;
    const sectionHeight = node.box.h;

    if (sectionHeight < 1) continue;

    const elements: ScrapedElement[] = [];
    collectElements(node, sectionTop, elements, 1);

    const sectionBg = parseBackgroundColor(node.styles.backgroundColor);
    sections.push({
      name: `${tag.toLowerCase()}-${i}`,
      top: sectionTop,
      height: Math.max(sectionHeight, 100),
      elements,
      ...(sectionBg ? { backgroundColor: sectionBg } : {}),
    });
  }

  return { sections, allNodes: rawData.sectionNodes.map((s: any) => s.node) };
}

function collectElements(
  node: RawDOMNode,
  sectionTop: number,
  out: ScrapedElement[],
  zBase: number,
): void {
  const classified = classifyNode(node, sectionTop, zBase);
  if (classified) {
    out.push(classified);
    if (classified.type !== 'container') return;
  }

  for (let i = 0; i < node.children.length; i++) {
    collectElements(node.children[i]!, sectionTop, out, zBase + 1);
  }
}

function classifyNode(
  node: RawDOMNode,
  sectionTop: number,
  zBase: number,
): ScrapedElement | null {
  const { tag, box, styles } = node;

  if (box.w < 2 || box.h < 2) return null;

  if (MEDIA_TAGS.has(tag) || tag === 'SVG') {
    return classifyMedia(node, sectionTop, zBase);
  }

  if (styles.backgroundImage && styles.backgroundImage !== 'none') {
    const bgMedia = classifyBackgroundImage(node, sectionTop, zBase);
    if (bgMedia) return bgMedia;
  }

  if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
    return classifyEmbed(node, sectionTop, zBase);
  }

  if (isActionElement(node)) {
    return classifyAction(node, sectionTop, zBase);
  }

  if (TEXT_TAGS.has(tag) || (node.hasTextDirectly && node.childCount === 0)) {
    return classifyText(node, sectionTop, zBase);
  }

  if (tag === 'UL' || tag === 'OL') {
    return classifyList(node, sectionTop, zBase);
  }

  if (tag === 'HR') {
    return classifyShape(node, sectionTop, zBase);
  }

  if (isDecorativeDiv(node)) {
    return classifyShape(node, sectionTop, zBase);
  }

  if (isContainerElement(node)) {
    return classifyContainer(node, sectionTop, zBase);
  }

  return null;
}

function isActionElement(node: RawDOMNode): boolean {
  const { tag, styles } = node;

  if (tag === 'BUTTON') return true;

  if (tag === 'A' && node.href) {
    const hasBg = styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                  styles.backgroundColor !== 'transparent';
    const hasBorder = styles.border !== 'none' && styles.border !== '' &&
                      !styles.border.startsWith('0px');
    const hasPadding = styles.padding !== '0px' &&
                       parseInt(styles.padding, 10) > 4;
    const hasRadius = parseInt(styles.borderRadius, 10) > 0;

    if (hasBg || hasBorder || (hasPadding && hasRadius)) return true;

    if (styles.display === 'inline-block' || styles.display === 'flex' ||
        styles.display === 'inline-flex') {
      if (hasPadding) return true;
    }
  }

  return false;
}

function isDecorativeDiv(node: RawDOMNode): boolean {
  if (node.childCount > 0) return false;
  if (node.textContent.length > 0) return false;
  const hasBg = node.styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                node.styles.backgroundColor !== 'transparent';
  return hasBg && node.box.h < 20;
}

function isContainerElement(node: RawDOMNode): boolean {
  if (node.childCount === 0) return false;
  const { styles } = node;
  const hasBg = styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                styles.backgroundColor !== 'transparent';
  const hasBorder = styles.border !== 'none' && styles.border !== '' &&
                    !styles.border.startsWith('0px');
  const hasShadow = styles.boxShadow !== 'none' && styles.boxShadow !== '';
  const hasBackdrop = styles.backdropFilter !== 'none' && styles.backdropFilter !== '';
  return hasBg || hasBorder || hasShadow || hasBackdrop;
}

function classifyText(node: RawDOMNode, sectionTop: number, z: number): ScrapedElement | null {
  const text = node.innerText || node.textContent;
  if (!text || text.length === 0) return null;

  const role = HEADING_TAGS[node.tag] ||
    (node.tag === 'LABEL' ? 'label' as const :
     node.tag === 'FIGCAPTION' ? 'caption' as const : 'p' as const);

  const fontSize = parseFloat(node.styles.fontSize) || 16;
  const motion = detectMotion(node);

  return {
    type: 'text',
    box: makeBox(node, sectionTop, z),
    data: {
      type: 'text',
      role,
      runs: [{ text }],
      fontSize,
      textAlign: (node.styles.textAlign as 'left' | 'center' | 'right') || 'left',
      color: node.styles.color,
    },
    ...(motion ? { motion } : {}),
  };
}

function classifyMedia(node: RawDOMNode, sectionTop: number, z: number): ScrapedElement | null {
  const src = node.src;
  if (!src) return null;

  const isVideo = node.tag === 'VIDEO';
  const motion = detectMotion(node);

  return {
    type: 'media',
    box: makeBox(node, sectionTop, z),
    data: {
      type: 'media',
      src,
      alt: node.alt || '',
      mediaType: isVideo ? 'video' : 'image',
      originalUrl: src,
    },
    ...(motion ? { motion } : {}),
  };
}

function classifyBackgroundImage(
  node: RawDOMNode,
  sectionTop: number,
  z: number,
): ScrapedElement | null {
  const bg = node.styles.backgroundImage;
  const urlMatch = bg.match(/url\(["']?(.+?)["']?\)/);
  if (!urlMatch || !urlMatch[1]) return null;

  return {
    type: 'media',
    box: makeBox(node, sectionTop, Math.max(z - 1, 0)),
    data: {
      type: 'media',
      src: urlMatch[1],
      alt: '',
      mediaType: 'image',
      originalUrl: urlMatch[1],
    },
  };
}

function classifyAction(node: RawDOMNode, sectionTop: number, z: number): ScrapedElement {
  const label = node.innerText || node.textContent || 'Click';
  const href = node.href || '#';
  const variant = inferActionVariant(node);
  const motion = detectMotion(node);

  return {
    type: 'action',
    box: makeBox(node, sectionTop, z),
    data: {
      type: 'action',
      label: label.slice(0, 100),
      href,
      variant,
    },
    ...(motion ? { motion } : {}),
  };
}

function classifyShape(node: RawDOMNode, sectionTop: number, z: number): ScrapedElement {
  const { box } = node;
  let variant: 'rect' | 'pill' | 'circle' | 'line' | 'badge' | 'blob' = 'rect';

  if (node.tag === 'HR' || box.h < 6) {
    variant = 'line';
  } else {
    const radius = parseInt(node.styles.borderRadius, 10) || 0;
    const minDim = Math.min(box.w, box.h);
    if (radius >= minDim / 2) {
      variant = Math.abs(box.w - box.h) < 10 ? 'circle' : 'pill';
    }
  }

  const fill = parseBackgroundColor(node.styles.backgroundColor);

  return {
    type: 'shape',
    box: makeBox(node, sectionTop, z),
    data: {
      type: 'shape',
      variant,
      ...(fill ? { fill } : {}),
    },
  };
}

function classifyContainer(node: RawDOMNode, sectionTop: number, z: number): ScrapedElement {
  const variant = inferSurfaceVariant(node);
  const motion = detectMotion(node);
  const bg = parseBackgroundColor(node.styles.backgroundColor);

  return {
    type: 'container',
    box: makeBox(node, sectionTop, z),
    data: {
      type: 'container',
      variant,
      ...(bg ? { backgroundColor: bg } : {}),
    },
    ...(motion ? { motion } : {}),
  };
}

function classifyEmbed(node: RawDOMNode, sectionTop: number, z: number): ScrapedElement {
  return {
    type: 'embed',
    box: makeBox(node, sectionTop, z),
    data: {
      type: 'embed',
      src: node.src || '',
    },
  };
}

function classifyList(node: RawDOMNode, sectionTop: number, z: number): ScrapedElement | null {
  const items = node.children
    .filter((c: RawDOMNode) => c.tag === 'LI')
    .map((c: RawDOMNode) => c.innerText || c.textContent)
    .filter(Boolean);

  if (items.length === 0) return null;

  const listText = items.join('\n');
  const motion = detectMotion(node);

  return {
    type: 'text',
    box: makeBox(node, sectionTop, z),
    data: {
      type: 'text',
      role: 'p',
      runs: [{ text: listText }],
      fontSize: parseFloat(node.styles.fontSize) || 16,
      textAlign: 'left',
      color: node.styles.color,
    },
    ...(motion ? { motion } : {}),
  };
}

function inferActionVariant(
  node: RawDOMNode,
): 'solid' | 'outline' | 'ghost' | 'pill' | 'glass' | 'brutalist' | 'underline' {
  const { styles } = node;
  const hasBg = styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                styles.backgroundColor !== 'transparent';
  const hasBorder = styles.border !== 'none' && !styles.border.startsWith('0px');
  const radius = parseInt(styles.borderRadius, 10) || 0;

  if (hasBg && radius > 20) return 'pill';
  if (hasBg && hasBorder) return 'solid';
  if (hasBg) return 'solid';
  if (hasBorder) return 'outline';
  return 'ghost';
}

function inferSurfaceVariant(
  node: RawDOMNode,
): 'flat' | 'raised' | 'glass' | 'outlined' | 'sticker' | 'editorial-frame' | 'soft-panel' {
  const { styles } = node;
  const hasBackdrop = styles.backdropFilter !== 'none' && styles.backdropFilter !== '';
  const hasShadow = styles.boxShadow !== 'none' && styles.boxShadow !== '';
  const hasBorder = styles.border !== 'none' && !styles.border.startsWith('0px');
  const hasBg = styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                styles.backgroundColor !== 'transparent';

  if (hasBackdrop) return 'glass';
  if (hasShadow && hasBorder) return 'sticker';
  if (hasShadow) return 'raised';
  if (hasBorder && !hasBg) return 'outlined';
  if (hasBg) return 'flat';
  return 'flat';
}

function detectMotion(node: RawDOMNode): { preset: string; delayMs?: number } | undefined {
  const { styles } = node;
  const hasTransition = styles.transition !== 'none' && styles.transition !== '' &&
                        styles.transition !== 'all 0s ease 0s';
  const hasAnimation = styles.animation !== 'none' && styles.animation !== '';
  const hasWillChange = styles.willChange !== 'auto' && styles.willChange !== '';
  const hasTransform = styles.transform !== 'none' && styles.transform !== '';

  if (!hasTransition && !hasAnimation && !hasWillChange && !hasTransform) {
    return undefined;
  }

  if (hasAnimation) {
    const name = styles.animation.split(' ')[0] || '';
    return { preset: mapAnimationToPreset(name) };
  }

  if (hasTransform) {
    return { preset: mapTransformToPreset(styles.transform) };
  }

  return { preset: 'fade-in' };
}

function mapAnimationToPreset(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('fade') && lower.includes('up')) return 'fade-up';
  if (lower.includes('fade') && lower.includes('down')) return 'fade-down';
  if (lower.includes('fade') && lower.includes('right')) return 'fade-right';
  if (lower.includes('fade') && lower.includes('left')) return 'fade-up';
  if (lower.includes('fade')) return 'fade-in';
  if (lower.includes('slide') && lower.includes('up')) return 'slide-up';
  if (lower.includes('slide') && lower.includes('right')) return 'slide-right';
  if (lower.includes('slide') && lower.includes('left')) return 'slide-left';
  if (lower.includes('slide')) return 'slide-up';
  if (lower.includes('scale') || lower.includes('zoom-in')) return 'scale-in';
  if (lower.includes('zoom-out') || lower.includes('shrink')) return 'zoom-out';
  if (lower.includes('blur')) return 'blur-in';
  if (lower.includes('rotate') || lower.includes('spin')) return 'rotate-in';
  if (lower.includes('flip')) return 'flip-in';
  if (lower.includes('bounce')) return 'bounce-in';
  if (lower.includes('drift') || lower.includes('float')) return 'slow-drift';
  if (lower.includes('parallax')) return 'parallax-soft';
  return 'fade-in';
}

function mapTransformToPreset(transform: string): string {
  if (transform.includes('translateY') && transform.includes('-')) return 'fade-down';
  if (transform.includes('translateY')) return 'fade-up';
  if (transform.includes('translateX')) return 'slide-left';
  if (transform.includes('scale')) return 'scale-in';
  if (transform.includes('rotate')) return 'rotate-in';
  return 'fade-in';
}

function makeBox(
  node: RawDOMNode,
  sectionTop: number,
  z: number,
): { x: number; y: number; w: number; h: number; z: number } {
  return {
    x: Math.round(node.box.x),
    y: Math.round(node.box.y - sectionTop),
    w: Math.round(node.box.w),
    h: Math.round(node.box.h),
    z: z + node.zIndex,
  };
}

function parseBackgroundColor(bg: string): string | undefined {
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return undefined;
  return bg;
}
