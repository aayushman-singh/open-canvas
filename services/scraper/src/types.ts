export interface ScrapeRequest {
  url: string;
}

export interface ScrapedElement {
  type: 'text' | 'media' | 'action' | 'shape' | 'container' | 'embed';
  box: { x: number; y: number; w: number; h: number; z: number };
  rotation?: number | undefined;
  data: TextData | MediaData | ActionData | ShapeData | ContainerData | EmbedData;
  motion?: { preset: string; delayMs?: number | undefined } | undefined;
  pinnedStyle?: Record<string, string> | undefined;
}

export interface TextData {
  type: 'text';
  role: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'label' | 'caption';
  runs: { text: string; marks?: { type: string; href?: string }[] }[];
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
}

export interface MediaData {
  type: 'media';
  src: string;
  alt: string;
  mediaType: 'image' | 'video';
  originalUrl: string;
}

export interface ActionData {
  type: 'action';
  label: string;
  href: string;
  variant: 'solid' | 'outline' | 'ghost' | 'pill' | 'glass' | 'brutalist' | 'underline';
}

export interface ShapeData {
  type: 'shape';
  variant: 'rect' | 'pill' | 'circle' | 'line' | 'badge' | 'blob';
  fill?: string | undefined;
  stroke?: string | undefined;
}

export interface ContainerData {
  type: 'container';
  variant: 'flat' | 'raised' | 'glass' | 'outlined' | 'sticker' | 'editorial-frame' | 'soft-panel';
  backgroundColor?: string;
}

export interface EmbedData {
  type: 'embed';
  src: string;
}

export interface ScrapedSection {
  name: string;
  top: number;
  height: number;
  elements: ScrapedElement[];
  backgroundColor?: string | undefined;
}

export interface ExtractedColors {
  seed: string;
  bg: string;
  text: string;
  muted: string;
}

export interface ExtractedFonts {
  display: string;
  body: string;
  mono: string;
}

export interface ScrapedAsset {
  kind: 'media' | 'font';
  originalUrl: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
  fontFamily?: string | undefined;
  fontWeight?: number | undefined;
  fontStyle?: 'normal' | 'italic' | undefined;
}

export interface FontAssetReference {
  url: string;
  fontFamily: string;
  fontWeight?: number | undefined;
  fontStyle?: 'normal' | 'italic' | undefined;
}

export interface ScrapeResult {
  sections: ScrapedSection[];
  colors: ExtractedColors;
  fonts: ExtractedFonts;
  assets: ScrapedAsset[];
  warnings: string[];
  sourceUrl: string;
  scrapedAt: string;
}
