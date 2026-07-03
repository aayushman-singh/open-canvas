import type { BackgroundSize, BaseElement } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, styleFromEntries } from './render-utils.js';

export interface RichMotionElement extends BaseElement {
  type: 'rich-motion';
  assetRefId: string;
  fit: BackgroundSize;
  label: string;
}

export function renderRichMotion(element: RichMotionElement): string {
  const style = styleFromEntries([
    ['width', '100%'],
    ['height', '100%'],
    ['display', 'block'],
  ]);
  return `<div class="opencanvas-rich-motion" data-opencanvas-rich-motion="${escapeAttr(element.id)}" data-rich-motion-asset-ref="${escapeAttr(element.assetRefId)}" data-rich-motion-fit="${escapeAttr(element.fit)}" aria-label="${escapeAttr(element.label)}" style="${style}"><canvas data-opencanvas-rich-motion-canvas="${escapeAttr(element.id)}" style="${style}"></canvas></div>`;
}

export const richMotionInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'text', label: 'Label', path: 'label' },
    { kind: 'select', label: 'Fit', path: 'fit', options: ['cover', 'contain'] },
  ],
};

export const richMotionSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'rich-motion',
      sidebarLabel: 'Animation',
      sidebarTip: 'Add an animation source',
      toolbarLabel: '+Animation',
      toolbarTip: 'Add animation',
      factoryName: 'rich-motion',
    },
  ],
};

export const richMotionAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    assetRefId: { type: 'string', description: 'Animation source id referenced by this element.' },
    label: { type: 'string', description: 'Accessible label for the motion asset.' },
    fit: {
      type: 'string',
      enum: ['cover', 'contain'],
      description: 'How the motion canvas fits inside the element frame.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.assetRefId !== undefined) {
      if (typeof args.assetRefId !== 'string') throw new Error('assetRefId must be a string');
      patch.assetRefId = args.assetRefId;
    }
    if (args.label !== undefined) {
      if (typeof args.label !== 'string') throw new Error('label must be a string');
      patch.label = args.label;
    }
    if (args.fit !== undefined) {
      if (args.fit !== 'cover' && args.fit !== 'contain') {
        throw new Error('fit must be cover or contain');
      }
      patch.fit = args.fit;
    }
    return patch;
  },
};
