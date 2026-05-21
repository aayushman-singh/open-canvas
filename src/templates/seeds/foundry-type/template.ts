import type { TemplatePageDescriptor } from '../../../db/schema';
import type { DocumentJSON, ThemeTokenSet } from '../../../document/schema';
import type { TemplateDescriptor } from '../../registry';
import homeDoc from './pages/home.json';

const tokens: ThemeTokenSet = {
  paletteSeed: '#111111',
  font: { heading: 'IBM Plex Serif', body: 'IBM Plex Sans' },
  radius: 'none',
  density: 'normal',
};

const pages: TemplatePageDescriptor[] = [
  {
    slug: '/',
    title: 'Home',
    doc: homeDoc as DocumentJSON,
  },
];

const descriptor: TemplateDescriptor = {
  id: 'foundry-type',
  name: 'Halcyon Type Foundry',
  tagline: 'Portfolio site for an independent type foundry.',
  category: 'portfolio',
  thumbnail: null,
  designLanguage: 'A',
  tokens,
  pages,
};

export default descriptor;
