import type { TemplatePageDescriptor } from '../../../db/schema';
import type { DocumentJSON, ThemeTokenSet } from '../../../document/schema';
import type { TemplateDescriptor } from '../../registry';
import homeDoc from './pages/home.json';

const tokens: ThemeTokenSet = {
  paletteSeed: '#7a4a2b',
  font: { heading: 'IBM Plex Serif', body: 'IBM Plex Sans' },
  radius: 'md',
  density: 'comfortable',
};

const pages: TemplatePageDescriptor[] = [
  {
    slug: '/',
    title: 'Home',
    doc: homeDoc as DocumentJSON,
  },
];

const descriptor: TemplateDescriptor = {
  id: 'maple-coffee',
  name: 'Maple & Ember Coffee',
  tagline: 'Single-page microsite for an independent coffee shop.',
  category: 'business',
  thumbnail: null,
  designLanguage: 'B',
  tokens,
  pages,
};

export default descriptor;
