// src/editor-client/sidebar-factories.ts
//
// ADR 0015 Phase 2f — sidebar drop-in factories. Each entry is a pure
// function that returns `{ defaultSize, payload }` where `payload` is
// the new element JSON minus its `id` and `box` (the caller fills both,
// using `defaultBox(section, defaultSize.w, defaultSize.h)`).
//
// Keys match `SidebarCommandSpec.factoryName` in
// src/canvas/elements/sidebar-spec.ts. The sidebar-dispatch:smoke
// already pins the curated `REGISTERED_FACTORIES` set against this
// map — adding a factory here means updating that smoke's list too.
//
// canvas-client.ts:103-336 carries the inline copy; retires on the
// Phase 3 atomic cutover.

import type { CanvasElement } from '../canvas/schema.js';
import { newElementId } from './ids.js';

export interface SidebarFactoryResult {
  defaultSize: { w: number; h: number };
  payload: Omit<CanvasElement, 'id' | 'box'>;
}

export type SidebarFactoryName =
  | 'text'
  | 'image'
  | 'video'
  | 'rich-motion'
  | 'action'
  | 'shape'
  | 'container'
  | 'chart'
  | 'form'
  | 'embed'
  | 'code'
  | 'accordion'
  | 'carousel'
  | 'table'
  | 'nav'
  | 'tabs'
  | 'flow-container';

export const SIDEBAR_FACTORIES: Record<SidebarFactoryName, () => SidebarFactoryResult> = {
  text: () => ({
    defaultSize: { w: 320, h: 80 },
    payload: {
      type: 'text',
      content: [{ text: 'New text' }],
      role: 'body',
      fontSize: 16,
      fontWeight: 400,
      align: 'left',
    },
  }),

  image: () => ({
    defaultSize: { w: 480, h: 320 },
    payload: {
      type: 'media',
      mediaKind: 'image',
      assetId: '__placeholder__',
      alt: 'Image',
      fit: 'cover',
    },
  }),

  video: () => ({
    defaultSize: { w: 480, h: 320 },
    payload: {
      type: 'media',
      mediaKind: 'video',
      assetId: '__placeholder__',
      alt: 'Video',
      fit: 'cover',
      playback: { autoplay: false, muted: true, loop: false, controls: true },
    },
  }),

  'rich-motion': () => ({
    defaultSize: { w: 520, h: 520 },
    payload: {
      type: 'rich-motion',
      assetRefId: '__placeholder__',
      fit: 'contain',
      label: 'Rich motion asset',
    },
  }),

  action: () => ({
    defaultSize: { w: 160, h: 48 },
    payload: {
      type: 'action',
      label: [{ text: 'Action' }],
      href: { type: 'external', url: '#' },
      variant: 'solid',
    },
  }),

  shape: () => ({
    defaultSize: { w: 120, h: 120 },
    payload: {
      type: 'shape',
      variant: 'rect',
    },
  }),

  container: () => ({
    defaultSize: { w: 480, h: 320 },
    payload: {
      type: 'container',
      variant: 'flat',
    },
  }),

  chart: () => ({
    // Default to a small bar chart with two series across three categories
    // so the Owner has something to edit in the data grid immediately.
    defaultSize: { w: 480, h: 320 },
    payload: {
      type: 'chart',
      kind: 'bar',
      series: [
        { label: 'Series A', values: [3, 5, 2] },
        { label: 'Series B', values: [4, 1, 6] },
      ],
      categories: ['Jan', 'Feb', 'Mar'],
      showLegend: true,
    },
  }),

  form: () => ({
    defaultSize: { w: 480, h: 360 },
    payload: {
      type: 'form',
      fields: [
        {
          id: newElementId(),
          label: 'Name',
          kind: 'text',
          required: true,
          placeholder: 'Your name',
        },
        {
          id: newElementId(),
          label: 'Email',
          kind: 'email',
          required: true,
          placeholder: 'you@example.com',
        },
        {
          id: newElementId(),
          label: 'Message',
          kind: 'textarea',
          required: false,
          placeholder: 'Your message',
        },
      ],
      submitLabel: 'Send',
      successMessage: 'Thanks! We received your submission.',
    },
  }),

  embed: () => ({
    defaultSize: { w: 480, h: 320 },
    payload: {
      type: 'embed',
      url: '',
      title: 'Embed',
    },
  }),

  code: () => ({
    defaultSize: { w: 480, h: 240 },
    payload: {
      type: 'code',
      language: 'typescript',
      source: "function hello() {\n  return 'world';\n}",
      showLineNumbers: true,
    },
  }),

  accordion: () => ({
    defaultSize: { w: 480, h: 320 },
    payload: {
      type: 'accordion',
      items: [
        {
          id: newElementId(),
          title: 'First question',
          body: [{ text: 'Answer to the first question.' }],
        },
        {
          id: newElementId(),
          title: 'Second question',
          body: [{ text: 'Answer to the second question.' }],
        },
        {
          id: newElementId(),
          title: 'Third question',
          body: [{ text: 'Answer to the third question.' }],
        },
      ],
      allowMultipleOpen: false,
    },
  }),

  carousel: () => ({
    defaultSize: { w: 480, h: 320 },
    payload: {
      type: 'carousel',
      slides: [
        { id: newElementId(), assetId: '__placeholder__', caption: 'Slide 1' },
        { id: newElementId(), assetId: '__placeholder__', caption: 'Slide 2' },
        { id: newElementId(), assetId: '__placeholder__', caption: 'Slide 3' },
      ],
      showArrows: true,
      showDots: true,
    },
  }),

  table: () => {
    const colA = newElementId();
    const colB = newElementId();
    const colC = newElementId();
    return {
      defaultSize: { w: 480, h: 240 },
      payload: {
        type: 'table',
        columns: [
          { id: colA, header: 'Name' },
          { id: colB, header: 'Role' },
          { id: colC, header: 'Status' },
        ],
        rows: [
          {
            id: newElementId(),
            cells: Object.fromEntries([
              [colA, 'Alice'],
              [colB, 'Engineer'],
              [colC, 'Active'],
            ]),
          },
          {
            id: newElementId(),
            cells: Object.fromEntries([
              [colA, 'Bob'],
              [colB, 'Designer'],
              [colC, 'Active'],
            ]),
          },
        ],
        zebra: true,
        collapseOnPhone: true,
      },
    };
  },

  nav: () => ({
    defaultSize: { w: 960, h: 56 },
    payload: {
      type: 'nav',
      links: [
        { label: 'Home', href: '/home', kind: 'internal' },
        { label: 'About', href: '/about', kind: 'internal' },
        { label: 'Contact', href: '/contact', kind: 'internal' },
      ],
      layout: 'left-right',
      sticky: false,
    },
  }),

  tabs: () => ({
    defaultSize: { w: 640, h: 360 },
    payload: {
      type: 'tabs',
      tabs: [
        {
          id: 'overview',
          label: [{ text: 'Overview' }],
          elements: [
            {
              id: newElementId(),
              type: 'text',
              box: { x: 24, y: 24, w: 360, h: 48, z: 1 },
              content: [{ text: 'Overview panel' }],
              role: 'heading',
              fontSize: 24,
              fontWeight: 600,
              align: 'left',
            },
          ],
        },
        {
          id: 'details',
          label: [{ text: 'Details' }],
          elements: [
            {
              id: newElementId(),
              type: 'text',
              box: { x: 24, y: 24, w: 360, h: 48, z: 1 },
              content: [{ text: 'Details panel' }],
              role: 'body',
              fontSize: 16,
              fontWeight: 400,
              align: 'left',
            },
          ],
        },
      ],
      activeTabId: 'overview',
      tabBarHeight: 56,
    },
  }),

  'flow-container': () => ({
    defaultSize: { w: 720, h: 320 },
    payload: {
      type: 'flow-container',
      layout: {
        mode: 'grid',
        columns: 2,
        gap: { row: 16, column: 16 },
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        align: 'stretch',
        justify: 'start',
        responsive: {
          phone: { columns: 1, gap: { row: 12, column: 12 } },
        },
      },
      items: [
        {
          id: 'item-' + newElementId().slice(3),
          element: {
            id: newElementId(),
            type: 'text',
            box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
            content: [{ text: 'Flow heading' }],
            role: 'heading',
            fontSize: 28,
            fontWeight: 600,
            align: 'left',
          },
        },
        {
          id: 'item-' + newElementId().slice(3),
          element: {
            id: newElementId(),
            type: 'action',
            box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
            label: [{ text: 'Action' }],
            href: { type: 'external', url: '#' },
            variant: 'solid',
          },
        },
      ],
    },
  }),
};
