// Server-side ProseMirror schema mirroring TipTap StarterKit's default node
// set so the Yjs XmlFragment shape converges between the server (this Worker)
// and the browser editor (TipTap v3 StarterKit + Collaboration).
//
// We deliberately use StarterKit's vocabulary, NOT the rev01 document vocabulary
// in src/document/schema.ts. The rich rev01 vocabulary (sections, columns,
// actions, etc.) lives on the renderer side; the multiplayer editor MVP edits
// the StarterKit subset (doc -> paragraph|heading|lists|...) and a follow-up
// (task #9 / theme studio task) bridges that back to the renderer vocabulary.
//
// Both sides must agree on every node and mark name. Adding a node here
// without adding it on the client (or vice versa) will desynchronise the
// CRDT and surface as content vanishing on save/reload.

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

const inlineContent = 'text*';
const blockContent = 'block+';

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: blockContent,
  },
  paragraph: {
    content: inlineContent,
    group: 'block',
    attrs: {
      textAlign: { default: null },
    },
  },
  heading: {
    content: inlineContent,
    group: 'block',
    attrs: {
      level: { default: 1 },
      textAlign: { default: null },
    },
  },
  blockquote: {
    content: blockContent,
    group: 'block',
  },
  bulletList: {
    content: 'listItem+',
    group: 'block',
  },
  orderedList: {
    content: 'listItem+',
    group: 'block',
    attrs: {
      start: { default: 1 },
    },
  },
  listItem: {
    content: 'paragraph block*',
  },
  codeBlock: {
    content: 'text*',
    group: 'block',
    code: true,
    marks: '',
    attrs: {
      language: { default: null },
    },
  },
  horizontalRule: {
    group: 'block',
  },
  hardBreak: {
    group: 'inline',
    inline: true,
  },
  text: {
    group: 'inline',
  },
};

const marks: Record<string, MarkSpec> = {
  bold: {},
  italic: {},
  strike: {},
  code: { excludes: '_' },
  link: {
    attrs: {
      href: { default: '' },
      target: { default: null },
      rel: { default: null },
    },
  },
};

export const pmSchema = new Schema({ nodes, marks });

export const Y_XML_FRAGMENT_NAME = 'default';
