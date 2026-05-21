import type { TemplatePageDescriptor } from '../../../db/schema';
import type { DocumentJSON, ThemeTokenSet } from '../../../document/schema';
import type { TemplateDescriptor } from '../../registry';
import homeDoc from './pages/home.json';

const tokens: ThemeTokenSet = {
  paletteSeed: '#2bb1ff',
  font: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' },
  radius: 'lg',
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
  id: 'lighthouse-launch',
  name: 'Lighthouse Release',
  tagline: 'Product launch page for a release-engineering tool.',
  category: 'landing',
  thumbnail: null,
  designLanguage: 'D',
  tokens,
  pages,
};

export default descriptor;
