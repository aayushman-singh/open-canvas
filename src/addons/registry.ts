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
}

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

export const allAddons = [googleAnalytics] as const satisfies readonly AddonDefinition[];

const addonsById = new Map(allAddons.map((a) => [a.id, a]));
const addonsBySlug = new Map(allAddons.map((a) => [a.slug, a]));

export function getAddon(id: string): AddonDefinition | undefined {
  return addonsById.get(id);
}

export function getAddonBySlug(slug: string): AddonDefinition | undefined {
  return addonsBySlug.get(slug);
}
