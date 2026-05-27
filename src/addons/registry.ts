// src/addons/registry.ts

export interface AddonConfigField {
  key: string;
  label: string;
  placeholder: string;
  pattern?: string;
  patternHint?: string;
}

export interface AddonDefinition {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  configFields: AddonConfigField[];
  emitHeadScripts: (config: Record<string, string>) => string;
  emitBodyScripts?: (config: Record<string, string>) => string;
}

// REVIEW (XSS): `mid` is interpolated raw into a <script> src attribute and a JS string literal. The `pattern` on the config field is a UI hint only — nothing server-side enforces it. A stored config value like `G-X"></script><script>alert(1)</script>` breaks out of the tag. Validate `mid` against the pattern here at emit time, not just at the form layer.
function emitGoogleAnalytics(config: Record<string, string>): string {
  const mid = config['measurementId'] ?? '';
  if (!mid) return '';
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${mid}"></script>`,
    '<script>',
    'window.dataLayer=window.dataLayer||[];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js',new Date());",
    `gtag('config','${mid}');`,
    '</script>',
  ].join('\n');
}

const googleAnalytics: AddonDefinition = {
  id: 'addon_google_analytics',
  slug: 'google-analytics',
  name: 'Google Analytics',
  tagline: 'Track visitor traffic and behaviour on your published site.',
  description:
    'Injects the Google Analytics gtag.js script into every page of your published site. ' +
    'You provide your GA4 Measurement ID (starts with G-) and we handle the rest.',
  configFields: [
    {
      key: 'measurementId',
      label: 'Measurement ID',
      placeholder: 'G-XXXXXXXXXX',
      pattern: '^G-[A-Z0-9]+$',
      patternHint: 'Must start with G- followed by letters and numbers',
    },
  ],
  emitHeadScripts: emitGoogleAnalytics,
};

function emitCustomHeadScripts(config: Record<string, string>): string {
  return config['headScripts'] ?? '';
}

function emitCustomBodyScripts(config: Record<string, string>): string {
  return config['bodyScripts'] ?? '';
}

const customScripts: AddonDefinition = {
  id: 'addon_custom_scripts',
  slug: 'custom-scripts',
  name: 'Custom Scripts',
  tagline: 'Inject third-party scripts like Intercom, Hotjar, or Meta Pixel.',
  description:
    'Paste any <script> or tracking snippet into your published site. ' +
    'Head scripts load before the page renders; body scripts load after. ' +
    'Use this for chat widgets, analytics, pixels, or any third-party integration.',
  configFields: [
    {
      key: 'headScripts',
      label: 'Head Scripts',
      placeholder: '<script src="https://example.com/widget.js"></script>',
    },
    {
      key: 'bodyScripts',
      label: 'Body Scripts',
      placeholder: '<script>console.log("loaded")</script>',
    },
  ],
  emitHeadScripts: emitCustomHeadScripts,
  emitBodyScripts: emitCustomBodyScripts,
};

export const allAddons = [googleAnalytics, customScripts] as const satisfies readonly AddonDefinition[];

const addonsById = new Map(allAddons.map((a) => [a.id, a]));
const addonsBySlug = new Map(allAddons.map((a) => [a.slug, a]));

export function getAddon(id: string): AddonDefinition | undefined {
  return addonsById.get(id);
}

export function getAddonBySlug(slug: string): AddonDefinition | undefined {
  return addonsBySlug.get(slug);
}
