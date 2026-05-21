import type {
  TemplateCategory,
  TemplateDesignLanguage,
  TemplatePageDescriptor,
} from '../db/schema';
import type { ThemeTokenSet } from '../document/schema';
import mapleCoffee from './seeds/maple-coffee/template';
import foundryType from './seeds/foundry-type/template';
import lighthouseLaunch from './seeds/lighthouse-launch/template';

export interface TemplateDescriptor {
  id: string;
  name: string;
  tagline: string;
  category: TemplateCategory;
  thumbnail: string | null;
  designLanguage: TemplateDesignLanguage;
  tokens: ThemeTokenSet;
  pages: TemplatePageDescriptor[];
}

export const templates: TemplateDescriptor[] = [mapleCoffee, foundryType, lighthouseLaunch];

export function getTemplate(id: string): TemplateDescriptor | undefined {
  return templates.find((t) => t.id === id);
}
