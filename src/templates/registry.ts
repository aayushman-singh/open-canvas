import seed from '../canvas/fixtures/home.json';
import type { CanvasSiteState } from '../canvas/schema';

export interface TemplateSeed {
  id: 'starter-canvas';
  name: string;
  tagline: string;
  state: CanvasSiteState;
}

export const starterTemplate: TemplateSeed = {
  id: 'starter-canvas',
  name: 'Starter Canvas',
  tagline:
    'A desktop canvas site with editable sections, text, media, actions, shapes, containers, style kits, and motion.',
  state: seed as CanvasSiteState,
};

export function getTemplateSeed(id: string): TemplateSeed | null {
  return id === starterTemplate.id ? starterTemplate : null;
}
